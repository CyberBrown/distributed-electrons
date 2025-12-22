/**
 * Smart LLM Router with Automatic Fallback
 * Routes requests to the best available provider with intelligent fallback
 */

import type { Env, TextResult, GenerateOptions } from './types';
import {
  createProviderRegistry,
  getAvailableProviders,
  findProviderForModel,
  markProviderExhausted,
  markProviderError,
  markProviderHealthy,
  isQuotaError,
  isTransientError,
  getHealthSummary,
  type ProviderHealthState,
  type ProviderConfig,
} from './provider-registry';

/**
 * Result from router including fallback metadata
 */
export interface RouterResult extends TextResult {
  routingInfo: {
    attemptedProviders: string[];
    finalProvider: string;
    fallbackUsed: boolean;
    totalAttempts: number;
  };
}

/**
 * Options for the router
 */
export interface RouterOptions {
  maxRetries?: number;
  preferredProvider?: string;
  excludeProviders?: string[];
  requireStreaming?: boolean;
}

/**
 * Provider-specific generation function signature
 */
type GenerateFunction = (
  model: string,
  prompt: string,
  options: GenerateOptions,
  apiKey: string
) => Promise<TextResult>;

/**
 * Smart Router class for LLM requests
 */
export class LLMRouter {
  private state: ProviderHealthState;
  private env: Env;
  private generators: Map<string, GenerateFunction>;

  constructor(env: Env) {
    this.env = env;
    this.state = createProviderRegistry(env);
    this.generators = new Map();
  }

  /**
   * Register a generator function for a provider
   */
  registerGenerator(providerId: string, generator: GenerateFunction): void {
    this.generators.set(providerId, generator);
  }

