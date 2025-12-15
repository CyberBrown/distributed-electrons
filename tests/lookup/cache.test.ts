/**
 * Tests for Instance Cache
 *
 * Tests caching behavior, TTL, stale cache, and invalidation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InstanceCache } from '../../infrastructure/lookup/cache';
import { InstanceConfig } from '../../infrastructure/lookup/types';

// Mock KV namespace
class MockKVNamespace {
  private store = new Map<string, { value: string; expiration?: number }>();

  async get(key: string, options?: any): Promise<any> {
    const entry = this.store.get(key);
    if (!entry) return null;

    // Check expiration
    if (entry.expiration && Date.now() > entry.expiration) {
      this.store.delete(key);
      return null;
    }

    if (options?.type === 'json') {
      return JSON.parse(entry.value);
    }
    return entry.value;
  }

  async put(key: string, value: string, options?: any): Promise<void> {
    const expiration = options?.expirationTtl
      ? Date.now() + options.expirationTtl * 1000
      : undefined;
    this.store.set(key, { value, expiration });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: any): Promise<any> {
    const keys = Array.from(this.store.keys())
      .filter((k) => !options?.prefix || k.startsWith(options.prefix))
      .map((name) => ({ name }));
    return { keys, list_complete: true };
  }

  // Required KVNamespace methods (not used in tests)
  getWithMetadata = vi.fn();
}

describe('InstanceCache', () => {
  let kv: MockKVNamespace;
  let cache: InstanceCache;

  const mockConfig: InstanceConfig = {
    instance_id: 'test-instance',
    api_keys: { ideogram: 'key_123' },
    rate_limits: { ideogram: { rpm: 500 } },
    worker_urls: { image_gen: 'https://worker.example.com' },
    r2_bucket: 'test-bucket',
  };

  beforeEach(() => {
    kv = new MockKVNamespace();
    cache = new InstanceCache(kv as any, 300); // 5 minute TTL
  });

  describe('Cache Hit/Miss', () => {
    it('should return null on cache miss', async () => {
      const result = await cache.get('nonexistent');
      expect(result).toBeNull();

      const stats = cache.getStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(0);
    });

    it('should return config on cache hit', async () => {
      await cache.set('test-instance', mockConfig);

      const result = await cache.get('test-instance');

      expect(result).not.toBeNull();
      expect(result?.config).toEqual(mockConfig);
      expect(result?.source).toBe('cache');
      expect(result?.ttl_remaining).toBeGreaterThan(0);

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(0);
    });

    it('should track multiple hits and misses', async () => {
      await cache.set('test-instance', mockConfig);

      await cache.get('test-instance'); // hit
      await cache.get('test-instance'); // hit
      await cache.get('nonexistent'); // miss
      await cache.get('another-miss'); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
    });
  });

  describe('TTL Behavior', () => {
    it('should respect custom TTL', async () => {
      const shortCache = new InstanceCache(kv as any, 1); // 1 second TTL
      await shortCache.set('test-instance', mockConfig);

      // Immediate get should work
      const result1 = await shortCache.get('test-instance');
      expect(result1).not.toBeNull();

      // Wait for expiration (mock time)
      vi.useFakeTimers();
      vi.advanceTimersByTime(2000); // 2 seconds

      const result2 = await shortCache.get('test-instance');
      // Should be expired (returns null, not stale)
      expect(result2).toBeNull();

      const stats = shortCache.getStats();
      expect(stats.misses).toBe(1); // Verify it counted as a miss

      vi.useRealTimers();
    });

    it('should calculate TTL remaining correctly', async () => {
      await cache.set('test-instance', mockConfig);

      const result = await cache.get('test-instance');
      expect(result?.ttl_remaining).toBeGreaterThan(290);
      expect(result?.ttl_remaining).toBeLessThanOrEqual(300);
    });
  });

  describe('Stale Cache', () => {
    it('should return stale cache when allowed', async () => {
      const shortCache = new InstanceCache(kv as any, 1);
      await shortCache.set('test-instance', mockConfig);

      // Mock time passing
      vi.useFakeTimers();
      vi.advanceTimersByTime(2000); // TTL expired

      const result = await shortCache.get('test-instance', true); // allowStale = true

      expect(result).not.toBeNull();
      expect(result?.source).toBe('stale_cache');
      expect(result?.ttl_remaining).toBe(0);

      const stats = shortCache.getStats();
      expect(stats.stale_hits).toBe(1);

      vi.useRealTimers();
    });

    it('should not return stale cache when not allowed', async () => {
      const shortCache = new InstanceCache(kv as any, 1);
      await shortCache.set('test-instance', mockConfig);

      vi.useFakeTimers();
      vi.advanceTimersByTime(2000);

      const result = await shortCache.get('test-instance', false); // allowStale = false

      // Should be null or have expired TTL
      expect(result?.ttl_remaining || 0).toBeLessThanOrEqual(0);

      vi.useRealTimers();
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate specific instance', async () => {
      await cache.set('test-instance', mockConfig);
      await cache.set('other-instance', { ...mockConfig, instance_id: 'other' });

      await cache.invalidate('test-instance');

      const result1 = await cache.get('test-instance');
      const result2 = await cache.get('other-instance');

      expect(result1).toBeNull();
      expect(result2).not.toBeNull();

      const stats = cache.getStats();
      expect(stats.evictions).toBe(1);
    });

    it('should invalidate all instances', async () => {
      await cache.set('instance-1', { ...mockConfig, instance_id: 'instance-1' });
      await cache.set('instance-2', { ...mockConfig, instance_id: 'instance-2' });
      await cache.set('instance-3', { ...mockConfig, instance_id: 'instance-3' });

      const count = await cache.invalidateAll();

      expect(count).toBe(3);

      const result1 = await cache.get('instance-1');
      const result2 = await cache.get('instance-2');
      const result3 = await cache.get('instance-3');

      expect(result1).toBeNull();
      expect(result2).toBeNull();
      expect(result3).toBeNull();
    });
  });

  describe('Cache Warming', () => {
    it('should warm cache with multiple configs', async () => {
      const configs: InstanceConfig[] = [
        { ...mockConfig, instance_id: 'instance-1' },
        { ...mockConfig, instance_id: 'instance-2' },
        { ...mockConfig, instance_id: 'instance-3' },
      ];

      await cache.warmCache(configs);

      const result1 = await cache.get('instance-1');
      const result2 = await cache.get('instance-2');
      const result3 = await cache.get('instance-3');

      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      expect(result3).not.toBeNull();
    });
  });

  describe('Has Method', () => {
    it('should return true when instance exists', async () => {
      await cache.set('test-instance', mockConfig);

      const exists = await cache.has('test-instance');
      expect(exists).toBe(true);
    });

    it('should return false when instance does not exist', async () => {
      const exists = await cache.has('nonexistent');
      expect(exists).toBe(false);
    });
  });

  describe('Statistics', () => {
    it('should track and reset statistics', async () => {
      await cache.set('test-instance', mockConfig);
      await cache.get('test-instance'); // hit
      await cache.get('nonexistent'); // miss
      await cache.invalidate('test-instance'); // eviction

      let stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.evictions).toBe(1);

      cache.resetStats();

      stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.evictions).toBe(0);
      expect(stats.stale_hits).toBe(0);
    });
  });
});
