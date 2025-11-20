/**
 * Instance Resolver
 *
 * Resolves which instance configuration to use for a given request.
 * Handles caching, Config Service calls, and fallback strategies.
 */

import {
  InstanceConfig,
  LookupContext,
  LookupResult,
  LookupError,
  LookupErrorType,
  ResolverOptions,
} from './types';
import { InstanceCache } from './cache';

/**
 * Default resolver options
 */
const DEFAULT_OPTIONS: ResolverOptions = {
  cache_ttl: 300, // 5 minutes
  use_stale_on_error: true,
  config_service_timeout: 5000, // 5 seconds
};

/**
 * Instance Resolver
 *
 * Main class for resolving instance configurations.
 * Implements cache-first strategy with Config Service fallback.
 */
export class InstanceResolver {
  private cache: InstanceCache;
  private options: ResolverOptions;

  constructor(
    kv: KVNamespace,
    options: Partial<ResolverOptions> = {}
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.cache = new InstanceCache(kv, this.options.cache_ttl);
  }

  /**
   * Resolve instance configuration for a request
   *
   * Flow:
   * 1. Determine instance ID from context
   * 2. Check cache
   * 3. On cache miss: call Config Service
   * 4. On Config Service error: use stale cache if available
   *
   * @param context - Lookup context with user and request information
   * @returns Instance configuration with metadata
   */
  async resolve(context: LookupContext): Promise<LookupResult> {
    // Step 1: Determine instance ID
    const instanceId = this.determineInstanceId(context);

    if (!instanceId) {
      throw new LookupError(
        LookupErrorType.INVALID_CONTEXT,
        'Cannot determine instance ID from context',
        400,
        { context }
      );
    }

    // Step 2: Check cache
    const cached = await this.cache.get(instanceId, false);

    if (cached) {
      return {
        config: cached.config,
        source: cached.source,
        ttl_remaining: cached.ttl_remaining,
      };
    }

    // Step 3: Cache miss - fetch from Config Service
    try {
      const config = await this.fetchFromConfigService(instanceId, context);

      // Verify user has access to this instance
      this.verifyAccess(context, config);

      // Cache the result
      await this.cache.set(instanceId, config);

      return {
        config,
        source: 'service',
        ttl_remaining: this.options.cache_ttl || 300,
      };
    } catch (error) {
      // Step 4: Config Service error - try stale cache
      if (this.options.use_stale_on_error) {
        const stale = await this.cache.get(instanceId, true);

        if (stale) {
          console.warn(
            `Using stale cache for instance ${instanceId} due to Config Service error`,
            error
          );

          return {
            config: stale.config,
            source: stale.source,
            ttl_remaining: 0,
          };
        }
      }

      // No stale cache available - propagate error
      throw error;
    }
  }

  /**
   * Determine instance ID from context
   *
   * Priority order:
   * 1. Explicit instance_id in context (from X-Instance-ID header)
   * 2. Instance ID from project_id lookup
   * 3. User's default instance
   *
   * @param context - Lookup context
   * @returns Instance ID or null
   */
  private determineInstanceId(context: LookupContext): string | null {
    // Priority 1: Explicit instance ID
    if (context.instance_id) {
      return context.instance_id;
    }

    // Priority 2: Project ID (would require project -> instance mapping)
    // This is a placeholder - in production, you'd query a service
    if (context.project_id) {
      // TODO: Implement project -> instance mapping
      // For now, we'll skip this
    }

    // Priority 3: User's default instance
    if (context.user.default_instance_id) {
      return context.user.default_instance_id;
    }

    return null;
  }

