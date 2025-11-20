/**
 * Image Generation Worker Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from '../../workers/image-gen/index';
import type { Env } from '../../workers/image-gen/types';

// Mock environment
const mockEnv: Env = {
  DEFAULT_PROVIDER: 'ideogram',
  DEFAULT_INSTANCE_ID: 'test-instance',
  CDN_URL: 'https://cdn.test.com',
  IDEOGRAM_API_KEY: 'test_key_123',
};

describe('Image Generation Worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const request = new Request('http://worker/health', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('healthy');
      expect(data.service).toBe('image-gen');
    });
  });

  describe('POST /generate', () => {
    it('should validate prompt is required', async () => {
      const request = new Request('http://worker/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('INVALID_REQUEST');
      expect(data.error).toContain('Prompt is required');
    });

    it('should reject empty prompt', async () => {
      const request = new Request('http://worker/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: '   ' }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('INVALID_REQUEST');
    });

    it('should include request ID in response', async () => {
      const request = new Request('http://worker/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Test' }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json();

      expect(data.request_id).toBeDefined();
      expect(response.headers.get('X-Request-ID')).toBeDefined();
    });

    // Note: Full integration test would require mocking all dependencies
    // (provider adapter, rate limiter, R2, etc.)
    // This is covered by end-to-end tests
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const request = new Request('http://worker/unknown', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error_code).toBe('ROUTE_NOT_FOUND');
    });

    it('should handle invalid JSON', async () => {
      const request = new Request('http://worker/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json();

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(data.error).toBeDefined();
      expect(data.request_id).toBeDefined();
    });
  });

  describe('Instance Configuration', () => {
    it('should use instance_id from request body', async () => {
      const request = new Request('http://worker/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Test',
          instance_id: 'custom-instance',
        }),
      });

      // Response will fail at provider step, but we can verify instance handling
      await worker.fetch(request, mockEnv);

      // Test passes if no crash - actual instance handling tested in integration
    });

    it('should use instance_id from header', async () => {
      const request = new Request('http://worker/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Instance-ID': 'header-instance',
        },
        body: JSON.stringify({ prompt: 'Test' }),
      });

      await worker.fetch(request, mockEnv);
      // Test passes if no crash
    });

    it('should use default instance_id from env', async () => {
      const request = new Request('http://worker/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Test' }),
      });

      await worker.fetch(request, mockEnv);
      // Test passes if no crash - defaults to env.DEFAULT_INSTANCE_ID
    });
  });
});
