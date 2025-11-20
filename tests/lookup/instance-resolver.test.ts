/**
 * Tests for Instance Resolver
 *
 * Tests instance resolution, Config Service integration, and error handling.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { InstanceResolver } from '../../infrastructure/lookup/instance-resolver';
import {
  InstanceConfig,
  LookupContext,
  LookupErrorType,
  LookupError,
} from '../../infrastructure/lookup/types';

// Mock KV namespace (reuse from cache.test.ts)
class MockKVNamespace implements KVNamespace {
  private store = new Map<string, { value: string; expiration?: number }>();

  async get(key: string, options?: any): Promise<any> {
    const entry = this.store.get(key);
    if (!entry) return null;

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

  getWithMetadata = vi.fn();
  put = this.put.bind(this);
  delete = this.delete.bind(this);
}

describe('InstanceResolver', () => {
  let kv: MockKVNamespace;
  let resolver: InstanceResolver;
  let fetchMock: any;

  const mockConfig: InstanceConfig = {
    instance_id: 'production',
    api_keys: { ideogram: 'key_123' },
    rate_limits: { ideogram: { rpm: 500 } },
    worker_urls: { image_gen: 'https://worker.example.com' },
    r2_bucket: 'prod-bucket',
    metadata: {
      owner: 'user_123',
      name: 'Production Instance',
    },
  };

  const mockContext: LookupContext = {
    user: {
      user_id: 'user_123',
      email: 'test@example.com',
      roles: ['user'],
      default_instance_id: 'production',
    },
    request_metadata: {
      request_id: 'req_123',
    },
  };

  beforeEach(() => {
    kv = new MockKVNamespace();
    resolver = new InstanceResolver(kv as any, {
      config_service_url: 'https://config.example.com',
      cache_ttl: 300,
      use_stale_on_error: true,
    });

    // Mock global fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Instance ID Determination', () => {
    it('should use explicit instance_id from context', async () => {
      const context = {
        ...mockContext,
        instance_id: 'explicit-instance',
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ...mockConfig, instance_id: 'explicit-instance' }),
      });

      const result = await resolver.resolve(context);

      expect(result.config.instance_id).toBe('explicit-instance');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://config.example.com/instances/explicit-instance',
        expect.any(Object)
      );
    });

    it('should use user default_instance_id when no explicit ID', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockConfig,
      });

      const result = await resolver.resolve(mockContext);

      expect(result.config.instance_id).toBe('production');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://config.example.com/instances/production',
        expect.any(Object)
      );
    });

    it('should throw error when instance ID cannot be determined', async () => {
      const context: LookupContext = {
        user: {
          user_id: 'user_123',
          // No default_instance_id
        },
        // No instance_id or project_id
      };

      await expect(resolver.resolve(context)).rejects.toThrow(LookupError);
      await expect(resolver.resolve(context)).rejects.toMatchObject({
        type: LookupErrorType.INVALID_CONTEXT,
        statusCode: 400,
      });
    });
  });

  describe('Cache Behavior', () => {
    it('should return cached config on cache hit', async () => {
      // Pre-populate cache
      await resolver['cache'].set('production', mockConfig);

      const result = await resolver.resolve(mockContext);

      expect(result.config).toEqual(mockConfig);
      expect(result.source).toBe('cache');
      expect(result.ttl_remaining).toBeGreaterThan(0);

      // Should not call Config Service
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should fetch from Config Service on cache miss', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockConfig,
      });

      const result = await resolver.resolve(mockContext);

      expect(result.config).toEqual(mockConfig);
      expect(result.source).toBe('service');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Should now be cached
      const stats = resolver.getCacheStats();
      expect(stats.misses).toBe(1);
    });

    it('should cache Config Service response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockConfig,
      });

      await resolver.resolve(mockContext);

      // Second call should hit cache
      const result = await resolver.resolve(mockContext);

      expect(result.source).toBe('cache');
      expect(fetchMock).toHaveBeenCalledTimes(1); // Only called once
    });
  });

  describe('Config Service Error Handling', () => {
    it('should throw 404 when instance not found', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(resolver.resolve(mockContext)).rejects.toMatchObject({
        type: LookupErrorType.INSTANCE_NOT_FOUND,
        statusCode: 404,
      });
    });

    it('should throw 403 when access denied', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 403,
      });

      await expect(resolver.resolve(mockContext)).rejects.toMatchObject({
        type: LookupErrorType.ACCESS_DENIED,
        statusCode: 403,
      });
    });

    it('should throw 503 on Config Service error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(resolver.resolve(mockContext)).rejects.toMatchObject({
        type: LookupErrorType.CONFIG_SERVICE_UNAVAILABLE,
        statusCode: 503,
      });
    });

    it('should handle fetch timeout', async () => {
      fetchMock.mockImplementationOnce(() => {
        return new Promise((_, reject) => {
          setTimeout(() => {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            reject(error);
          }, 100);
        });
      });

      await expect(resolver.resolve(mockContext)).rejects.toMatchObject({
        type: LookupErrorType.CONFIG_SERVICE_UNAVAILABLE,
      });
    });

    it('should handle network errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      await expect(resolver.resolve(mockContext)).rejects.toMatchObject({
        type: LookupErrorType.CONFIG_SERVICE_UNAVAILABLE,
        statusCode: 503,
      });
    });
  });

  describe('Stale Cache Fallback', () => {
    it('should use stale cache when Config Service is down', async () => {
      // Pre-populate cache with short TTL
      const shortResolver = new InstanceResolver(kv as any, {
        config_service_url: 'https://config.example.com',
        cache_ttl: 1, // 1 second
        use_stale_on_error: true,
      });

      await shortResolver['cache'].set('production', mockConfig);

      // Wait for cache to expire
      vi.useFakeTimers();
      vi.advanceTimersByTime(2000);

      // Mock Config Service error
      fetchMock.mockRejectedValueOnce(new Error('Service down'));

      const result = await shortResolver.resolve(mockContext);

      expect(result.config).toEqual(mockConfig);
      expect(result.source).toBe('stale_cache');
      expect(result.ttl_remaining).toBe(0);

      vi.useRealTimers();
    });

    it('should not use stale cache when disabled', async () => {
      const noStaleResolver = new InstanceResolver(kv as any, {
        config_service_url: 'https://config.example.com',
        cache_ttl: 1,
        use_stale_on_error: false, // Disabled
      });

      await noStaleResolver['cache'].set('production', mockConfig);

      vi.useFakeTimers();
      vi.advanceTimersByTime(2000);

      fetchMock.mockRejectedValueOnce(new Error('Service down'));

      await expect(noStaleResolver.resolve(mockContext)).rejects.toThrow();

      vi.useRealTimers();
    });

    it('should throw error when no stale cache available', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Service down'));

      await expect(resolver.resolve(mockContext)).rejects.toMatchObject({
        type: LookupErrorType.CONFIG_SERVICE_UNAVAILABLE,
      });
    });
  });

  describe('Access Control', () => {
    it('should allow owner to access instance', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockConfig, // owner: 'user_123'
      });

      const result = await resolver.resolve(mockContext);
      expect(result.config).toEqual(mockConfig);
    });

    it('should allow admin to access any instance', async () => {
      const adminContext: LookupContext = {
        user: {
          user_id: 'admin_456',
          roles: ['admin'],
          default_instance_id: 'production',
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockConfig, // owner: 'user_123'
      });

      const result = await resolver.resolve(adminContext);
      expect(result.config).toEqual(mockConfig);
    });

    it('should deny access to non-owner non-admin', async () => {
      const otherUserContext: LookupContext = {
        user: {
          user_id: 'user_789',
          roles: ['user'],
          default_instance_id: 'production',
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockConfig, // owner: 'user_123'
      });

      await expect(resolver.resolve(otherUserContext)).rejects.toMatchObject({
        type: LookupErrorType.ACCESS_DENIED,
        statusCode: 403,
      });
    });
  });

  describe('Cache Management', () => {
    it('should invalidate specific instance cache', async () => {
      await resolver['cache'].set('production', mockConfig);

      await resolver.invalidateCache('production');

      const exists = await resolver['cache'].has('production');
      expect(exists).toBe(false);
    });

    it('should invalidate all caches', async () => {
      await resolver['cache'].set('instance-1', mockConfig);
      await resolver['cache'].set('instance-2', mockConfig);

      const count = await resolver.invalidateAllCaches();

      expect(count).toBe(2);
    });

    it('should warm cache with configs', async () => {
      const configs = [
        { ...mockConfig, instance_id: 'instance-1' },
        { ...mockConfig, instance_id: 'instance-2' },
      ];

      await resolver.warmCache(configs);

      const exists1 = await resolver['cache'].has('instance-1');
      const exists2 = await resolver['cache'].has('instance-2');

      expect(exists1).toBe(true);
      expect(exists2).toBe(true);
    });
  });

  describe('Request Headers', () => {
    it('should include user ID and request ID in Config Service call', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockConfig,
      });

      await resolver.resolve(mockContext);

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-User-ID': 'user_123',
            'X-Request-ID': 'req_123',
          }),
        })
      );
    });
  });
});