  /**
   * Fetch instance config from Config Service
   *
   * @param instanceId - Instance identifier
   * @param context - Lookup context for auth/logging
   * @returns Instance configuration
   */
  private async fetchFromConfigService(
    instanceId: string,
    context: LookupContext
  ): Promise<InstanceConfig> {
    if (!this.options.config_service_url) {
      throw new LookupError(
        LookupErrorType.CONFIG_SERVICE_UNAVAILABLE,
        'Config Service URL not configured',
        503,
        { instanceId }
      );
    }

    const url = `${this.options.config_service_url}/instances/${instanceId}`;
    const timeout = this.options.config_service_timeout || 5000;

    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': context.user.user_id,
          'X-Request-ID': context.request_metadata?.request_id || '',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 404) {
          throw new LookupError(
            LookupErrorType.INSTANCE_NOT_FOUND,
            `Instance ${instanceId} not found`,
            404,
            { instanceId }
          );
        }

        if (response.status === 403) {
          throw new LookupError(
            LookupErrorType.ACCESS_DENIED,
            `User ${context.user.user_id} does not have access to instance ${instanceId}`,
            403,
            { instanceId, userId: context.user.user_id }
          );
        }

        throw new LookupError(
          LookupErrorType.CONFIG_SERVICE_UNAVAILABLE,
          `Config Service returned ${response.status}`,
          503,
          { instanceId, status: response.status }
        );
      }

      const config = await response.json() as InstanceConfig;
      return config;
    } catch (error) {
      // Handle abort/timeout
      if (error instanceof Error && error.name === 'AbortError') {
        throw new LookupError(
          LookupErrorType.CONFIG_SERVICE_UNAVAILABLE,
          `Config Service request timed out after ${timeout}ms`,
          503,
          { instanceId, timeout }
        );
      }

      // Handle LookupError
      if (error instanceof LookupError) {
        throw error;
      }

      // Handle other fetch errors
      throw new LookupError(
        LookupErrorType.CONFIG_SERVICE_UNAVAILABLE,
        'Failed to fetch from Config Service',
        503,
        { instanceId, error }
      );
    }
  }

  /**
   * Verify user has access to instance
   *
   * This is a basic check - in production, you'd have more sophisticated ACL
   *
   * @param context - Lookup context
   * @param config - Instance configuration
   */
  private verifyAccess(
    context: LookupContext,
    config: InstanceConfig
  ): void {
    // Basic owner check
    if (config.metadata?.owner) {
      const isOwner = config.metadata.owner === context.user.user_id;
      const isAdmin = context.user.roles?.includes('admin');

      if (!isOwner && !isAdmin) {
        throw new LookupError(
          LookupErrorType.ACCESS_DENIED,
          `User ${context.user.user_id} does not have access to instance ${config.instance_id}`,
          403,
          {
            userId: context.user.user_id,
            instanceId: config.instance_id,
            owner: config.metadata.owner,
          }
        );
      }
    }

    // Additional access checks could go here
    // - Tenant-based access
    // - Role-based access
    // - Feature flag checks
  }

  /**
   * Invalidate cache for a specific instance
   *
   * @param instanceId - Instance identifier
   */
  async invalidateCache(instanceId: string): Promise<void> {
    await this.cache.invalidate(instanceId);
  }

  /**
   * Invalidate all instance caches
   */
  async invalidateAllCaches(): Promise<number> {
    return await this.cache.invalidateAll();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Preload instances into cache
   *
   * @param configs - Array of instance configurations
   */
  async warmCache(configs: InstanceConfig[]): Promise<void> {
    await this.cache.warmCache(configs);
  }
}

/**
 * Create a new instance resolver
 *
 * @param kv - KV namespace for caching
 * @param options - Resolver options
 */
export function createInstanceResolver(
  kv: KVNamespace,
  options?: Partial<ResolverOptions>
): InstanceResolver {
  return new InstanceResolver(kv, options);
}

/**
 * Convenience function to resolve instance
 *
 * @param kv - KV namespace
 * @param context - Lookup context
 * @param options - Optional resolver options
 */
export async function resolveInstance(
  kv: KVNamespace,
  context: LookupContext,
  options?: Partial<ResolverOptions>
): Promise<InstanceConfig> {
  const resolver = createInstanceResolver(kv, options);
  const result = await resolver.resolve(context);
  return result.config;
}
