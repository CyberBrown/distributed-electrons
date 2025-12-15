/**
 * Render Service Worker Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from '../../workers/render-service/index';
import type { Env } from '../../workers/render-service/types';

// Mock environment
const mockEnv: Env = {
  SHOTSTACK_API_KEY: 'test_shotstack_key_123',
  SHOTSTACK_ENV: 'stage',
  DEFAULT_INSTANCE_ID: 'test-instance',
  RENDER_STORAGE: {} as R2Bucket,
};

describe('Render Service Worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset global fetch mock
    global.fetch = vi.fn();
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
      expect(data.service).toBe('render-service');
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

  describe('OPTIONS (CORS preflight)', () => {
    it('should handle CORS preflight requests', async () => {
      const request = new Request('http://worker/render', {
        method: 'OPTIONS',
      });

      const response = await worker.fetch(request, mockEnv);

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
      expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
      expect(response.headers.get('Access-Control-Max-Age')).toBe('86400');
    });
  });

  describe('POST /render - Input Validation', () => {
    it('should validate timeline is required', async () => {
      const request = new Request('http://worker/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('INVALID_REQUEST');
      expect(data.error).toContain('Timeline with tracks is required');
    });

    it('should validate timeline has tracks', async () => {
      const request = new Request('http://worker/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeline: {},
        }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('INVALID_REQUEST');
      expect(data.error).toContain('Timeline with tracks is required');
    });

    it('should validate timeline has non-empty tracks array', async () => {
      const request = new Request('http://worker/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeline: {
            tracks: [],
          },
        }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('INVALID_REQUEST');
      expect(data.error).toContain('Timeline with tracks is required');
    });

    it('should accept valid timeline with tracks', async () => {
      // Mock successful Shotstack API response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          response: {
            id: 'test-render-123',
          },
        }),
      });

      const request = new Request('http://worker/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeline: {
            tracks: [
              {
                clips: [
                  {
                    asset: {
                      type: 'video',
                      src: 'https://example.com/video.mp4',
                    },
                    start: 0,
                    length: 5,
                  },
                ],
              },
            ],
          },
        }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.render_id).toBe('test-render-123');
    });
  });

  describe('POST /render - Request ID Tracking', () => {
    it('should include request ID in response', async () => {
      // Mock successful Shotstack API response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          response: {
            id: 'test-render-456',
          },
        }),
      });

      const request = new Request('http://worker/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeline: {
            tracks: [
              {
                clips: [
                  {
                    asset: { type: 'image', src: 'https://example.com/img.jpg' },
                    start: 0,
                    length: 3,
                  },
                ],
              },
            ],
          },
        }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(data.request_id).toBeDefined();
      expect(response.headers.get('X-Request-ID')).toBeDefined();
      expect(response.headers.get('X-Request-ID')).toBe(data.request_id);
    });

    it('should include request ID in error responses', async () => {
      const request = new Request('http://worker/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(data.request_id).toBeDefined();
      expect(response.headers.get('X-Request-ID')).toBe(data.request_id);
    });
  });

  describe('POST /render - Configuration', () => {
    it('should use default output configuration', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          response: {
            id: 'test-render-789',
          },
        }),
      });

      const request = new Request('http://worker/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeline: {
            tracks: [
              {
                clips: [
                  {
                    asset: { type: 'video', src: 'https://example.com/video.mp4' },
                    start: 0,
                    length: 5,
                  },
                ],
              },
            ],
          },
        }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(data.metadata.format).toBe('mp4');
      expect(data.metadata.resolution).toBe('hd');
    });

    it('should use custom output configuration', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          response: {
            id: 'test-render-custom',
          },
        }),
      });

      const request = new Request('http://worker/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeline: {
            tracks: [
              {
                clips: [
                  {
                    asset: { type: 'video', src: 'https://example.com/video.mp4' },
                    start: 0,
                    length: 5,
                  },
                ],
              },
            ],
          },
          output: {
            format: 'gif',
            resolution: '720',
            fps: 30,
            quality: 'medium',
          },
        }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(data.metadata.format).toBe('gif');
      expect(data.metadata.resolution).toBe('720');
    });

    it('should return error when API key is missing', async () => {
      const envWithoutKey: Env = {
        ...mockEnv,
        SHOTSTACK_API_KEY: undefined,
      };

      const request = new Request('http://worker/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeline: {
            tracks: [
              {
                clips: [
                  {
                    asset: { type: 'video', src: 'https://example.com/video.mp4' },
                    start: 0,
                    length: 5,
                  },
                ],
              },
            ],
          },
        }),
      });

      const response = await worker.fetch(request, envWithoutKey);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(500);
      expect(data.error_code).toBe('MISSING_API_KEY');
      expect(data.error).toContain('Shotstack API key not configured');
    });
  });

  describe('POST /render - Error Handling', () => {
    it('should handle Shotstack rate limit error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded',
      });

      const request = new Request('http://worker/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeline: {
            tracks: [
              {
                clips: [
                  {
                    asset: { type: 'video', src: 'https://example.com/video.mp4' },
                    start: 0,
                    length: 5,
                  },
                ],
              },
            ],
          },
        }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(429);
      expect(data.error_code).toBe('PROVIDER_RATE_LIMIT');
      expect(data.error).toContain('rate limit');
    });

    it('should handle invalid API key error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      const request = new Request('http://worker/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeline: {
            tracks: [
              {
                clips: [
                  {
                    asset: { type: 'video', src: 'https://example.com/video.mp4' },
                    start: 0,
                    length: 5,
                  },
                ],
              },
            ],
          },
        }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(401);
      expect(data.error_code).toBe('INVALID_API_KEY');
      expect(data.error).toContain('Invalid Shotstack API key');
    });

    it('should handle invalid JSON', async () => {
      const request = new Request('http://worker/render', {
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

    it('should handle generic Shotstack errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const request = new Request('http://worker/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeline: {
            tracks: [
              {
                clips: [
                  {
                    asset: { type: 'video', src: 'https://example.com/video.mp4' },
                    start: 0,
                    length: 5,
                  },
                ],
              },
            ],
          },
        }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(500);
      expect(data.error_code).toBe('RENDER_ERROR');
    });
  });

  describe('GET /render/:id - Status Check', () => {
    it('should validate render ID is required', async () => {
      const request = new Request('http://worker/render/', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('INVALID_REQUEST');
      expect(data.error).toContain('Render ID is required');
    });

    it('should fetch render status successfully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          response: {
            status: 'done',
            progress: 1.0,
            url: 'https://shotstack.io/output/video.mp4',
          },
        }),
      });

      const request = new Request('http://worker/render/test-render-123', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.render_id).toBe('test-render-123');
      expect(data.status).toBe('done');
      expect(data.progress).toBe(100);
      expect(data.url).toBe('https://shotstack.io/output/video.mp4');
    });

    it('should map Shotstack status correctly', async () => {
      const statuses = [
        { shotstack: 'queued', expected: 'queued' },
        { shotstack: 'fetching', expected: 'fetching' },
        { shotstack: 'rendering', expected: 'rendering' },
        { shotstack: 'saving', expected: 'saving' },
        { shotstack: 'done', expected: 'done' },
        { shotstack: 'failed', expected: 'failed' },
      ];

      for (const { shotstack, expected } of statuses) {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            response: {
              status: shotstack,
              progress: 0.5,
            },
          }),
        });

        const request = new Request(`http://worker/render/test-${shotstack}`, {
          method: 'GET',
        });

        const response = await worker.fetch(request, mockEnv);
        const data = await response.json() as Record<string, any>;

        expect(data.status).toBe(expected);
      }
    });

    it('should include error in status response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          response: {
            status: 'failed',
            error: 'Video encoding failed',
          },
        }),
      });

      const request = new Request('http://worker/render/failed-render', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(data.status).toBe('failed');
      expect(data.error).toBe('Video encoding failed');
    });

    it('should return error when API key is missing for status check', async () => {
      const envWithoutKey: Env = {
        ...mockEnv,
        SHOTSTACK_API_KEY: undefined,
      };

      const request = new Request('http://worker/render/test-render-123', {
        method: 'GET',
      });

      const response = await worker.fetch(request, envWithoutKey);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(500);
      expect(data.error_code).toBe('MISSING_API_KEY');
    });

    it('should handle status check errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Render not found',
      });

      const request = new Request('http://worker/render/nonexistent', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(500);
      expect(data.error_code).toBe('STATUS_ERROR');
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
      expect(data.request_id).toBeDefined();
    });

    it('should return 404 for wrong HTTP method', async () => {
      const request = new Request('http://worker/render', {
        method: 'DELETE',
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(404);
      expect(data.error_code).toBe('ROUTE_NOT_FOUND');
    });

    it('should include CORS headers in error responses', async () => {
      const request = new Request('http://worker/unknown', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
    });
  });

  describe('Timeline Configuration', () => {
    it('should handle timeline with soundtrack', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          response: {
            id: 'test-render-soundtrack',
          },
        }),
      });

      const request = new Request('http://worker/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeline: {
            soundtrack: {
              src: 'https://example.com/audio.mp3',
              effect: 'fadeIn',
              volume: 0.8,
            },
            tracks: [
              {
                clips: [
                  {
                    asset: { type: 'video', src: 'https://example.com/video.mp4' },
                    start: 0,
                    length: 10,
                  },
                ],
              },
            ],
          },
        }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should handle multiple tracks', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          response: {
            id: 'test-render-multi-track',
          },
        }),
      });

      const request = new Request('http://worker/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeline: {
            tracks: [
              {
                clips: [
                  {
                    asset: { type: 'video', src: 'https://example.com/bg.mp4' },
                    start: 0,
                    length: 10,
                  },
                ],
              },
              {
                clips: [
                  {
                    asset: { type: 'image', src: 'https://example.com/logo.png' },
                    start: 0,
                    length: 10,
                    position: 'topRight',
                    scale: 0.3,
                  },
                ],
              },
            ],
          },
        }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should handle clips with transitions and effects', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          response: {
            id: 'test-render-effects',
          },
        }),
      });

      const request = new Request('http://worker/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeline: {
            tracks: [
              {
                clips: [
                  {
                    asset: { type: 'video', src: 'https://example.com/video.mp4' },
                    start: 0,
                    length: 5,
                    transition: {
                      in: 'fade',
                      out: 'fade',
                    },
                    effect: 'zoomIn',
                    filter: 'greyscale',
                    opacity: 0.9,
                  },
                ],
              },
            ],
          },
        }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });
});
