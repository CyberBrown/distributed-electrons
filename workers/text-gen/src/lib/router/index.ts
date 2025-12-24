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
  TextOptions,
} from './types';
import { ProviderError, NoAvailableProviderError } from './types';
import { Registry } from './registry';
import { Selector } from './selector';
import { transformerRegistry } from './transformer';
import { adapterRegistry, isQuotaError, isTransientError } from './adapters';
import { WorkflowEngine } from './workflows/engine';
import { getBuiltInWorkflow } from './workflows/templates';
import { TextOnlyRouter } from './text-only-router';
import { shouldUseTextOnlyTier, getQueueStatus, isCodeQueueCongested } from './queue-aware-router';

// Re-export types
export * from './types';

// Re-export text-only routing utilities
export { classifyRoutingTier, TextOnlyRouter } from './text-only-router';

// Re-export queue-aware routing utilities
export { shouldUseTextOnlyTier, getQueueStatus, isCodeQueueCongested } from './queue-aware-router';

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
  private textOnlyRouter: TextOnlyRouter;
  private env: RouterEnv;

  constructor(
    env: RouterEnv,
    config: RouterConfig = {}
  ) {
    this.env = env;
    this.registry = new Registry(env.DB);
    this.selector = new Selector(this.registry, env);
    this.workflowEngine = new WorkflowEngine(this);
    this.textOnlyRouter = new TextOnlyRouter(env);
    // Config stored for future retry/timeout logic
    void config.maxRetries;
    void config.defaultTimeout;
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

    // For text-gen worker, check if we should use the text-only tier
    if (request.worker === 'text-gen') {
      const textOptions = request.options as TextOptions | undefined;

      // Use queue-aware routing to determine tier
      const { useTextOnly, reason } = await shouldUseTextOnlyTier(
        request.prompt,
        textOptions,
        this.env
      );

      if (useTextOnly) {
        console.log(`Using text-only routing tier: ${reason}`);
        const textOnlyResult = await this.routeTextOnly(request, startTime);
        if (textOnlyResult) {
          return textOnlyResult;
        }
        // Fall through to standard routing if text-only fails
        console.log('Text-only routing failed, falling back to standard routing');
      } else {
        console.log(`Using standard routing: ${reason}`);
      }
    }

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
   * Route a text-only request through the fast provider chain
   * Returns null if all text-only providers fail (caller should fall back to standard routing)
   */
  private async routeTextOnly(
    request: SimpleRequest,
    startTime: number
  ): Promise<RouterResponse | null> {
    try {
      const textOptions = (request.options || {}) as TextOptions;
      const result = await this.textOnlyRouter.route(request.prompt, textOptions);

      if (!result) {
        return null;
      }

      const stepMeta: StepMeta = {
        id: 'result',
        worker: request.worker,
        provider: result.provider,
        model: result.result.model,
        latency_ms: Date.now() - startTime,
        tokens_used: result.result.tokens_used,
        cost_cents: 0, // Text-only providers are free or very cheap
      };

      return {
        success: true,
        results: { result: result.result },
        _meta: {
          request_type: 'simple',
          steps: [stepMeta],
          total_cost_cents: 0,
          total_latency_ms: stepMeta.latency_ms,
        },
      };
    } catch (error) {
      console.error('Text-only routing error:', error);
      return null;
    }
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

    // Get gateway token for AI Gateway routing
    const gatewayToken = this.selector.getGatewayToken();

    // Require API key for non-local providers (unless using Gateway with BYOK)
    if (!apiKey && provider.type !== 'local' && !gatewayToken) {
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

    // Get gateway URL (token already retrieved above)
    const gatewayUrl = this.selector.getGatewayUrl();

    // Build adapter context
    const context: AdapterContext = {
      worker: workerId,
      provider,
      model,
      apiKey: apiKey || '',
      baseUrl: baseUrl || undefined,
      // AI Gateway - when token is present, adapters route through Gateway
      gatewayToken: gatewayToken || undefined,
      gatewayUrl: gatewayUrl || undefined,
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
   * Get health status of text-only providers (Spark, z.ai)
   */
  async getTextOnlyHealth() {
    return this.textOnlyRouter.checkHealth();
  }

  /**
   * Get Nexus execution queue status (for queue-aware routing)
   */
  async getQueueStatus() {
    return getQueueStatus(this.env);
  }

  /**
   * Check if the code execution queue is congested
   */
  async isQueueCongested() {
    return isCodeQueueCongested(this.env);
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
