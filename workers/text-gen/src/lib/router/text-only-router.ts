/**
 * Text-Only Router
 * Fast routing for simple text tasks without code execution overhead
 *
 * Priority order:
 * 1. z.ai (GLM-4.7) - Primary LLM
 * 2. Spark (Nemotron) - Local, free, fast
 * 3. Gemini Flash - Fast, cheap fallback
 * 4. OpenAI GPT-4o-mini - Reliable fallback
 */

import type {
  TextOptions,
  TextResult,
  RouterEnv,
  RoutingTier,
} from './types';
import { TEXT_ONLY_TASK_TYPES, CODE_TASK_TYPES } from './types';
import { SparkAdapter } from './adapters/spark';
import { ZaiAdapter } from './adapters/zai';
import { isQuotaError } from './adapters/base';

/**
 * Text-only provider configuration
 */
interface TextOnlyProvider {
  id: string;
  adapter: 'spark' | 'zai' | 'gemini' | 'openai';
  model: string;
  priority: number;
  requiresApiKey: boolean;
  apiKeyEnvVar?: string;
}

/**
 * Ordered list of text-only providers
 */
const TEXT_ONLY_PROVIDERS: TextOnlyProvider[] = [
  {
    id: 'zai',
    adapter: 'zai',
    model: 'glm-4.7',
    priority: 1,
    requiresApiKey: true,
    apiKeyEnvVar: 'ZAI_API_KEY',
  },
  {
    id: 'spark-local',
    adapter: 'spark',
    model: 'nvidia/Llama-3.1-Nemotron-70B-Instruct-HF',
    priority: 2,
    requiresApiKey: false,
  },
  // Additional fallbacks can be added here
];

/**
 * Classify whether a request should use text-only tier
 */
