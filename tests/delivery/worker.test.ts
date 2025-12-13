/**
 * Tests for Delivery Worker
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
        new Response(JSON.stringify({ success: true }))
      ),
    }),
  },
  DELIVERABLES_STORAGE: {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
  },
  CONFIG_SERVICE_URL: 'https://api.distributedelectrons.com',
});

// Import worker after mocks
import worker from '../../workers/delivery/index';

describe('Delivery Worker', () => {
  let mockEnv: ReturnType<typeof createMockEnv>;

  beforeEach(() => {
    mockEnv = createMockEnv();
    vi.clearAllMocks();
  });

  describe('Health endpoint', () => {
    it('should return healthy status', async () => {
      const request = new Request('https://delivery.test/health', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.status).toBe('healthy');
      expect(data.service).toBe('delivery');
    });
  });

  describe('CORS', () => {
    it('should handle OPTIONS preflight request', async () => {
      const request = new Request('https://delivery.test/deliver', {
        method: 'OPTIONS',
      });

      const response = await worker.fetch(request, mockEnv as any);

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should include CORS headers on all responses', async () => {
      const request = new Request('https://delivery.test/health', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv as any);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('POST /deliver', () => {
    beforeEach(() => {
      // Mock existing request
      mockEnv.DB.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: 'test-request-id',
            status: 'processing',
            callback_url: null,
          }),
          run: vi.fn().mockResolvedValue({ success: true }),
        }),
      });
    });

    it('should accept successful delivery', async () => {
      const request = new Request('https://delivery.test/deliver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: 'test-request-id',
          success: true,
          content_type: 'text',
          content: 'This is the generated text response',
        }),
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.deliverable_id).toBeDefined();
      expect(data.quality_score).toBeDefined();
    });

    it('should handle failed delivery', async () => {
      const request = new Request('https://delivery.test/deliver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: 'test-request-id',
          success: false,
          content_type: 'text',
          content: '',
          error: 'Provider timeout',
        }),
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.status).toBe('failed');
    });

    it('should reject delivery without request_id', async () => {
      const request = new Request('https://delivery.test/deliver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          content_type: 'text',
          content: 'Test content',
        }),
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as any;

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('MISSING_FIELD');
    });

    it('should reject delivery for non-existent request', async () => {
      mockEnv.DB.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null),
        }),
      });

      const request = new Request('https://delivery.test/deliver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: 'nonexistent',
          success: true,
          content_type: 'text',
          content: 'Test content',
        }),
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as any;

      expect(response.status).toBe(404);
      expect(data.error_code).toBe('NOT_FOUND');
    });

    it('should include quality score in response', async () => {
      const request = new Request('https://delivery.test/deliver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: 'test-request-id',
          success: true,
          content_type: 'text',
          content: 'A well-written and comprehensive response that should pass quality checks.',
        }),
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as any;

      expect(data.quality_score).toBeGreaterThan(0);
      expect(data.quality_score).toBeLessThanOrEqual(1);
    });
  });

  describe('POST /webhook', () => {
    beforeEach(() => {
      mockEnv.DB.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: 'test-request-id',
            status: 'processing',
            callback_url: null,
          }),
          run: vi.fn().mockResolvedValue({ success: true }),
        }),
      });
    });

    it('should handle Ideogram webhook', async () => {
      const request = new Request('https://delivery.test/webhook?provider=ideogram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: 'test-request-id',
          status: 'success',
          image_url: 'https://example.com/image.png',
        }),
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should handle generic webhook format', async () => {
      const request = new Request('https://delivery.test/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: 'test-request-id',
          success: true,
          content_type: 'text',
          content: 'Generated content',
        }),
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should reject invalid JSON in webhook', async () => {
      const request = new Request('https://delivery.test/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as any;

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('INVALID_JSON');
    });
  });

  describe('GET /deliverable', () => {
    it('should return deliverable by ID', async () => {
      mockEnv.DB.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: 'test-deliverable-id',
            request_id: 'test-request-id',
            provider_response: '{"status": "ok"}',
            content_type: 'text',
            content: 'Generated text',
            quality_score: 0.9,
            quality_metadata: '{"score": 0.9}',
            status: 'delivered',
            post_processing_chain: null,
            final_output: '{"content": "Generated text"}',
            delivered_at: '2025-12-13T00:00:00Z',
            created_at: '2025-12-13T00:00:00Z',
            updated_at: '2025-12-13T00:00:00Z',
          }),
        }),
      });

      const request = new Request('https://delivery.test/deliverable?id=test-deliverable-id', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.deliverable.id).toBe('test-deliverable-id');
      expect(data.deliverable.provider_response).toEqual({ status: 'ok' });
    });

    it('should require id parameter', async () => {
      const request = new Request('https://delivery.test/deliverable', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as any;

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('MISSING_PARAM');
    });

    it('should return 404 for non-existent deliverable', async () => {
      mockEnv.DB.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null),
        }),
      });

      const request = new Request('https://delivery.test/deliverable?id=nonexistent', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as any;

      expect(response.status).toBe(404);
      expect(data.error_code).toBe('NOT_FOUND');
    });
  });

  describe('POST /approve', () => {
    it('should approve pending deliverable', async () => {
      mockEnv.DB.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: 'test-deliverable-id',
            request_id: 'test-request-id',
            content_type: 'text',
            content: 'Generated content',
            status: 'pending_review',
            callback_url: null,
          }),
          run: vi.fn().mockResolvedValue({ success: true }),
        }),
      });

      const request = new Request('https://delivery.test/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliverable_id: 'test-deliverable-id' }),
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.status).toBe('delivered');
    });

    it('should reject approval without deliverable_id', async () => {
      const request = new Request('https://delivery.test/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as any;

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('MISSING_FIELD');
    });

    it('should reject approval of non-pending deliverable', async () => {
      mockEnv.DB.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: 'test-deliverable-id',
            request_id: 'test-request-id',
            status: 'delivered',
            callback_url: null,
          }),
        }),
      });

      const request = new Request('https://delivery.test/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliverable_id: 'test-deliverable-id' }),
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as any;

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('INVALID_STATUS');
    });
  });

  describe('POST /reject', () => {
    it('should reject pending deliverable', async () => {
      mockEnv.DB.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: 'test-deliverable-id',
            request_id: 'test-request-id',
            status: 'pending_review',
            callback_url: null,
          }),
          run: vi.fn().mockResolvedValue({ success: true }),
        }),
      });

      const request = new Request('https://delivery.test/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliverable_id: 'test-deliverable-id',
          reason: 'Content not appropriate',
        }),
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.status).toBe('rejected');
    });

    it('should use default reason if not provided', async () => {
      mockEnv.DB.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: 'test-deliverable-id',
            request_id: 'test-request-id',
            status: 'pending_review',
            callback_url: null,
          }),
          run: vi.fn().mockResolvedValue({ success: true }),
        }),
      });

      const request = new Request('https://delivery.test/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliverable_id: 'test-deliverable-id' }),
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe('Unknown routes', () => {
    it('should return 404 for unknown paths', async () => {
      const request = new Request('https://delivery.test/unknown', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as any;

      expect(response.status).toBe(404);
      expect(data.error_code).toBe('ROUTE_NOT_FOUND');
    });
  });
});
