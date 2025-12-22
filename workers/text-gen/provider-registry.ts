/**
 * Provider Registry for Universal LLM Router
 * Tracks provider health, priority, and quota status
 * Enables intelligent fallback when providers fail
 */

import type { Env } from './types';

/**
 * Provider configuration with health tracking
 */
export interface ProviderConfig {
  id: string;
  name: string;
  priority: number; // Lower = higher priority (1 = first choice)
  baseUrl: string;
  healthStatus: 'healthy' | 'degraded' | 'exhausted' | 'error';
  lastHealthCheck: Date;
  quotaExhaustedUntil?: Date; // When quota will reset
  errorCount: number;
  consecutiveFailures: number;
  supportsStreaming: boolean;
  models: string[]; // Supported model patterns
}

/**
 * Provider health state - stored in-memory per request context
 * In production, this could be stored in Durable Objects for persistence
 */
export interface ProviderHealthState {
  providers: Map<string, ProviderConfig>;
  lastUpdated: Date;
}

/**
 * Default provider configurations
 * Priority 1 = first choice, 2 = second choice, etc.
 */
const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: 'spark-local',
    name: 'Spark Local (On-Prem)',
    priority: 1,
    baseUrl: '', // Set from SPARK_LOCAL_URL env
    healthStatus: 'healthy',
    lastHealthCheck: new Date(),
    errorCount: 0,
    consecutiveFailures: 0,
    supportsStreaming: true,
    models: ['*'], // Accepts any model, proxies to local LLM
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    priority: 2,
    baseUrl: 'https://api.anthropic.com',
    healthStatus: 'healthy',
    lastHealthCheck: new Date(),
    errorCount: 0,
    consecutiveFailures: 0,
    supportsStreaming: true,
    models: ['claude-*'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    priority: 3,
    baseUrl: 'https://api.openai.com',
    healthStatus: 'healthy',
    lastHealthCheck: new Date(),
    errorCount: 0,
    consecutiveFailures: 0,
    supportsStreaming: true,
    models: ['gpt-*', 'o1-*', 'chatgpt-*'],
  },
];

/**
 * Error patterns that indicate quota/credit exhaustion
 * These should NOT be retried - need human intervention
 */
export const QUOTA_ERROR_PATTERNS = [
  // Anthropic
  /credit balance is too low/i,
  /insufficient_quota/i,
  /rate_limit_exceeded/i,
  /billing.*issue/i,
  /payment.*required/i,
  /quota.*exceeded/i,

  // OpenAI
  /insufficient_quota/i,
  /billing_hard_limit_reached/i,
  /you exceeded your current quota/i,
  /rate limit reached/i,
  /account.*billing/i,

  // Generic
  /out of credits/i,
  /no credits remaining/i,
  /payment method/i,
  /subscription.*expired/i,
  /api key.*expired/i,
];

/**
 * Error patterns that indicate temporary failures (retry-able)
 */
export const TRANSIENT_ERROR_PATTERNS = [
  /timeout/i,
  /connection.*reset/i,
  /network.*error/i,
  /temporarily unavailable/i,
  /service.*overloaded/i,
  /500 internal server error/i,
  /502 bad gateway/i,
  /503 service unavailable/i,
  /504 gateway timeout/i,
];

/**
 * Create a fresh provider registry with default config
 */
export function createProviderRegistry(env: Env): ProviderHealthState {
  const providers = new Map<string, ProviderConfig>();

  for (const defaultConfig of DEFAULT_PROVIDERS) {
    const config = { ...defaultConfig };

    // Set spark-local URL from environment
    if (config.id === 'spark-local') {
      config.baseUrl = (env as any).SPARK_LOCAL_URL || '';
      // If no Spark URL configured, mark as unavailable
      if (!config.baseUrl) {
        config.healthStatus = 'error';
      }
    }

    // Check if API keys are available
    if (config.id === 'anthropic' && !env.ANTHROPIC_API_KEY) {
      config.healthStatus = 'error'; // No API key configured
    }
    if (config.id === 'openai' && !env.OPENAI_API_KEY) {
      config.healthStatus = 'error'; // No API key configured
    }

    providers.set(config.id, config);
  }

  return {
    providers,
    lastUpdated: new Date(),
  };
}

/**
 * Get all providers sorted by priority
 * Only returns providers that are healthy or degraded (not exhausted/error)
 */
