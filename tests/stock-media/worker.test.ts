/**
 * Stock Media Worker Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from '../../workers/stock-media/index';
import type { Env } from '../../workers/stock-media/types';

// Mock environment
const mockEnv: Env = {
  DEFAULT_INSTANCE_ID: 'test-instance',
  PEXELS_API_KEY: 'test_pexels_key_123',
};

describe('Stock Media Worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const request = new Request('http://worker/health', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(200);
      expect(data.status).toBe('healthy');
      expect(data.service).toBe('stock-media');
      expect(data.timestamp).toBeDefined();
    });

    it('should include CORS headers', async () => {
      const request = new Request('http://worker/health', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
    });
  });

  describe('POST /search', () => {
    it('should validate keywords are required', async () => {
      const request = new Request('http://worker/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('INVALID_REQUEST');
      expect(data.error).toContain('Keywords are required');
    });

    it('should reject empty keywords array', async () => {
      const request = new Request('http://worker/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: [] }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('INVALID_REQUEST');
      expect(data.error).toContain('Keywords are required');
    });

    it('should include request ID in response', async () => {
      const request = new Request('http://worker/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: ['nature', 'sunset'] }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(data.request_id).toBeDefined();
      expect(response.headers.get('X-Request-ID')).toBeDefined();
      expect(response.headers.get('X-Request-ID')).toBe(data.request_id);
    });

    it('should handle missing API key', async () => {
      const envWithoutKey: Env = {
        DEFAULT_INSTANCE_ID: 'test-instance',
      };

      const request = new Request('http://worker/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: ['nature'] }),
      });

      const response = await worker.fetch(request, envWithoutKey);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(500);
      expect(data.error_code).toBe('MISSING_API_KEY');
      expect(data.error).toContain('Pexels API key not configured');
    });

    // Note: Full integration test would require mocking Pexels API
    // This is covered by end-to-end tests
  });

  describe('POST /search/videos', () => {
    it('should validate keywords are required', async () => {
      const request = new Request('http://worker/search/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('INVALID_REQUEST');
      expect(data.error).toContain('Keywords are required');
    });

    it('should reject empty keywords array', async () => {
      const request = new Request('http://worker/search/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: [] }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('INVALID_REQUEST');
    });

    it('should include request ID in response', async () => {
      const request = new Request('http://worker/search/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: ['ocean', 'waves'] }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(data.request_id).toBeDefined();
      expect(response.headers.get('X-Request-ID')).toBeDefined();
    });

    it('should handle missing API key', async () => {
      const envWithoutKey: Env = {
        DEFAULT_INSTANCE_ID: 'test-instance',
      };

      const request = new Request('http://worker/search/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: ['ocean'] }),
      });

      const response = await worker.fetch(request, envWithoutKey);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(500);
      expect(data.error_code).toBe('MISSING_API_KEY');
    });
  });

  describe('POST /search/photos', () => {
    it('should validate keywords are required', async () => {
      const request = new Request('http://worker/search/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('INVALID_REQUEST');
      expect(data.error).toContain('Keywords are required');
    });

    it('should reject empty keywords array', async () => {
      const request = new Request('http://worker/search/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: [] }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('INVALID_REQUEST');
    });

    it('should include request ID in response', async () => {
      const request = new Request('http://worker/search/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: ['mountain', 'landscape'] }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(data.request_id).toBeDefined();
      expect(response.headers.get('X-Request-ID')).toBeDefined();
    });

    it('should handle missing API key', async () => {
      const envWithoutKey: Env = {
        DEFAULT_INSTANCE_ID: 'test-instance',
      };

      const request = new Request('http://worker/search/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: ['mountain'] }),
      });

      const response = await worker.fetch(request, envWithoutKey);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(500);
      expect(data.error_code).toBe('MISSING_API_KEY');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const request = new Request('http://worker/unknown', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(404);
      expect(data.error_code).toBe('ROUTE_NOT_FOUND');
      expect(data.error).toBe('Not Found');
      expect(data.request_id).toBeDefined();
    });

    it('should handle invalid JSON', async () => {
      const request = new Request('http://worker/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(data.error).toBeDefined();
      expect(data.request_id).toBeDefined();
    });

    it('should include CORS headers on error responses', async () => {
      const request = new Request('http://worker/unknown', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('CORS Handling', () => {
    it('should handle OPTIONS preflight request', async () => {
      const request = new Request('http://worker/search', {
        method: 'OPTIONS',
      });

      const response = await worker.fetch(request, mockEnv);

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
      expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
      expect(response.headers.get('Access-Control-Max-Age')).toBe('86400');
    });

    it('should include CORS headers on all responses', async () => {
      const request = new Request('http://worker/health', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
    });
  });

  describe('Pagination and Filter Options', () => {
    it('should accept pagination parameters', async () => {
      const request = new Request('http://worker/search/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: ['nature'],
          options: {
            per_page: 20,
            page: 2,
          },
        }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      // Should not fail with pagination params
      expect(data.request_id).toBeDefined();
    });

    it('should accept orientation filter', async () => {
      const request = new Request('http://worker/search/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: ['landscape'],
          orientation: 'landscape',
        }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(data.request_id).toBeDefined();
    });

    it('should accept size filter', async () => {
      const request = new Request('http://worker/search/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: ['portrait'],
          size: 'large',
        }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(data.request_id).toBeDefined();
    });

    it('should accept dimension filters', async () => {
      const request = new Request('http://worker/search/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: ['city'],
          options: {
            min_width: 1920,
            min_height: 1080,
          },
        }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(data.request_id).toBeDefined();
    });

    it('should accept duration filters', async () => {
      const request = new Request('http://worker/search/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: ['ocean'],
          options: {
            min_duration: 5,
            max_duration: 30,
          },
        }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(data.request_id).toBeDefined();
    });
  });

  describe('Instance Configuration', () => {
    it('should accept instance_id from request body', async () => {
      const request = new Request('http://worker/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: ['test'],
          instance_id: 'custom-instance',
        }),
      });

      // Response will fail at Pexels API step, but we can verify instance handling
      await worker.fetch(request, mockEnv);

      // Test passes if no crash - actual instance handling tested in integration
    });

    it('should accept project_id from request body', async () => {
      const request = new Request('http://worker/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: ['test'],
          project_id: 'project-123',
        }),
      });

      await worker.fetch(request, mockEnv);
      // Test passes if no crash
    });
  });

  describe('Request ID Tracking', () => {
    it('should generate unique request IDs', async () => {
      const request1 = new Request('http://worker/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: ['test1'] }),
      });

      const request2 = new Request('http://worker/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: ['test2'] }),
      });

      const response1 = await worker.fetch(request1, mockEnv);
      const response2 = await worker.fetch(request2, mockEnv);

      const data1 = await response1.json() as Record<string, any>;
      const data2 = await response2.json() as Record<string, any>;

      expect(data1.request_id).toBeDefined();
      expect(data2.request_id).toBeDefined();
      expect(data1.request_id).not.toBe(data2.request_id);
    });

    it('should include request ID in error responses', async () => {
      const request = new Request('http://worker/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(400);
      expect(data.request_id).toBeDefined();
      expect(response.headers.get('X-Request-ID')).toBe(data.request_id);
    });
  });
});
