/**
 * DE Universal Router
 * Main router entry point
 */

import type {
  RouterRequest,
  SimpleRequest,
  WorkflowRequest,
  RouterResponse,
  RouterEnv,
  ParsedProvider,
  ParsedModel,
  AdapterContext,
  MediaOptions,
  StepMeta,
  TransformContext,
} from './types';
import { ProviderError, NoAvailableProviderError } from './types';
import { Registry } from './registry';
import { Selector } from './selector';
import { transformerRegistry } from './transformer';
import { adapterRegistry, isQuotaError, isTransientError } from './adapters';
import { WorkflowEngine } from './workflows/engine';
import { getBuiltInWorkflow } from './workflows/templates';

// Re-export types
export * from './types';

/**
 * Router configuration
 */
export interface RouterConfig {
  maxRetries?: number;
  defaultTimeout?: number;
}

/**
 * Universal Router
 * Routes requests to the best available provider with automatic fallback
 */
export class Router {
  private registry: Registry;
  private selector: Selector;
  private workflowEngine: WorkflowEngine;
  private _config: RouterConfig; // Reserved for future retry/timeout logic

  constructor(
    private _env: RouterEnv, // Reserved for direct env access
    config: RouterConfig = {}
  ) {
    this.registry = new Registry(_env.DB);
    this.selector = new Selector(this.registry, _env);
    this.workflowEngine = new WorkflowEngine(this);
    this._config = {
      maxRetries: config.maxRetries ?? 3,
      defaultTimeout: config.defaultTimeout ?? 60000,
    };
  }

  /**
   * Route a request
   */
  async route(request: RouterRequest): Promise<RouterResponse> {
    if (request.type === 'workflow') {
      return this.routeWorkflow(request);
    }
    return this.routeSimple(request);
  }