  /**
   * Route a request to the best available provider with fallback
   */
  async route(
    model: string,
    prompt: string,
    options: GenerateOptions,
    routerOptions: RouterOptions = {}
  ): Promise<RouterResult> {
    const {
      maxRetries = 3,
      preferredProvider,
      excludeProviders = [],
      requireStreaming = false,
    } = routerOptions;

    const attemptedProviders: string[] = [];
    let lastError: Error | null = null;

    // Get available providers
    let providers = getAvailableProviders(this.state);

    // Filter out excluded providers
    if (excludeProviders.length > 0) {
      providers = providers.filter(p => !excludeProviders.includes(p.id));
    }

    // Filter for streaming support if required
    if (requireStreaming) {
      providers = providers.filter(p => p.supportsStreaming);
    }

    // Move preferred provider to front if specified and available
    if (preferredProvider) {
      const preferredIndex = providers.findIndex(p => p.id === preferredProvider);
      if (preferredIndex > 0) {
        const [preferred] = providers.splice(preferredIndex, 1);
        providers.unshift(preferred);
      }
    }

    if (providers.length === 0) {
      throw new Error('No available providers configured. Check API keys and provider health.');
    }

    console.log(`LLM Router: ${providers.length} providers available, attempting request...`);
    console.log(`Provider health: ${JSON.stringify(getHealthSummary(this.state))}`);

    // Try each provider in order
    for (const provider of providers) {
      attemptedProviders.push(provider.id);

      try {
        const result = await this.executeWithProvider(
          provider,
          model,
          prompt,
          options
        );

        // Success! Mark provider as healthy and return
        markProviderHealthy(this.state, provider.id);

        return {
          ...result,
          routingInfo: {
            attemptedProviders,
            finalProvider: provider.id,
            fallbackUsed: attemptedProviders.length > 1,
            totalAttempts: attemptedProviders.length,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        lastError = error instanceof Error ? error : new Error(errorMessage);

        console.error(`Provider ${provider.id} failed: ${errorMessage}`);

        // Check error type and update provider health
        if (isQuotaError(errorMessage)) {
          console.log(`Provider ${provider.id} has exhausted quota, marking as exhausted`);
          markProviderExhausted(this.state, provider.id, 60); // 1 hour cooldown

          // Continue to next provider
          continue;
        }

        if (isTransientError(errorMessage)) {
          // Transient error - mark but could retry same provider
          markProviderError(this.state, provider.id, errorMessage);

          // Continue to next provider
          continue;
        }

        // Other error (auth, invalid request, etc.)
        markProviderError(this.state, provider.id, errorMessage);

        // For auth errors, continue to next provider
        if (errorMessage.includes('401') || errorMessage.includes('403')) {
          continue;
        }

        // For 400 errors (bad request), the request itself is problematic
        // Don't retry with other providers
        if (errorMessage.includes('400')) {
          throw lastError;
        }

        // Continue to next provider for other errors
        continue;
      }
    }

    // All providers failed
    throw new Error(
      `All providers failed. Attempted: ${attemptedProviders.join(', ')}. ` +
      `Last error: ${lastError?.message || 'Unknown error'}`
    );
  }

  /**
   * Execute request with a specific provider
   */
  private async executeWithProvider(
    provider: ProviderConfig,
    model: string,
    prompt: string,
    options: GenerateOptions
  ): Promise<TextResult> {
    // Get the generator for this provider
    const generator = this.generators.get(provider.id);

    if (!generator) {
      throw new Error(`No generator registered for provider: ${provider.id}`);
    }

    // Get API key for the provider
    const apiKey = this.getApiKeyForProvider(provider.id);
    if (!apiKey) {
      throw new Error(`No API key configured for provider: ${provider.id}`);
    }

    // Adjust model name if needed for provider compatibility
    const adjustedModel = this.adjustModelForProvider(model, provider);

    console.log(`Executing with provider ${provider.id}, model: ${adjustedModel}`);

    // Execute the request
    return await generator(adjustedModel, prompt, options, apiKey);
  }

  /**
   * Get API key for a provider
   */
  private getApiKeyForProvider(providerId: string): string | undefined {
    switch (providerId) {
      case 'anthropic':
        return this.env.ANTHROPIC_API_KEY;
      case 'openai':
        return this.env.OPENAI_API_KEY;
      case 'spark-local':
        // Spark local might use a different auth mechanism
        return (this.env as any).SPARK_API_KEY || 'local';
      default:
        return undefined;
    }
  }

  /**
   * Adjust model name for provider compatibility
   * e.g., when falling back from Anthropic to OpenAI, map claude -> gpt
   */
  private adjustModelForProvider(model: string, provider: ProviderConfig): string {
    // If spark-local, pass through as-is (it handles any model)
    if (provider.id === 'spark-local') {
      return model;
    }

    // Check if model matches provider
    const isClaudeModel = model.toLowerCase().startsWith('claude');
    const isOpenAIModel = model.toLowerCase().startsWith('gpt') ||
                          model.toLowerCase().startsWith('o1');

    // If falling back from Anthropic to OpenAI
    if (isClaudeModel && provider.id === 'openai') {
      // Map Claude models to equivalent OpenAI models
      if (model.includes('opus') || model.includes('sonnet')) {
        return 'gpt-4o'; // High capability
      }
      if (model.includes('haiku')) {
        return 'gpt-4o-mini'; // Fast/cheap
      }
      return 'gpt-4o-mini'; // Default fallback
    }

    // If falling back from OpenAI to Anthropic
    if (isOpenAIModel && provider.id === 'anthropic') {
      // Map OpenAI models to equivalent Claude models
      if (model.includes('gpt-4o') && !model.includes('mini')) {
        return 'claude-sonnet-4-20250514';
      }
      if (model.includes('gpt-4o-mini')) {
        return 'claude-3-5-haiku-20241022';
      }
      if (model.includes('o1') || model.includes('gpt-4')) {
        return 'claude-sonnet-4-20250514';
      }
      return 'claude-3-5-haiku-20241022'; // Default fallback
    }

    return model;
  }

  /**
   * Get current health summary
   */
  getHealthSummary(): Record<string, any> {
    return getHealthSummary(this.state);
  }

  /**
   * Force mark a provider as healthy (for admin/testing)
   */
  resetProvider(providerId: string): void {
    markProviderHealthy(this.state, providerId);
  }
}

/**
 * Create and configure a router with default generators
 */
export function createRouter(
  env: Env,
  generators: {
    openai: GenerateFunction;
    anthropic: GenerateFunction;
    sparkLocal?: GenerateFunction;
  }
): LLMRouter {
  const router = new LLMRouter(env);

  router.registerGenerator('openai', generators.openai);
  router.registerGenerator('anthropic', generators.anthropic);

  if (generators.sparkLocal) {
    router.registerGenerator('spark-local', generators.sparkLocal);
  }

  return router;
}
