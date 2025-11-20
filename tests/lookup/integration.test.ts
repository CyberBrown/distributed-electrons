/**
 * Integration Tests for Instance Lookup
 *
 * Tests end-to-end scenarios including cache, resolver, and Config Service.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveInstance } from '../../infrastructure/lookup/instance-resolver';
import {
  InstanceConfig,
  LookupContext,
  LookupErrorType,
} from '../../infrastructure/lookup/types';

// Mock KV namespace
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

describe('Instance Lookup Integration', () => {
  let kv: MockKVNamespace;
  let fetchMock: any;

  const mockConfig: InstanceConfig = {
    instance_id: 'production',
    api_keys: {
      ideogram: 'ideo_key_production_xyz',
      openai: 'sk-prod-abc123',
    },
    rate_limits: {
      ideogram: { rpm: 500, daily: 10000 },
      openai: { rpm: 3500, daily: 100000 },
    },
    worker_urls: {
      image_gen: 'https://image-gen.workers.dev',
      text_gen: 'https://text-gen.workers.dev',
    },
    r2_bucket: 'prod-media-bucket',
    metadata: {
      name: 'Production Instance',
      owner: 'user_123',
      created_at: '2024-01-01T00:00:00Z',
    },
    features: {
      beta_features: false,
      advanced_image_gen: true,
    },
  };

  beforeEach(() => {
    kv = new MockKVNamespace();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  describe('Complete Flow', () => {
    it('should resolve instance from Config Service and cache it', async () => {
      const context: LookupContext = {
        user: {
          user_id: 'user_123',
          email: 'user@example.com',
          roles: ['user'],
        },
        instance_id: 'production',
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockConfig,
      });

      // First call - should fetch from Config Service
      const config1 = await resolveInstance(kv as any, context, {
        config_service_url: 'https://config.example.com',
      });

      expect(config1).toEqual(mockConfig);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Second call - should hit cache
      const config2 = await resolveInstance(kv as any, context, {
        config_service_url: 'https://config.example.com',
      });

      expect(config2).toEqual(mockConfig);
      expect(fetchMock).toHaveBeenCalledTimes(1); // Still only 1 call
    });

    it('should handle request with X-Instance-ID header', async () => {
      const context: LookupContext = {
        user: {
          user_id: 'user_123',
        },
        instance_id: 'staging', // From X-Instance-ID header
        request_metadata: {
          request_id: 'req_xyz',
          ip: '192.168.1.1',
          user_agent: 'Mozilla/5.0',
        },
      };

      const stagingConfig = {
        ...mockConfig,
        instance_id: 'staging',
        r2_bucket: 'staging-bucket',
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => stagingConfig,
      });

      const config = await resolveInstance(kv as any, context, {
        config_service_url: 'https://config.example.com',
      });

      expect(config.instance_id).toBe('staging');
      expect(config.r2_bucket).toBe('staging-bucket');
    });

    it('should handle request with project_id (fallback to default)', async () => {
      const context: LookupContext = {
        user: {
          user_id: 'user_123',
          default_instance_id: 'production',
        },
        project_id: 'proj_123', // Would normally map to instance
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockConfig,
      });

      const config = await resolveInstance(kv as any, context, {
        config_service_url: 'https://config.example.com',
      });

      expect(config.instance_id).toBe('production');
    });
  });

  describe('Error Scenarios', () => {
    it('should handle instance not found (404)', async () => {
      const context: LookupContext = {
        user: {
          user_id: 'user_123',
        },
        instance_id: 'nonexistent',
      };

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(
        resolveInstance(kv as any, context, {
          config_service_url: 'https://config.example.com',
        })
      ).rejects.toMatchObject({
        type: LookupErrorType.INSTANCE_NOT_FOUND,
        statusCode: 404,
      });
    });

    it('should handle access denied (403)', async () => {
      const context: LookupContext = {
        user: {
          user_id: 'unauthorized_user',
        },
        instance_id: 'production',
      };

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 403,
      });

      await expect(
        resolveInstance(kv as any, context, {
          config_service_url: 'https://config.example.com',
        })
      ).rejects.toMatchObject({
        type: LookupErrorType.ACCESS_DENIED,
        statusCode: 403,
      });
    });

    it('should handle Config Service down with stale cache fallback', async () => {
      const context: LookupContext = {
        user: {
          user_id: 'user_123',
        },
        instance_id: 'production',
      };

      // First call - populate cache
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockConfig,
      });

      await resolveInstance(kv as any, context, {
        config_service_url: 'https://config.example.com',
        cache_ttl: 1, // Short TTL
      });

      // Wait for cache to expire
      vi.useFakeTimers();
      vi.advanceTimersByTime(2000);

      // Config Service is now down
      fetchMock.mockRejectedValueOnce(new Error('Service unavailable'));

      // Should fallback to stale cache
      const config = await resolveInstance(kv as any, context, {
        config_service_url: 'https://config.example.com',
        cache_ttl: 1,
        use_stale_on_error: true,
      });

      expect(config).toEqual(mockConfig);

      vi.useRealTimers();
    });

    it('should fail when Config Service down and no stale cache', async () => {
      const context: LookupContext = {
        user: {
          user_id: 'user_123',
        },
        instance_id: 'production',
      };

      fetchMock.mockRejectedValueOnce(new Error('Service unavailable'));

      await expect(
        resolveInstance(kv as any, context, {
          config_service_url: 'https://config.example.com',
          use_stale_on_error: true,
        })
      ).rejects.toMatchObject({
        type: LookupErrorType.CONFIG_SERVICE_UNAVAILABLE,
      });
    });
  });

  describe('Real-World Usage Patterns', () => {
    it('should handle rapid successive requests (cache efficiency)', async () => {
      const context: LookupContext = {
        user: {
          user_id: 'user_123',
        },
        instance_id: 'production',
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockConfig,
      });

      // Simulate 10 rapid requests
      const promises = Array(10)
        .fill(null)
        .map(() =>
          resolveInstance(kv as any, context, {
            config_service_url: 'https://config.example.com',
          })
        );

      const results = await Promise.all(promises);

      // All should return the same config
      results.forEach((config) => {
        expect(config).toEqual(mockConfig);
      });

      // Config Service should only be called once
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should handle different instances for different users', async () => {
      const user1Config = { ...mockConfig, instance_id: 'user1-instance' };
      const user2Config = { ...mockConfig, instance_id: 'user2-instance' };

      const context1: LookupContext = {
        user: { user_id: 'user_1' },
        instance_id: 'user1-instance',
      };

      const context2: LookupContext = {
        user: { user_id: 'user_2' },
        instance_id: 'user2-instance',
      };

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => user1Config,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => user2Config,
        });

      const config1 = await resolveInstance(kv as any, context1, {
        config_service_url: 'https://config.example.com',
      });

      const config2 = await resolveInstance(kv as any, context2, {
        config_service_url: 'https://config.example.com',
      });

      expect(config1.instance_id).toBe('user1-instance');
      expect(config2.instance_id).toBe('user2-instance');
    });

    it('should provide full configuration for worker routing', async () => {
      const context: LookupContext = {
        user: {
          user_id: 'user_123',
        },
        instance_id: 'production',
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockConfig,
      });

      const config = await resolveInstance(kv as any, context, {
        config_service_url: 'https://config.example.com',
      });

      // Verify all required fields for worker routing
      expect(config.worker_urls).toHaveProperty('image_gen');
      expect(config.worker_urls).toHaveProperty('text_gen');
      expect(config.api_keys).toHaveProperty('ideogram');
      expect(config.api_keys).toHaveProperty('openai');
      expect(config.rate_limits).toHaveProperty('ideogram');
      expect(config.r2_bucket).toBe('prod-media-bucket');
    });
  });
});
