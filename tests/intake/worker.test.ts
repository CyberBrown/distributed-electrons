/**
 * Tests for Intake Worker
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock environment
const createMockEnv = () => ({
  DB: {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        run: vi.fn().mockResolvedValue({ success: true }),
        first: vi.fn().mockResolvedValue(null),
      }),
    }),
  },
  REQUEST_ROUTER: {
    idFromName: vi.fn().mockReturnValue('router-id'),
    get: vi.fn().mockReturnValue({
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          success: true,
          request_id: 'test-id',
          status: 'queued',
          queue_position: 1,
          estimated_wait_ms: 5000,
        }))
      ),
    }),
  },
  RATE_LIMITER: {
    idFromName: vi.fn().mockReturnValue('limiter-id'),
    get: vi.fn().mockReturnValue({
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ allowed: true, remaining: 99 }))
      ),
    }),
  },
  CONFIG_SERVICE_URL: 'https://api.distributedelectrons.com',
  DEFAULT_INSTANCE_ID: 'default',
  DE_WORKFLOWS_URL: 'https://de-workflows.solamp.workers.dev',
  PASSPHRASE: 'test-passphrase',
});

// Mock ExecutionContext
const createMockCtx = () => ({
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
});

// Import worker after mocks
import worker from '../../workers/intake/index';

describe('Intake Worker', () => {
  let mockEnv: ReturnType<typeof createMockEnv>;
  let mockCtx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    mockEnv = createMockEnv();
    mockCtx = createMockCtx();
    vi.clearAllMocks();
  });

  describe('Health endpoint', () => {
    it('should return healthy status', async () => {
      const request = new Request('https://intake.test/health', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv as any, mockCtx as any);
      const data = await response.json() as Record<string, any> as any;

      expect(response.status).toBe(200);
      expect(data.status).toBe('healthy');
      expect(data.service).toBe('intake');
      expect(data.timestamp).toBeDefined();
    });
  });

  describe('CORS', () => {
    it('should handle OPTIONS preflight request', async () => {
      const request = new Request('https://intake.test/intake', {
        method: 'OPTIONS',
      });

      const response = await worker.fetch(request, mockEnv as any, mockCtx as any);

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    it('should include CORS headers on all responses', async () => {
      const request = new Request('https://intake.test/health', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv as any, mockCtx as any);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('POST /intake', () => {
    it('should accept valid intake request', async () => {
      const request = new Request('https://intake.test/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'Generate an image of a cat',
          app_id: 'test-app',
        }),
      });

      const response = await worker.fetch(request, mockEnv as any, mockCtx as any);
      const data = await response.json() as Record<string, any> as any;

      expect(response.status).toBe(202);
      expect(data.success).toBe(true);
      expect(data.request_id).toBeDefined();
      expect(data.status).toBe('queued');
      expect(data.queue_position).toBeDefined();
    });

    it('should reject request without query', async () => {
      const request = new Request('https://intake.test/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: 'test-app',
        }),
      });

      const response = await worker.fetch(request, mockEnv as any, mockCtx as any);
      const data = await response.json() as Record<string, any> as any;

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('MISSING_QUERY');
    });

    it('should reject empty query', async () => {
      const request = new Request('https://intake.test/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: '   ',
          app_id: 'test-app',
        }),
      });

      const response = await worker.fetch(request, mockEnv as any, mockCtx as any);
      const data = await response.json() as Record<string, any> as any;

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('MISSING_QUERY');
    });

    it('should reject invalid JSON', async () => {
      const request = new Request('https://intake.test/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      });

      const response = await worker.fetch(request, mockEnv as any, mockCtx as any);
      const data = await response.json() as Record<string, any> as any;

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('INVALID_JSON');
    });

    it('should use X-App-ID header if app_id not in body', async () => {
      const request = new Request('https://intake.test/intake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-ID': 'header-app-id',
        },
        body: JSON.stringify({
          query: 'Test query',
        }),
      });

      const response = await worker.fetch(request, mockEnv as any, mockCtx as any);

      expect(response.status).toBe(202);
      // Verify D1 was called with the header app_id
      expect(mockEnv.DB.prepare).toHaveBeenCalled();
    });

    it('should use X-Instance-ID header if instance_id not in body', async () => {
      const request = new Request('https://intake.test/intake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Instance-ID': 'header-instance-id',
        },
        body: JSON.stringify({
          query: 'Test query',
          app_id: 'test-app',
        }),
      });

      const response = await worker.fetch(request, mockEnv as any, mockCtx as any);

      expect(response.status).toBe(202);
    });

    it('should accept optional fields', async () => {
      const request = new Request('https://intake.test/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'Generate text',
          app_id: 'test-app',
          task_type: 'text',
          provider: 'anthropic',
          model: 'claude-3-5-sonnet',
          priority: 5,
          callback_url: 'https://example.com/callback',
          metadata: { custom: 'data' },
        }),
      });

      const response = await worker.fetch(request, mockEnv as any, mockCtx as any);
      const data = await response.json() as Record<string, any> as any;

      expect(response.status).toBe(202);
      expect(data.success).toBe(true);
    });

    it('should include X-Request-ID header', async () => {
      const request = new Request('https://intake.test/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'Test query',
          app_id: 'test-app',
        }),
      });

      const response = await worker.fetch(request, mockEnv as any, mockCtx as any);

      expect(response.headers.get('X-Request-ID')).toBeDefined();
    });

    it('should handle router errors gracefully', async () => {
      mockEnv.REQUEST_ROUTER.get = vi.fn().mockReturnValue({
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify({
            success: false,
            error: 'Router is overloaded',
          }))
        ),
      });

      const request = new Request('https://intake.test/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'Test query',
          app_id: 'test-app',
        }),
      });

      const response = await worker.fetch(request, mockEnv as any, mockCtx as any);
      const data = await response.json() as Record<string, any> as any;

      expect(response.status).toBe(500);
      expect(data.error_code).toBe('ROUTER_ERROR');
    });
  });

  describe('GET /status', () => {
    it('should return status for existing request', async () => {
      mockEnv.DB.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: 'test-request-id',
            app_id: 'test-app',
            status: 'queued',
            queue_position: 3,
            task_type: 'text',
            provider: 'anthropic',
            model: 'claude-3-5-sonnet',
            error_message: null,
            created_at: '2025-12-13T00:00:00Z',
            queued_at: '2025-12-13T00:00:01Z',
            started_at: null,
            completed_at: null,
          }),
        }),
      });

      const request = new Request('https://intake.test/status?request_id=test-request-id', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv as any, mockCtx as any);
      const data = await response.json() as Record<string, any> as any;

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.request_id).toBe('test-request-id');
      expect(data.status).toBe('queued');
    });

    it('should require request_id parameter', async () => {
      const request = new Request('https://intake.test/status', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv as any, mockCtx as any);
      const data = await response.json() as Record<string, any> as any;

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('MISSING_PARAM');
    });

    it('should return 404 for non-existent request', async () => {
      mockEnv.DB.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null),
        }),
      });

      const request = new Request('https://intake.test/status?request_id=nonexistent', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv as any, mockCtx as any);
      const data = await response.json() as Record<string, any> as any;

      expect(response.status).toBe(404);
      expect(data.error_code).toBe('NOT_FOUND');
    });
  });

  describe('POST /cancel', () => {
    it('should cancel pending request', async () => {
      mockEnv.DB.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: 'test-request-id',
            status: 'queued',
          }),
          run: vi.fn().mockResolvedValue({ success: true }),
        }),
      });

      const request = new Request('https://intake.test/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: 'test-request-id' }),
      });

      const response = await worker.fetch(request, mockEnv as any, mockCtx as any);
      const data = await response.json() as Record<string, any> as any;

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.status).toBe('cancelled');
    });

    it('should reject cancel without request_id', async () => {
      const request = new Request('https://intake.test/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await worker.fetch(request, mockEnv as any, mockCtx as any);
      const data = await response.json() as Record<string, any> as any;

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('MISSING_PARAM');
    });

    it('should reject cancel for non-existent request', async () => {
      mockEnv.DB.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null),
        }),
      });

      const request = new Request('https://intake.test/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: 'nonexistent' }),
      });

      const response = await worker.fetch(request, mockEnv as any, mockCtx as any);
      const data = await response.json() as Record<string, any> as any;

      expect(response.status).toBe(404);
      expect(data.error_code).toBe('NOT_FOUND');
    });

    it('should reject cancel for processing request', async () => {
      mockEnv.DB.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: 'test-request-id',
            status: 'processing',
          }),
        }),
      });

      const request = new Request('https://intake.test/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: 'test-request-id' }),
      });

      const response = await worker.fetch(request, mockEnv as any, mockCtx as any);
      const data = await response.json() as Record<string, any> as any;

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('INVALID_STATUS');
    });
  });

  describe('Unknown routes', () => {
    it('should return 404 for unknown paths', async () => {
      const request = new Request('https://intake.test/unknown', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv as any, mockCtx as any);
      const data = await response.json() as Record<string, any> as any;

      expect(response.status).toBe(404);
      expect(data.error_code).toBe('ROUTE_NOT_FOUND');
    });
  });
});
