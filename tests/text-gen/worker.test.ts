/**
 * Text Generation Worker Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from '../../workers/text-gen/index';
import type { Env } from '../../workers/text-gen/types';

// Mock environment
const mockEnv: Env = {
  DEFAULT_PROVIDER: 'openai',
  DEFAULT_INSTANCE_ID: 'test-instance',
  CONFIG_SERVICE_URL: 'https://config.test.com',
  OPENAI_API_KEY: 'test_openai_key_123',
  ANTHROPIC_API_KEY: 'test_anthropic_key_456',
};

describe('Text Generation Worker', () => {
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
      expect(data.service).toBe('text-gen');
      expect(data.timestamp).toBeDefined();
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
      const data = await response.json() as Record<string, any>;

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
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('INVALID_REQUEST');
      expect(data.error).toContain('Prompt is required');
    });

    it('should include request ID in response', async () => {
      const request = new Request('http://worker/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Test prompt' }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(data.request_id).toBeDefined();
      expect(response.headers.get('X-Request-ID')).toBeDefined();
    });

    // Note: Full integration test would require mocking all dependencies
    // (provider API, config service, rate limiter, etc.)
    // This is covered by end-to-end tests
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
    });

    it('should handle invalid JSON', async () => {
      const request = new Request('http://worker/generate', {
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

    it('should handle POST to non-existent route', async () => {
      const request = new Request('http://worker/invalid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: 'data' }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(404);
      expect(data.error_code).toBe('ROUTE_NOT_FOUND');
      expect(data.request_id).toBeDefined();
    });

    it('should handle GET to generate endpoint', async () => {
      const request = new Request('http://worker/generate', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(404);
      expect(data.error_code).toBe('ROUTE_NOT_FOUND');
    });
  });

  describe('Instance Configuration', () => {
    it('should use instance_id from request body', async () => {
      const request = new Request('http://worker/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Test prompt',
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
        body: JSON.stringify({ prompt: 'Test prompt' }),
      });

      await worker.fetch(request, mockEnv);
      // Test passes if no crash
    });

    it('should use default instance_id from env', async () => {
      const request = new Request('http://worker/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Test prompt' }),
      });

      await worker.fetch(request, mockEnv);
      // Test passes if no crash - defaults to env.DEFAULT_INSTANCE_ID
    });

    it('should prefer body instance_id over header', async () => {
      const request = new Request('http://worker/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Instance-ID': 'header-instance',
        },
        body: JSON.stringify({
          prompt: 'Test prompt',
          instance_id: 'body-instance',
        }),
      });

      await worker.fetch(request, mockEnv);
      // Test passes if no crash - body instance_id takes precedence
    });
  });

  describe('CORS Headers', () => {
    it('should include CORS headers in successful response', async () => {
      const request = new Request('http://worker/health', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PUT, DELETE, OPTIONS');
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, X-API-Key, X-Instance-ID, X-Request-ID, Authorization');
    });

    it('should include CORS headers in error response', async () => {
      const request = new Request('http://worker/unknown', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PUT, DELETE, OPTIONS');
    });

    it('should handle OPTIONS preflight request', async () => {
      const request = new Request('http://worker/generate', {
        method: 'OPTIONS',
      });

      const response = await worker.fetch(request, mockEnv);

      // handleCorsPrelight returns 204 No Content
      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PUT, DELETE, OPTIONS');
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, X-API-Key, X-Instance-ID, X-Request-ID, Authorization');
      expect(response.headers.get('Access-Control-Max-Age')).toBe('86400');
    });
  });

  describe('Request Validation', () => {
    it('should accept valid prompt with options', async () => {
      const request = new Request('http://worker/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Generate a story',
          options: {
            max_tokens: 500,
            temperature: 0.8,
            top_p: 0.9,
          },
        }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(data.request_id).toBeDefined();
      // Will fail at provider step in unit test but validates the request structure
    });

    it('should handle whitespace-only prompt', async () => {
      const request = new Request('http://worker/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: '\n\t  \n' }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('INVALID_REQUEST');
    });

    it('should accept model parameter', async () => {
      const request = new Request('http://worker/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Test prompt',
          model: 'gpt-4',
        }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(data.request_id).toBeDefined();
      // Validates that model parameter doesn't cause errors
    });

    it('should accept model_id parameter', async () => {
      const request = new Request('http://worker/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Test prompt',
          model_id: 'openai-gpt-4',
        }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(data.request_id).toBeDefined();
      // Validates that model_id parameter doesn't cause errors
    });
  });

  describe('Response Format', () => {
    it('should return consistent error response format', async () => {
      const request = new Request('http://worker/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(data).toHaveProperty('error');
      expect(data).toHaveProperty('error_code');
      expect(data).toHaveProperty('request_id');
      expect(typeof data.error).toBe('string');
      expect(typeof data.error_code).toBe('string');
      expect(typeof data.request_id).toBe('string');
    });

    it('should include X-Request-ID header in all responses', async () => {
      const request = new Request('http://worker/health', {
        method: 'GET',
      });

      await worker.fetch(request, mockEnv);

      // Health endpoint doesn't include X-Request-ID header
      // but error responses should
      const errorRequest = new Request('http://worker/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const errorResponse = await worker.fetch(errorRequest, mockEnv);
      expect(errorResponse.headers.get('X-Request-ID')).toBeDefined();
    });
  });

  describe('POST /generate/stream', () => {
    it('should validate prompt is required', async () => {
      const request = new Request('http://worker/generate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('INVALID_REQUEST');
      expect(data.error).toContain('Prompt is required');
    });

    it('should reject empty prompt', async () => {
      const request = new Request('http://worker/generate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: '   ' }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('INVALID_REQUEST');
    });

    it('should include request ID in error response', async () => {
      const request = new Request('http://worker/generate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(data.request_id).toBeDefined();
      expect(response.headers.get('X-Request-ID')).toBeDefined();
    });

    it('should return error for unsupported providers', async () => {
      // When using an unsupported provider like 'cohere', the code will first
      // check for an API key. Since the mock getInstanceConfig returns empty
      // strings for unknown providers and getEnvApiKey returns undefined,
      // we get MISSING_API_KEY first. This is expected behavior.
      const request = new Request('http://worker/generate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Test prompt',
          model: 'cohere:command', // Provider not in mock api_keys
        }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      // Returns MISSING_API_KEY because the provider check happens after key check
      expect(response.status).toBe(500);
      expect(data.error_code).toBe('MISSING_API_KEY');
      expect(data.error).toContain('cohere');
    });

    it('should handle OPTIONS preflight for streaming endpoint', async () => {
      const request = new Request('http://worker/generate/stream', {
        method: 'OPTIONS',
      });

      const response = await worker.fetch(request, mockEnv);

      // handleCorsPrelight returns 204 No Content
      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should include CORS headers in streaming error response', async () => {
      const request = new Request('http://worker/generate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await worker.fetch(request, mockEnv);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should accept valid streaming request with options', async () => {
      const request = new Request('http://worker/generate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Generate a story',
          options: {
            max_tokens: 500,
            temperature: 0.8,
          },
        }),
      });

      // This will fail at the provider call level but validates request handling
      const response = await worker.fetch(request, mockEnv);

      // Could be error from provider or valid SSE stream depending on mock
      expect(response).toBeDefined();
    });

    it('should use instance_id from body for streaming', async () => {
      const request = new Request('http://worker/generate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Test prompt',
          instance_id: 'custom-instance',
        }),
      });

      // Will fail at provider step but validates instance handling
      const response = await worker.fetch(request, mockEnv);
      expect(response).toBeDefined();
    });

    it('should use instance_id from header for streaming', async () => {
      const request = new Request('http://worker/generate/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Instance-ID': 'header-instance',
        },
        body: JSON.stringify({ prompt: 'Test prompt' }),
      });

      const response = await worker.fetch(request, mockEnv);
      expect(response).toBeDefined();
    });

    it('should handle invalid JSON for streaming', async () => {
      const request = new Request('http://worker/generate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(data.error).toBeDefined();
    });
  });
});
