/**
 * Instance Configuration Cache
 *
 * KV-based caching layer for instance configurations.
 * Implements 5-minute TTL with stale cache fallback.
 */

import {
  InstanceConfig,
  CacheEntry,
  CacheStats,
  LookupError,
  LookupErrorType,
} from './types';

/**
 * Cache key prefix to namespace instance configs
 */
const CACHE_KEY_PREFIX = 'instance_config:';

/**
 * Default TTL: 5 minutes (300 seconds)
 */
const DEFAULT_TTL = 300;

/**
 * Stale cache grace period: 1 hour
 * After TTL expires, stale data can still be used for this duration if Config Service is down
 */
const STALE_GRACE_PERIOD = 3600;

/**
 * Instance configuration cache
 * Manages KV storage, TTL, and cache invalidation
 */
export class InstanceCache {
  private kv: KVNamespace;
  private ttl: number;
  private stats: CacheStats;

  constructor(kv: KVNamespace, ttl: number = DEFAULT_TTL) {
    this.kv = kv;
    this.ttl = ttl;
    this.stats = {
      hits: 0,
      misses: 0,
      stale_hits: 0,
      evictions: 0,
    };
  }

  /**
   * Generate cache key for an instance
   */
  private getCacheKey(instanceId: string): string {
    return `${CACHE_KEY_PREFIX}${instanceId}`;
  }

  /**
   * Get instance config from cache
   *
   * @param instanceId - The instance identifier
   * @param allowStale - Whether to return stale data if available
   * @returns Cache entry or null if not found/expired
   */
  async get(
    instanceId: string,
    allowStale: boolean = false
  ): Promise<{ config: InstanceConfig; source: 'cache' | 'stale_cache'; ttl_remaining: number } | null> {
    const key = this.getCacheKey(instanceId);

    try {
      const raw = await this.kv.get(key, { type: 'json' });

      if (!raw) {
        this.stats.misses++;
        return null;
      }

      const entry = raw as CacheEntry;
      const now = Date.now();
      const age = (now - entry.cached_at) / 1000; // Age in seconds
      const ttlRemaining = entry.ttl - age;

      // Fresh cache hit
      if (ttlRemaining > 0) {
        this.stats.hits++;
        return {
          config: entry.config,
          source: 'cache',
          ttl_remaining: Math.floor(ttlRemaining),
        };
      }

      // Stale cache hit (within grace period)
      if (allowStale && age < STALE_GRACE_PERIOD) {
        this.stats.stale_hits++;
        return {
          config: entry.config,
          source: 'stale_cache',
          ttl_remaining: 0,
        };
      }

      // Expired and no stale fallback
      this.stats.misses++;
      return null;
    } catch (error) {
      console.error('Cache get error:', error);
      throw new LookupError(
        LookupErrorType.CACHE_ERROR,
        `Failed to get cache for instance ${instanceId}`,
        500,
        { instanceId, error }
      );
    }
  }

  /**
   * Store instance config in cache
   *
   * @param instanceId - The instance identifier
   * @param config - The instance configuration to cache
   * @param customTtl - Optional custom TTL (defaults to instance TTL)
   */
  async set(
    instanceId: string,
    config: InstanceConfig,
    customTtl?: number
  ): Promise<void> {
    const key = this.getCacheKey(instanceId);
    const ttl = customTtl || this.ttl;

    const entry: CacheEntry = {
      config,
      cached_at: Date.now(),
      ttl,
    };

    try {
      // Store in KV with expiration
      // KV expirationTtl is in seconds
      await this.kv.put(key, JSON.stringify(entry), {
        expirationTtl: ttl + STALE_GRACE_PERIOD, // Keep for grace period after TTL
      });
    } catch (error) {
      console.error('Cache set error:', error);
      throw new LookupError(
        LookupErrorType.CACHE_ERROR,
        `Failed to cache instance ${instanceId}`,
        500,
        { instanceId, error }
      );
    }
  }

  /**
   * Invalidate cache for a specific instance
   *
   * @param instanceId - The instance identifier
   */
  async invalidate(instanceId: string): Promise<void> {
    const key = this.getCacheKey(instanceId);

    try {
      await this.kv.delete(key);
      this.stats.evictions++;
    } catch (error) {
      console.error('Cache invalidate error:', error);
      throw new LookupError(
        LookupErrorType.CACHE_ERROR,
        `Failed to invalidate cache for instance ${instanceId}`,
        500,
        { instanceId, error }
      );
    }
  }

  /**
   * Invalidate all instance caches
   * Note: This requires listing keys, which may be slow for large KV stores
   */
  async invalidateAll(): Promise<number> {
    let deletedCount = 0;

    try {
      // List all keys with our prefix
      const list = await this.kv.list({ prefix: CACHE_KEY_PREFIX });

      // Delete each key
      for (const key of list.keys) {
        await this.kv.delete(key.name);
        deletedCount++;
        this.stats.evictions++;
      }

      return deletedCount;
    } catch (error) {
      console.error('Cache invalidateAll error:', error);
      throw new LookupError(
        LookupErrorType.CACHE_ERROR,
        'Failed to invalidate all caches',
        500,
        { error }
      );
    }
  }

  /**
   * Check if instance config exists in cache (fresh or stale)
   *
   * @param instanceId - The instance identifier
   */
  async has(instanceId: string): Promise<boolean> {
    const key = this.getCacheKey(instanceId);

    try {
      const value = await this.kv.get(key);
      return value !== null;
    } catch (error) {
      console.error('Cache has error:', error);
      return false;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      stale_hits: 0,
      evictions: 0,
    };
  }

  /**
   * Warm cache with multiple configs
   * Useful for preloading frequently accessed instances
   *
   * @param configs - Array of instance configurations to cache
   */
  async warmCache(configs: InstanceConfig[]): Promise<void> {
    const promises = configs.map((config) =>
      this.set(config.instance_id, config)
    );

    try {
      await Promise.all(promises);
    } catch (error) {
      console.error('Cache warm error:', error);
      // Don't throw - warming is best-effort
    }
  }
}

/**
 * Create a new instance cache
 *
 * @param kv - KV namespace for caching
 * @param ttl - Cache TTL in seconds (default: 300)
 */
export function createInstanceCache(
  kv: KVNamespace,
  ttl?: number
): InstanceCache {
  return new InstanceCache(kv, ttl);
}