export function getAvailableProviders(state: ProviderHealthState): ProviderConfig[] {
  const available: ProviderConfig[] = [];

  for (const provider of state.providers.values()) {
    // Skip providers that are exhausted or in error state
    if (provider.healthStatus === 'exhausted') {
      // Check if quota has reset
      if (provider.quotaExhaustedUntil && new Date() > provider.quotaExhaustedUntil) {
        provider.healthStatus = 'healthy';
        provider.quotaExhaustedUntil = undefined;
        provider.consecutiveFailures = 0;
      } else {
        continue;
      }
    }

    if (provider.healthStatus === 'error') {
      // Could add auto-recovery logic here
      continue;
    }

    available.push(provider);
  }

  // Sort by priority (lower number = higher priority)
  return available.sort((a, b) => a.priority - b.priority);
}

/**
 * Get a specific provider by ID
 */
export function getProvider(state: ProviderHealthState, providerId: string): ProviderConfig | undefined {
  return state.providers.get(providerId);
}

/**
 * Find the best provider for a given model
 */
export function findProviderForModel(
  state: ProviderHealthState,
  model: string
): ProviderConfig | null {
  const available = getAvailableProviders(state);

  for (const provider of available) {
    if (providerSupportsModel(provider, model)) {
      return provider;
    }
  }

  return null;
}

/**
 * Check if a provider supports a given model
 */
function providerSupportsModel(provider: ProviderConfig, model: string): boolean {
  for (const pattern of provider.models) {
    if (pattern === '*') return true;

    // Convert glob pattern to regex
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
      'i'
    );

    if (regex.test(model)) return true;
  }

  return false;
}

/**
 * Mark a provider as having exhausted quota
 * Sets a cooldown period before retrying
 */
export function markProviderExhausted(
  state: ProviderHealthState,
  providerId: string,
  cooldownMinutes: number = 60
): void {
  const provider = state.providers.get(providerId);
  if (!provider) return;

  provider.healthStatus = 'exhausted';
  provider.quotaExhaustedUntil = new Date(Date.now() + cooldownMinutes * 60 * 1000);
  provider.lastHealthCheck = new Date();

  console.log(`Provider ${providerId} marked as exhausted until ${provider.quotaExhaustedUntil.toISOString()}`);
}

/**
 * Mark a provider as having a transient error
 * Tracks consecutive failures for circuit breaker logic
 */
export function markProviderError(
  state: ProviderHealthState,
  providerId: string,
  error: string
): void {
  const provider = state.providers.get(providerId);
  if (!provider) return;

  provider.errorCount++;
  provider.consecutiveFailures++;
  provider.lastHealthCheck = new Date();

  // Circuit breaker: after 3 consecutive failures, mark as degraded
  if (provider.consecutiveFailures >= 3) {
    provider.healthStatus = 'degraded';
  }

  // After 5 consecutive failures, mark as error (needs manual intervention)
  if (provider.consecutiveFailures >= 5) {
    provider.healthStatus = 'error';
  }

  console.log(`Provider ${providerId} error (${provider.consecutiveFailures} consecutive): ${error}`);
}

/**
 * Mark a provider as healthy after successful request
 */
export function markProviderHealthy(
  state: ProviderHealthState,
  providerId: string
): void {
  const provider = state.providers.get(providerId);
  if (!provider) return;

  provider.healthStatus = 'healthy';
  provider.consecutiveFailures = 0;
  provider.lastHealthCheck = new Date();
}

/**
 * Check if an error indicates quota exhaustion
 */
export function isQuotaError(error: string): boolean {
  return QUOTA_ERROR_PATTERNS.some(pattern => pattern.test(error));
}

/**
 * Check if an error is transient (retry-able)
 */
export function isTransientError(error: string): boolean {
  return TRANSIENT_ERROR_PATTERNS.some(pattern => pattern.test(error));
}

/**
 * Get provider health summary for logging/monitoring
 */
export function getHealthSummary(state: ProviderHealthState): Record<string, any> {
  const summary: Record<string, any> = {};

  for (const [id, provider] of state.providers) {
    summary[id] = {
      status: provider.healthStatus,
      priority: provider.priority,
      consecutiveFailures: provider.consecutiveFailures,
      quotaExhaustedUntil: provider.quotaExhaustedUntil?.toISOString(),
    };
  }

  return summary;
}
