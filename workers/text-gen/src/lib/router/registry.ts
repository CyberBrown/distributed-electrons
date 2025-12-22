/**
 * DE Router Registry
 * Database queries for providers, models, and workflows
 */

import type {
  Worker,
  Provider,
  Model,
  ProviderStatus,
  StoredWorkflow,
  ParsedProvider,
  ParsedModel,
  WorkflowDefinition,
  RouterEnv,
} from './types';

/**
 * Registry for querying providers, models, and workflows from D1
 */
export class Registry {
  constructor(private db: D1Database) {}

  // ============================================================================
  // Workers
  // ============================================================================

  async getWorker(workerId: string): Promise<Worker | null> {
    const result = await this.db
      .prepare('SELECT * FROM workers WHERE id = ? AND enabled = 1')
      .bind(workerId)
      .first<Worker>();
    return result;
  }

  async getAllWorkers(): Promise<Worker[]> {
    const result = await this.db
      .prepare('SELECT * FROM workers WHERE enabled = 1')
      .all<Worker>();
    return result.results;
  }

  // ============================================================================
  // Providers
  // ============================================================================

  async getProvider(providerId: string): Promise<ParsedProvider | null> {
    const provider = await this.db
      .prepare('SELECT * FROM providers WHERE id = ? AND enabled = 1')
      .bind(providerId)
      .first<Provider>();

    if (!provider) return null;

    const status = await this.getProviderStatus(providerId);
    return {
      ...provider,
      enabled: provider.enabled === 1,
      status: status || undefined,
    };
  }

  async getProvidersForWorker(workerId: string): Promise<ParsedProvider[]> {
    const result = await this.db
      .prepare(`
        SELECT p.*, wp.priority as worker_priority
        FROM providers p
        JOIN worker_providers wp ON p.id = wp.provider_id
        WHERE wp.worker_id = ? AND p.enabled = 1
        ORDER BY wp.priority ASC, p.priority ASC
      `)
      .bind(workerId)
      .all<Provider & { worker_priority: number }>();

    const providers: ParsedProvider[] = [];
    for (const p of result.results) {
      const status = await this.getProviderStatus(p.id);
      providers.push({
        ...p,
        priority: p.worker_priority || p.priority,
        enabled: true,
        status: status || undefined,
      });
    }

    return providers;
  }

  async getAvailableProviders(workerId: string, env: RouterEnv): Promise<ParsedProvider[]> {
    const providers = await this.getProvidersForWorker(workerId);

    // Filter out providers that are exhausted or don't have credentials
    const now = new Date().toISOString();
    return providers.filter((p) => {
      // Check if exhausted
      if (p.status?.marked_exhausted_until && p.status.marked_exhausted_until > now) {
        return false;
      }

      // Check if API key exists (for non-local providers)
      // Provider needs either its own API key OR Gateway token for BYOK
      if (p.type !== 'local' && p.auth_secret_name) {
        const key = (env as any)[p.auth_secret_name];
        // Allow if provider has its own key OR if Gateway token exists (BYOK)
        if (!key && !env.CF_AIG_TOKEN) return false;
      }

      // Check if local URL exists
      if (p.type === 'local' && p.auth_secret_name) {
        const url = (env as any)[p.auth_secret_name];
        if (!url) return false;
      }

      return true;
    });
  }

  // ============================================================================
  // Models
  // ============================================================================

  async getModel(modelId: string): Promise<ParsedModel | null> {
    const model = await this.db
      .prepare('SELECT * FROM models WHERE id = ? AND enabled = 1')
      .bind(modelId)
      .first<Model>();

    if (!model) return null;

    return {
      ...model,
      enabled: model.enabled === 1,
      capabilities: model.capabilities ? JSON.parse(model.capabilities) : [],
    };
  }

  async getModelsForProvider(
    providerId: string,
    workerId: string
  ): Promise<ParsedModel[]> {
    const result = await this.db
      .prepare(`
        SELECT * FROM models
        WHERE provider_id = ? AND worker_id = ? AND enabled = 1
        ORDER BY priority ASC
      `)
      .bind(providerId, workerId)
      .all<Model>();

    return result.results.map((m) => ({
      ...m,
      enabled: true,
      capabilities: m.capabilities ? JSON.parse(m.capabilities) : [],
    }));
  }

  async getModelsForWorker(workerId: string): Promise<ParsedModel[]> {
    const result = await this.db
      .prepare(`
        SELECT m.* FROM models m
        JOIN providers p ON m.provider_id = p.id
        WHERE m.worker_id = ? AND m.enabled = 1 AND p.enabled = 1
        ORDER BY m.priority ASC
      `)
      .bind(workerId)
      .all<Model>();

    return result.results.map((m) => ({
      ...m,
      enabled: true,
      capabilities: m.capabilities ? JSON.parse(m.capabilities) : [],
    }));
  }

  async findModelsByCapability(
    workerId: string,
    capabilities: string[]
  ): Promise<ParsedModel[]> {
    const allModels = await this.getModelsForWorker(workerId);

    return allModels.filter((model) =>
      capabilities.every((cap) => model.capabilities.includes(cap))
    );
  }