export function classifyRoutingTier(
  prompt: string,
  options?: TextOptions
): RoutingTier {
  // Explicit override
  if (options?.routing_tier && options.routing_tier !== 'auto') {
    return options.routing_tier;
  }

  // Check task type hint
  if (options?.task_type) {
    const taskType = options.task_type.toLowerCase();

    if (TEXT_ONLY_TASK_TYPES.some(t => taskType.includes(t))) {
      return 'text-only';
    }

    if (CODE_TASK_TYPES.some(t => taskType.includes(t))) {
      return 'code';
    }
  }

  // Heuristic-based classification
  const promptLower = prompt.toLowerCase();

  // Code indicators
  const codeIndicators = [
    /write.*code/i,
    /implement/i,
    /function.*that/i,
    /create.*class/i,
    /debug/i,
    /fix.*bug/i,
    /refactor/i,
    /```/,  // Code blocks
    /def\s+\w+/,  // Python function
    /function\s+\w+/,  // JS function
    /class\s+\w+/,  // Class definition
  ];

  if (codeIndicators.some(pattern => pattern.test(prompt))) {
    return 'code';
  }

  // Text-only indicators
  const textOnlyIndicators = [
    /^classify/i,
    /^summarize/i,
    /^extract/i,
    /^translate/i,
    /what is/i,
    /explain/i,
    /^rewrite/i,
    /sentiment/i,
    /json.*output/i,
    /output.*json/i,
  ];

  if (textOnlyIndicators.some(pattern => pattern.test(promptLower))) {
    return 'text-only';
  }

  // Default to code tier for unknown (safer)
  return 'code';
}

/**
 * Text-only router for fast, cheap text completions
 */
export class TextOnlyRouter {
  private sparkAdapter: SparkAdapter;
  private zaiAdapter: ZaiAdapter;
  private providerFailures: Map<string, number> = new Map();

  constructor(private env: RouterEnv) {
    this.sparkAdapter = new SparkAdapter();
    this.zaiAdapter = new ZaiAdapter();
  }

  /**
   * Route a text-only request through the fast provider chain
   */
  async route(
    prompt: string,
    options: TextOptions = {}
  ): Promise<{ result: TextResult; provider: string } | null> {
    const attemptedProviders: string[] = [];

    for (const providerConfig of TEXT_ONLY_PROVIDERS) {
      // Skip if provider requires API key and it's not available
      if (providerConfig.requiresApiKey && providerConfig.apiKeyEnvVar) {
        const apiKey = (this.env as any)[providerConfig.apiKeyEnvVar];
        if (!apiKey) {
          console.log(`Skipping ${providerConfig.id}: no API key`);
          continue;
        }
      }

      // Skip if provider has too many recent failures
      const failures = this.providerFailures.get(providerConfig.id) || 0;
      if (failures >= 3) {
        console.log(`Skipping ${providerConfig.id}: too many failures (${failures})`);
        continue;
      }

      attemptedProviders.push(providerConfig.id);

      try {
        const result = await this.executeWithProvider(providerConfig, prompt, options);

        // Reset failure count on success
        this.providerFailures.set(providerConfig.id, 0);

        return {
          result,
          provider: providerConfig.id,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Text-only provider ${providerConfig.id} failed: ${errorMessage}`);

        // Track failures
        this.providerFailures.set(
          providerConfig.id,
          (this.providerFailures.get(providerConfig.id) || 0) + 1
        );

        // Check if quota exhausted - mark for longer skip
        if (isQuotaError(errorMessage)) {
          console.log(`Provider ${providerConfig.id} quota exhausted`);
          this.providerFailures.set(providerConfig.id, 10); // Longer skip
        }

        // Continue to next provider
        continue;
      }
    }

    console.log(`All text-only providers failed. Attempted: ${attemptedProviders.join(', ')}`);
    return null;
  }

  /**
   * Execute request with a specific provider
   */
  private async executeWithProvider(
    config: TextOnlyProvider,
    prompt: string,
    options: TextOptions
  ): Promise<TextResult> {
    // Build adapter context
    const context = {
      worker: 'text-gen',
      provider: {
        id: config.id,
        name: config.id,
        type: config.adapter === 'spark' ? 'local' as const : 'api' as const,
        base_endpoint: null,
        auth_type: config.requiresApiKey ? 'bearer' as const : 'none' as const,
        auth_secret_name: config.apiKeyEnvVar || null,
        priority: config.priority,
        enabled: true,
        created_at: new Date().toISOString(),
        rate_limit_rpm: null,
        daily_quota: null,
      },
      model: {
        id: config.model,
        provider_id: config.id,
        model_id: config.model,
        worker_id: 'text-gen',
        capabilities: ['text'],
        context_window: 8192,
        cost_input_per_1k: 0,
        cost_output_per_1k: 0,
        quality_tier: 'standard' as const,
        speed_tier: 'fast' as const,
        priority: 1,
        enabled: true,
      },
      apiKey: config.apiKeyEnvVar ? (this.env as any)[config.apiKeyEnvVar] || '' : '',
      baseUrl: config.adapter === 'spark' ? this.env.SPARK_LOCAL_URL : undefined,
      gatewayToken: this.env.CF_AIG_TOKEN,
      gatewayUrl: this.env.AI_GATEWAY_URL,
    };

    switch (config.adapter) {
      case 'spark':
        return this.sparkAdapter.execute(prompt, options, context);
      case 'zai':
        return this.zaiAdapter.execute(prompt, options, context);
      default:
        throw new Error(`Unknown adapter: ${config.adapter}`);
    }
  }

  /**
   * Check health of text-only providers
   */
  async checkHealth(): Promise<{ provider: string; healthy: boolean }[]> {
    const results: { provider: string; healthy: boolean }[] = [];

    for (const config of TEXT_ONLY_PROVIDERS) {
      try {
        // Simple health check - just verify we can reach the endpoint
        if (config.adapter === 'spark') {
          const response = await fetch('https://vllm.shiftaltcreate.com/health');
          results.push({ provider: config.id, healthy: response.ok });
        } else if (config.adapter === 'zai') {
          const apiKey = (this.env as any)[config.apiKeyEnvVar!];
          if (!apiKey) {
            results.push({ provider: config.id, healthy: false });
          } else {
            results.push({ provider: config.id, healthy: true }); // Assume healthy if key exists
          }
        }
      } catch {
        results.push({ provider: config.id, healthy: false });
      }
    }

    return results;
  }

  /**
   * Reset failure counts (useful for retry logic)
   */
  resetFailures(): void {
    this.providerFailures.clear();
  }
}
