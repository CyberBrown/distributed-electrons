/**
 * Ideogram Adapter Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IdeogramAdapter } from '../../workers/shared/provider-adapters/ideogram-adapter';
import type { ImageGenerationOptions } from '../../workers/shared/provider-adapters/types';

describe('IdeogramAdapter', () => {
  let adapter: IdeogramAdapter;
  const mockApiKey = 'test_api_key_123';

  beforeEach(() => {
    adapter = new IdeogramAdapter();
    vi.clearAllMocks();
  });

  describe('formatRequest', () => {
    it('should format basic request correctly', () => {
      const prompt = 'A beautiful sunset';
      const options: ImageGenerationOptions = {};

      const result = adapter.formatRequest(prompt, options);

      expect(result.provider).toBe('ideogram');
      expect(result.payload.prompt).toBe(prompt);
      expect(result.payload.model).toBe('ideogram-v2');
    });

    it('should include aspect ratio when provided', () => {
      const prompt = 'A landscape';
      const options: ImageGenerationOptions = {
        aspect_ratio: '16:9',
      };

      const result = adapter.formatRequest(prompt, options);

      expect(result.payload.aspect_ratio).toBe('16:9');
    });

    it('should include style when provided', () => {
      const prompt = 'A portrait';
      const options: ImageGenerationOptions = {
        style: 'realistic',
      };

      const result = adapter.formatRequest(prompt, options);

      expect(result.payload.style_type).toBe('realistic');
    });

    it('should override default model', () => {
      const prompt = 'Test';
      const options: ImageGenerationOptions = {
        model: 'ideogram-v1',
      };

      const result = adapter.formatRequest(prompt, options);

      expect(result.payload.model).toBe('ideogram-v1');
    });
  });

  describe('submitJob', () => {
    it('should submit job and return job ID', async () => {
      const mockJobId = 'job_123';
      const mockResponse = {
        job_id: mockJobId,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const request = adapter.formatRequest('Test prompt', {});
      const jobId = await adapter.submitJob(request, mockApiKey);

      expect(jobId).toBe(mockJobId);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.ideogram.ai/v1/generate',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockApiKey}`,
          }),
        })
      );
    });

    it('should handle rate limit errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Map([['Retry-After', '60']]),
        json: async () => ({ error: 'Rate limit exceeded' }),
      });

      const request = adapter.formatRequest('Test', {});

      await expect(adapter.submitJob(request, mockApiKey)).rejects.toThrow();
    });
  });

  describe('checkStatus', () => {
    it('should check job status', async () => {
      const mockStatus = {
        status: 'completed',
        progress: 100,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockStatus,
      });

      const status = await adapter.checkStatus('job_123', mockApiKey);

      expect(status.status).toBe('completed');
      expect(status.progress).toBe(100);
    });

    it('should map various status strings correctly', async () => {
      const testCases = [
        { provider: 'queued', expected: 'pending' },
        { provider: 'processing', expected: 'processing' },
        { provider: 'success', expected: 'completed' },
        { provider: 'failed', expected: 'failed' },
      ];

      for (const testCase of testCases) {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ status: testCase.provider }),
        });

        const status = await adapter.checkStatus('job_123', mockApiKey);
        expect(status.status).toBe(testCase.expected);
      }
    });
  });

  describe('fetchResult', () => {
    it('should fetch completed image result', async () => {
      const mockResult = {
        image_url: 'https://example.com/image.png',
        model: 'ideogram-v2',
        resolution: '1024x1024',
        format: 'png',
        generation_time_ms: 3000,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResult,
      });

      const result = await adapter.fetchResult('job_123', mockApiKey);

      expect(result.image_url).toBe(mockResult.image_url);
      expect(result.provider).toBe('ideogram');
      expect(result.model).toBe('ideogram-v2');
      expect(result.metadata.dimensions).toBe('1024x1024');
      expect(result.metadata.format).toBe('png');
    });
  });

  describe('pollUntilComplete', () => {
    it('should poll until job completes', async () => {
      const mockResult = {
        image_url: 'https://example.com/image.png',
        model: 'ideogram-v2',
      };

      // First call: processing, second call: completed
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/status/')) {
          callCount++;
          return Promise.resolve({
            ok: true,
            json: async () => ({
              status: callCount === 1 ? 'processing' : 'completed',
            }),
          });
        }
        // Result endpoint
        return Promise.resolve({
          ok: true,
          json: async () => mockResult,
        });
      });

      const result = await adapter.pollUntilComplete(
        'job_123',
        mockApiKey,
        10000,
        100
      );

      expect(result.image_url).toBe(mockResult.image_url);
      expect(callCount).toBeGreaterThanOrEqual(2);
    });

    it('should timeout if job takes too long', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'processing' }),
      });

      await expect(
        adapter.pollUntilComplete('job_123', mockApiKey, 500, 100)
      ).rejects.toThrow('timeout');
    });

    it('should throw error if job fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'failed',
          error: 'Generation failed',
        }),
      });

      await expect(
        adapter.pollUntilComplete('job_123', mockApiKey)
      ).rejects.toThrow('Generation failed');
    });
  });
});
