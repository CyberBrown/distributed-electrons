/**
 * Rate Limiter Client Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  RateLimiterClient,
  getRateLimiterId,
  checkAndRecordRequest,
  type RateLimiterEnv,
} from '../../workers/shared/rate-limiter/client';
import type { RateLimitConfig } from '../../workers/shared/rate-limiter/types';

describe('Rate Limiter Client', () => {
  describe('getRateLimiterId', () => {
    it('should generate correct ID format', () => {
      const id = getRateLimiterId('production', 'ideogram');
      expect(id).toBe('instance:production:provider:ideogram');
    });

    it('should handle different instance and provider names', () => {
      const id = getRateLimiterId('staging', 'dalle');
      expect(id).toBe('instance:staging:provider:dalle');
    });
  });

  describe('RateLimiterClient', () => {
    let client: RateLimiterClient;
    let mockEnv: RateLimiterEnv;
    let mockStub: any;

    beforeEach(() => {
      mockStub = {
        fetch: vi.fn(),
      };

      mockEnv = {
        RATE_LIMITER: {
          idFromName: vi.fn().mockReturnValue('mock-id'),
          get: vi.fn().mockReturnValue(mockStub),
        } as any,
      };

      client = new RateLimiterClient(mockEnv);
    });

    describe('checkLimit', () => {
      it('should call Durable Object with correct parameters', async () => {
        const mockResult = {
          allowed: true,
          remaining: 10,
        };

        mockStub.fetch.mockResolvedValue({
          ok: true,
          json: async () => mockResult,
        });

        const config: RateLimitConfig = { rpm: 100 };
        const result = await client.checkLimit('production', 'ideogram', config);

        expect(result).toEqual(mockResult);
        expect(mockEnv.RATE_LIMITER.idFromName).toHaveBeenCalledWith(
          'instance:production:provider:ideogram'
        );
        expect(mockStub.fetch).toHaveBeenCalledWith(
          'http://limiter/check',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ config }),
          })
        );
      });

      it('should throw error on failure', async () => {
        mockStub.fetch.mockResolvedValue({
          ok: false,
          statusText: 'Internal Error',
        });

        const config: RateLimitConfig = { rpm: 100 };

        await expect(
          client.checkLimit('production', 'ideogram', config)
        ).rejects.toThrow('Rate limiter error');
      });
    });

    describe('recordRequest', () => {
      it('should record request with tokens', async () => {
        mockStub.fetch.mockResolvedValue({
          ok: true,
          json: async () => ({ success: true }),
        });

        await client.recordRequest('production', 'ideogram', 50);

        expect(mockStub.fetch).toHaveBeenCalledWith(
          'http://limiter/record',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ tokens: 50 }),
          })
        );
      });

      it('should record request without tokens', async () => {
        mockStub.fetch.mockResolvedValue({
          ok: true,
          json: async () => ({ success: true }),
        });

        await client.recordRequest('production', 'ideogram');

        expect(mockStub.fetch).toHaveBeenCalledWith(
          'http://limiter/record',
          expect.objectContaining({
            body: JSON.stringify({ tokens: 0 }),
          })
        );
      });
    });

    describe('reset', () => {
      it('should reset rate limiter', async () => {
        mockStub.fetch.mockResolvedValue({
          ok: true,
          json: async () => ({ success: true }),
        });

        await client.reset('production', 'ideogram');

        expect(mockStub.fetch).toHaveBeenCalledWith(
          'http://limiter/reset',
          expect.objectContaining({
            method: 'POST',
          })
        );
      });
    });

    describe('getStats', () => {
      it('should retrieve statistics', async () => {
        const mockStats = {
          total_requests: 5,
          total_tokens: 250,
        };

        mockStub.fetch.mockResolvedValue({
          ok: true,
          json: async () => mockStats,
        });

        const stats = await client.getStats('production', 'ideogram');

        expect(stats).toEqual(mockStats);
        expect(mockStub.fetch).toHaveBeenCalledWith(
          'http://limiter/stats',
          expect.objectContaining({
            method: 'GET',
          })
        );
      });
    });
  });

  describe('checkAndRecordRequest', () => {
    it('should check and record when allowed', async () => {
      const mockStub = {
        fetch: vi.fn(),
      };

      const mockEnv: RateLimiterEnv = {
        RATE_LIMITER: {
          idFromName: vi.fn().mockReturnValue('mock-id'),
          get: vi.fn().mockReturnValue(mockStub),
        } as any,
      };

      // First call: check (allowed)
      // Second call: record
      mockStub.fetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ allowed: true, remaining: 10 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        });

      const config: RateLimitConfig = { rpm: 100 };
      const result = await checkAndRecordRequest(
        mockEnv,
        'production',
        'ideogram',
        config,
        50
      );

      expect(result.allowed).toBe(true);
      expect(mockStub.fetch).toHaveBeenCalledTimes(2);
    });

    it('should not record when not allowed', async () => {
      const mockStub = {
        fetch: vi.fn(),
      };

      const mockEnv: RateLimiterEnv = {
        RATE_LIMITER: {
          idFromName: vi.fn().mockReturnValue('mock-id'),
          get: vi.fn().mockReturnValue(mockStub),
        } as any,
      };

      mockStub.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          allowed: false,
          retry_after: 30,
        }),
      });

      const config: RateLimitConfig = { rpm: 100 };
      const result = await checkAndRecordRequest(
        mockEnv,
        'production',
        'ideogram',
        config
      );

      expect(result.allowed).toBe(false);
      // Should only call check, not record
      expect(mockStub.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