  /**
   * Route a simple (single-step) request
   */
  private async routeSimple(request: SimpleRequest): Promise<RouterResponse> {
    const startTime = Date.now();
    const attemptedProviders: string[] = [];
    let lastError: Error | null = null;

    // Get provider-model chain for fallback
    const chain = await this.selector.getProviderModelChain(
      request.worker,
      request.constraints,
      request.preferred_provider,
      request.preferred_model
    );

    if (chain.length === 0) {
      throw new NoAvailableProviderError(request.worker);
    }

    // Try each provider-model pair
    for (const { provider, model } of chain) {
      attemptedProviders.push(provider.id);

      try {
        const result = await this.executeWithProvider(
          provider,
          model,
          request.prompt,
          request.options || {},
          request.worker
        );

        // Success! Update provider status
        await this.registry.markProviderHealthy(provider.id);

        const stepMeta: StepMeta = {
          id: 'result',
          worker: request.worker,
          provider: provider.id,
          model: model.id,
          latency_ms: Date.now() - startTime,
          tokens_used: (result as any).tokens_used,
          cost_cents: this.estimateCost(model, (result as any).tokens_used),
        };

        return {
          success: true,
          results: { result },
          _meta: {
            request_type: 'simple',
            steps: [stepMeta],
            total_cost_cents: stepMeta.cost_cents || 0,
            total_latency_ms: stepMeta.latency_ms,
          },
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        lastError = error instanceof Error ? error : new Error(errorMessage);

        console.error(`Provider ${provider.id} failed: ${errorMessage}`);

        // Check error type and update provider status
        if (isQuotaError(errorMessage)) {
          console.log(`Provider ${provider.id} quota exhausted`);
          const exhaustedUntil = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
          await this.registry.markProviderExhausted(provider.id, exhaustedUntil);
          continue;
        }

        if (isTransientError(errorMessage)) {
          await this.registry.incrementProviderFailures(provider.id);
          continue;
        }

        // Auth errors - skip provider
        if (errorMessage.includes('401') || errorMessage.includes('403')) {
          await this.registry.incrementProviderFailures(provider.id);
          continue;
        }

        // Bad request - don't retry with other providers
        if (errorMessage.includes('400')) {
          throw lastError;
        }

        // Other errors - try next provider
        await this.registry.incrementProviderFailures(provider.id);
        continue;
      }
    }

    // All providers failed
    return {
      success: false,
      results: {
        error: lastError?.message || 'All providers failed',
        attempted_providers: attemptedProviders,
      },
      _meta: {
        request_type: 'simple',
        steps: [],
        total_cost_cents: 0,
        total_latency_ms: Date.now() - startTime,
      },
    };
  }

  /**
   * Route a workflow request
   */
  private async routeWorkflow(request: WorkflowRequest): Promise<RouterResponse> {
    // Get workflow definition
    let workflow = request.workflow;

    if (!workflow && request.workflow_id) {
      // Try built-in workflows first
      workflow = getBuiltInWorkflow(request.workflow_id) || undefined;

      // Then try database
      if (!workflow) {
        workflow = (await this.registry.getWorkflow(request.workflow_id)) || undefined;
      }
    }

    if (!workflow) {
      return {
        success: false,
        results: { error: 'Workflow not found' },
        _meta: {
          request_type: 'workflow',
          steps: [],
          total_cost_cents: 0,
          total_latency_ms: 0,
        },
      };
    }

    // Execute workflow
    return this.workflowEngine.execute(
      workflow,
      request.variables,
      request.constraints
    );
  }

  /**
   * Execute a request with a specific provider and model
   */
  private async executeWithProvider(
    provider: ParsedProvider,
    model: ParsedModel,
    prompt: string,
    options: MediaOptions,
    workerId: string
  ): Promise<any> {
    // Get adapter
    const adapter = adapterRegistry.get(provider.id);
    if (!adapter) {
      throw new ProviderError(provider.id, `No adapter for provider: ${provider.id}`);
    }

    // Get API key / base URL
    const apiKey = this.selector.getApiKey(provider);
    const baseUrl = this.selector.getBaseUrl(provider);

    if (!apiKey && provider.type !== 'local') {
      throw new ProviderError(provider.id, 'No API key configured');
    }

    // Transform prompt
    const transformContext: TransformContext = {
      worker: workerId,
      provider: provider.id,
      model: model.id,
      capabilities_needed: model.capabilities,
    };

    const transformedPrompt = transformerRegistry.transform(prompt, transformContext);
    const systemPrompt = transformerRegistry.getSystemPrompt(transformContext);

    // Apply system prompt if not already in options
    const finalOptions = { ...options };
    if (systemPrompt && !('system_prompt' in finalOptions)) {
      (finalOptions as any).system_prompt = systemPrompt;
    }

    // Build adapter context
    const context: AdapterContext = {
      worker: workerId,
      provider,
      model,
      apiKey: apiKey || '',
      baseUrl: baseUrl || undefined,
    };

    // Execute
    return adapter.execute(transformedPrompt, finalOptions, context);
  }

  /**
   * Estimate cost in cents
   */
  private estimateCost(model: ParsedModel, tokensUsed?: number): number {
    if (!tokensUsed || !model.cost_input_per_1k) return 0;

    // Rough estimate: assume 50% input, 50% output
    const inputCost = (tokensUsed / 2 / 1000) * (model.cost_input_per_1k || 0);
    const outputCost = (tokensUsed / 2 / 1000) * (model.cost_output_per_1k || 0);

    return Math.round((inputCost + outputCost) * 100) / 100;
  }

  /**
   * Get health status of all providers
   */
  async getHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    providers: Array<{
      id: string;
      name: string;
      healthy: boolean;
      consecutive_failures: number;
    }>;
  }> {
    const providers = await this.registry.getProviderHealth();

    const healthyCount = providers.filter((p) => p.healthy).length;
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (healthyCount === 0) {
      status = 'unhealthy';
    } else if (healthyCount < providers.length) {
      status = 'degraded';
    }

    return {
      status,
      providers: providers.map((p) => ({
        id: p.id,
        name: p.name,
        healthy: p.healthy,
        consecutive_failures: p.consecutive_failures,
      })),
    };
  }

  /**
   * Get registry stats
   */
  async getStats() {
    return this.registry.getStats();
  }

  /**
   * List available workflows
   */
  async listWorkflows() {
    const stored = await this.registry.listWorkflows();
    const builtIn = (await import('./workflows/templates')).BUILT_IN_WORKFLOWS;

    return {
      built_in: builtIn.map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description,
      })),
      stored,
    };
  }
}

/**
 * Create a router instance
 */
export function createRouter(env: RouterEnv, config?: RouterConfig): Router {
  return new Router(env, config);
}
