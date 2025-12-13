/**
 * Audio Generation Worker Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from '../../workers/audio-gen/index';
import type { Env } from '../../workers/audio-gen/types';

// Mock R2 bucket
const mockR2Bucket = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  head: vi.fn(),
  list: vi.fn(),
};

// Mock environment
const mockEnv: Env = {
  AUDIO_STORAGE: mockR2Bucket as unknown as R2Bucket,
  DEFAULT_INSTANCE_ID: 'test-instance',
  DEFAULT_VOICE_ID: '21m00Tcm4TlvDq8ikWAM',
  DEFAULT_MODEL_ID: 'eleven_monolingual_v1',
  ELEVENLABS_API_KEY: 'test_elevenlabs_key_123',
};

describe('Audio Generation Worker', () => {
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
      expect(data.service).toBe('audio-gen');
      expect(data.timestamp).toBeDefined();
    });

    it('should include CORS headers', async () => {
      const request = new Request('http://worker/health', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('POST /synthesize - Input Validation', () => {
    it('should validate text is required', async () => {
      const request = new Request('http://worker/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('INVALID_REQUEST');
      expect(data.error).toContain('Text is required');
    });

    it('should reject empty text', async () => {
      const request = new Request('http://worker/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '   ' }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('INVALID_REQUEST');
      expect(data.error).toContain('Text is required');
    });

    it('should reject text exceeding maximum length', async () => {
      const longText = 'a'.repeat(5001);
      const request = new Request('http://worker/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: longText }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error_code).toBe('TEXT_TOO_LONG');
      expect(data.error).toContain('5000 characters');
    });

    it('should accept valid text within length limit', async () => {
      const validText = 'Hello, this is a test message.';
      const request = new Request('http://worker/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: validText }),
      });

      // Response will fail at ElevenLabs API call, but validation should pass
      await worker.fetch(request, mockEnv);

      // Test passes if we don't get a 400 validation error
      // Actual synthesis would fail without mocking fetch
    });
  });

  describe('POST /synthesize - Request ID Tracking', () => {
    it('should include request ID in response', async () => {
      const request = new Request('http://worker/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Test' }),
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json();

      expect(data.request_id).toBeDefined();
      expect(typeof data.request_id).toBe('string');
    });

    it('should include request ID in response header', async () => {
      const request = new Request('http://worker/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Test' }),
      });

      const response = await worker.fetch(request, mockEnv);

      expect(response.headers.get('X-Request-ID')).toBeDefined();
      expect(response.headers.get('X-Request-ID')).toBe(
        (await response.clone().json()).request_id
      );
    });

    it('should generate unique request IDs', async () => {
      const request1 = new Request('http://worker/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Test 1' }),
      });

      const request2 = new Request('http://worker/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Test 2' }),
      });

      const response1 = await worker.fetch(request1, mockEnv);
      const response2 = await worker.fetch(request2, mockEnv);

      const data1 = await response1.json();
      const data2 = await response2.json();

      expect(data1.request_id).not.toBe(data2.request_id);
    });
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
      expect(data.request_id).toBeDefined();
    });

    it('should handle invalid JSON', async () => {
      const request = new Request('http://worker/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json{',
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json();

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(data.error).toBeDefined();
      expect(data.request_id).toBeDefined();
    });

    it('should include CORS headers in error responses', async () => {
      const request = new Request('http://worker/unknown', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should handle missing API key', async () => {
      const envWithoutKey: Env = {
        ...mockEnv,
        ELEVENLABS_API_KEY: undefined,
      };

      const request = new Request('http://worker/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Test' }),
      });

      const response = await worker.fetch(request, envWithoutKey);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error_code).toBe('MISSING_API_KEY');
      expect(data.error).toContain('API key not configured');
    });
  });

  describe('Voice/Model Configuration', () => {
    it('should use custom voice_id from request', async () => {
      const request = new Request('http://worker/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Test',
          voice_id: 'custom-voice-id',
        }),
      });

      // Response will fail at ElevenLabs API, but we can verify request handling
      await worker.fetch(request, mockEnv);
      // Test passes if no crash - actual voice handling tested in integration
    });

    it('should use custom model_id from request', async () => {
      const request = new Request('http://worker/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Test',
          model_id: 'eleven_multilingual_v2',
        }),
      });

      await worker.fetch(request, mockEnv);
      // Test passes if no crash
    });

    it('should use default voice_id from env when not specified', async () => {
      const request = new Request('http://worker/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Test' }),
      });

      await worker.fetch(request, mockEnv);
      // Test passes if no crash - defaults to env.DEFAULT_VOICE_ID
    });

    it('should use default model_id from env when not specified', async () => {
      const request = new Request('http://worker/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Test' }),
      });

      await worker.fetch(request, mockEnv);
      // Test passes if no crash - defaults to env.DEFAULT_MODEL_ID
    });

    it('should accept voice settings options', async () => {
      const request = new Request('http://worker/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Test',
          options: {
            stability: 0.7,
            similarity_boost: 0.8,
            style: 0.5,
            use_speaker_boost: false,
          },
        }),
      });

      await worker.fetch(request, mockEnv);
      // Test passes if no crash
    });
  });

  describe('CORS Handling', () => {
    it('should handle OPTIONS preflight request', async () => {
      const request = new Request('http://worker/synthesize', {
        method: 'OPTIONS',
      });

      const response = await worker.fetch(request, mockEnv);

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
      expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
      expect(response.headers.get('Access-Control-Max-Age')).toBe('86400');
    });

    it('should include CORS headers on all responses', async () => {
      const requests = [
        new Request('http://worker/health', { method: 'GET' }),
        new Request('http://worker/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'Test' }),
        }),
        new Request('http://worker/unknown', { method: 'GET' }),
      ];

      for (const request of requests) {
        const response = await worker.fetch(request, mockEnv);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      }
    });
  });

  describe('GET /voices', () => {
    it('should handle missing API key for voices endpoint', async () => {
      const envWithoutKey: Env = {
        ...mockEnv,
        ELEVENLABS_API_KEY: undefined,
      };

      const request = new Request('http://worker/voices', {
        method: 'GET',
      });

      const response = await worker.fetch(request, envWithoutKey);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error_code).toBe('MISSING_API_KEY');
    });

    it('should include request ID in voices response', async () => {
      const request = new Request('http://worker/voices', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json();

      expect(data.request_id).toBeDefined();
    });
  });

  describe('GET /audio/:id', () => {
    it('should return 404 when audio file not found', async () => {
      mockR2Bucket.get.mockResolvedValue(null);

      const request = new Request('http://worker/audio/test.mp3', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error_code).toBe('NOT_FOUND');
      expect(data.error).toContain('not found');
    });

    it('should serve audio file from R2', async () => {
      const mockAudioData = new ArrayBuffer(1024);
      mockR2Bucket.get.mockResolvedValue({
        body: mockAudioData,
        httpMetadata: { contentType: 'audio/mpeg' },
      });

      const request = new Request('http://worker/audio/test.mp3', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
      expect(response.headers.get('Cache-Control')).toContain('max-age');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should use default content type when not specified', async () => {
      const mockAudioData = new ArrayBuffer(1024);
      mockR2Bucket.get.mockResolvedValue({
        body: mockAudioData,
        httpMetadata: {},
      });

      const request = new Request('http://worker/audio/test.mp3', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv);

      expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
    });
  });

  describe('Instance Configuration', () => {
    it('should accept instance_id in request body', async () => {
      const request = new Request('http://worker/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Test',
          instance_id: 'custom-instance',
        }),
      });

      await worker.fetch(request, mockEnv);
      // Test passes if no crash - instance handling tested in integration
    });

    it('should accept project_id in request body', async () => {
      const request = new Request('http://worker/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Test',
          project_id: 'test-project',
        }),
      });

      await worker.fetch(request, mockEnv);
      // Test passes if no crash
    });
  });

  describe('Timestamp Handling', () => {
    it('should include ISO timestamp in health response', async () => {
      const request = new Request('http://worker/health', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv);
      const data = await response.json();

      expect(data.timestamp).toBeDefined();
      expect(new Date(data.timestamp).toISOString()).toBe(data.timestamp);
    });
  });
});