  // ============================================================================
  // Provider Status
  // ============================================================================

  async getProviderStatus(providerId: string): Promise<ProviderStatus | null> {
    return this.db
      .prepare('SELECT * FROM provider_status WHERE provider_id = ?')
      .bind(providerId)
      .first<ProviderStatus>();
  }

  async updateProviderStatus(
    providerId: string,
    updates: Partial<ProviderStatus>
  ): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.healthy !== undefined) {
      fields.push('healthy = ?');
      values.push(updates.healthy);
    }
    if (updates.last_success_at !== undefined) {
      fields.push('last_success_at = ?');
      values.push(updates.last_success_at);
    }
    if (updates.last_failure_at !== undefined) {
      fields.push('last_failure_at = ?');
      values.push(updates.last_failure_at);
    }
    if (updates.consecutive_failures !== undefined) {
      fields.push('consecutive_failures = ?');
      values.push(updates.consecutive_failures);
    }
    if (updates.quota_used_today !== undefined) {
      fields.push('quota_used_today = ?');
      values.push(updates.quota_used_today);
    }
    if (updates.marked_exhausted_until !== undefined) {
      fields.push('marked_exhausted_until = ?');
      values.push(updates.marked_exhausted_until);
    }

    if (fields.length === 0) return;

    values.push(providerId);
    await this.db
      .prepare(`UPDATE provider_status SET ${fields.join(', ')} WHERE provider_id = ?`)
      .bind(...values)
      .run();
  }

  async markProviderExhausted(
    providerId: string,
    exhaustedUntil: Date
  ): Promise<void> {
    await this.updateProviderStatus(providerId, {
      healthy: 0,
      marked_exhausted_until: exhaustedUntil.toISOString(),
      last_failure_at: new Date().toISOString(),
    });
  }

  async markProviderHealthy(providerId: string): Promise<void> {
    await this.updateProviderStatus(providerId, {
      healthy: 1,
      consecutive_failures: 0,
      last_success_at: new Date().toISOString(),
      marked_exhausted_until: null as any,
    });
  }

  async incrementProviderFailures(providerId: string): Promise<number> {
    const status = await this.getProviderStatus(providerId);
    const newCount = (status?.consecutive_failures || 0) + 1;

    await this.updateProviderStatus(providerId, {
      consecutive_failures: newCount,
      last_failure_at: new Date().toISOString(),
      healthy: newCount >= 5 ? 0 : 1,
    });

    return newCount;
  }

  // ============================================================================
  // Workflows
  // ============================================================================

  async getWorkflow(workflowId: string): Promise<WorkflowDefinition | null> {
    const stored = await this.db
      .prepare('SELECT * FROM workflows WHERE id = ?')
      .bind(workflowId)
      .first<StoredWorkflow>();

    if (!stored) return null;

    return JSON.parse(stored.definition);
  }

  async saveWorkflow(workflow: WorkflowDefinition): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(`
        INSERT INTO workflows (id, name, description, definition, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          definition = excluded.definition,
          updated_at = excluded.updated_at
      `)
      .bind(
        workflow.id,
        workflow.name,
        workflow.description || null,
        JSON.stringify(workflow),
        now,
        now
      )
      .run();
  }

  async listWorkflows(): Promise<{ id: string; name: string; description: string | null }[]> {
    const result = await this.db
      .prepare('SELECT id, name, description FROM workflows ORDER BY name')
      .all<StoredWorkflow>();

    return result.results.map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
    }));
  }

  // ============================================================================
  // Admin / Stats
  // ============================================================================

  async getStats(): Promise<{
    workers: number;
    providers: number;
    models: number;
    workflows: number;
  }> {
    const [workers, providers, models, workflows] = await Promise.all([
      this.db.prepare('SELECT COUNT(*) as count FROM workers WHERE enabled = 1').first<{ count: number }>(),
      this.db.prepare('SELECT COUNT(*) as count FROM providers WHERE enabled = 1').first<{ count: number }>(),
      this.db.prepare('SELECT COUNT(*) as count FROM models WHERE enabled = 1').first<{ count: number }>(),
      this.db.prepare('SELECT COUNT(*) as count FROM workflows').first<{ count: number }>(),
    ]);

    return {
      workers: workers?.count || 0,
      providers: providers?.count || 0,
      models: models?.count || 0,
      workflows: workflows?.count || 0,
    };
  }

  async getProviderHealth(): Promise<
    Array<{
      id: string;
      name: string;
      healthy: boolean;
      consecutive_failures: number;
      marked_exhausted_until: string | null;
    }>
  > {
    const result = await this.db
      .prepare(`
        SELECT p.id, p.name, ps.healthy, ps.consecutive_failures, ps.marked_exhausted_until
        FROM providers p
        LEFT JOIN provider_status ps ON p.id = ps.provider_id
        WHERE p.enabled = 1
        ORDER BY p.priority ASC
      `)
      .all<{
        id: string;
        name: string;
        healthy: number;
        consecutive_failures: number;
        marked_exhausted_until: string | null;
      }>();

    return result.results.map((r) => ({
      ...r,
      healthy: r.healthy === 1,
    }));
  }
}
