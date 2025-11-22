/**
 * Ideogram Provider Adapter
 * Implementation for Ideogram AI image generation API
 * API Docs: https://developer.ideogram.ai/
 */

import { ProviderAdapter } from './base-adapter';
import type {
  ImageGenerationOptions,
  ProviderRequest,
  JobStatus,
  ImageResult,
  ProviderError,
} from './types';

const IDEOGRAM_API_BASE = 'https://api.ideogram.ai';

export class IdeogramAdapter extends ProviderAdapter {
  constructor() {
    super('ideogram');
  }

  formatRequest(
    prompt: string,
    options: ImageGenerationOptions
  ): ProviderRequest {
    const imageRequest: any = {
      prompt,
      model: options.model || 'V_2',
    };

    if (options.aspect_ratio) {
      imageRequest.aspect_ratio = options.aspect_ratio;
    }

    if (options.style) {
      imageRequest.style_type = options.style;
    }

    // Add any additional options
    Object.keys(options).forEach((key) => {
      if (!['model', 'aspect_ratio', 'style'].includes(key)) {
        imageRequest[key] = options[key];
      }
    });

    return {
      provider: this.providerName,
      payload: { image_request: imageRequest },
    };
  }

  async submitJob(request: ProviderRequest, apiKey: string): Promise<string> {
    const response = await fetch(`${IDEOGRAM_API_BASE}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': apiKey,
      },
      body: JSON.stringify(request.payload),
    });

    if (!response.ok) {
      throw await this.handleError(response);
    }

    const data = await response.json();
    // Ideogram returns results immediately in data array
    // Store the response and return a pseudo job ID
    return JSON.stringify(data);
  }

  async checkStatus(jobId: string, apiKey: string): Promise<JobStatus> {
    // Ideogram API is synchronous, so job is always completed
    return {
      status: 'completed',
      progress: 100,
    };
  }

  async fetchResult(jobId: string, apiKey: string): Promise<ImageResult> {
    // JobId is actually the stringified response data from submitJob
    const data = JSON.parse(jobId);
    const imageData = data.data[0];

    return {
      image_url: imageData.url,
      provider: this.providerName,
      model: 'V_2',
      metadata: {
        dimensions: imageData.resolution || '1024x1024',
        format: 'png',
        generation_time_ms: 0,
      },
    };
  }

  private mapStatus(
    providerStatus: string
  ): 'pending' | 'processing' | 'completed' | 'failed' {
    const statusMap: Record<string, JobStatus['status']> = {
      queued: 'pending',
      pending: 'pending',
      processing: 'processing',
      in_progress: 'processing',
      completed: 'completed',
      success: 'completed',
      failed: 'failed',
      error: 'failed',
    };

    return statusMap[providerStatus.toLowerCase()] || 'pending';
  }

  private async handleError(response: Response): Promise<ProviderError> {
    let errorMessage = `Ideogram API error: ${response.status}`;
    let errorCode = 'PROVIDER_ERROR';
    let retryAfter: number | undefined;

    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorData.message || errorMessage;
      errorCode = errorData.error_code || errorCode;
    } catch {
      // Response not JSON, use status text
      errorMessage = `${errorMessage} ${response.statusText}`;
    }

    if (response.status === 429) {
      errorCode = 'RATE_LIMIT_EXCEEDED';
      const retryAfterHeader = response.headers.get('Retry-After');
      retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 60;
    }

    const error = new Error(errorMessage) as ProviderError;
    error.code = errorCode;
    error.statusCode = response.status;
    error.retryAfter = retryAfter;

    return error;
  }

  /**
   * Poll for job completion with timeout
   * @param jobId Job ID to poll
   * @param apiKey Provider API key
   * @param timeoutMs Maximum time to wait (default: 60s)
   * @param pollIntervalMs Interval between polls (default: 2s)
   */
  async pollUntilComplete(
    jobId: string,
    apiKey: string,
    timeoutMs: number = 60000,
    pollIntervalMs: number = 2000
  ): Promise<ImageResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.checkStatus(jobId, apiKey);

      if (status.status === 'completed') {
        return await this.fetchResult(jobId, apiKey);
      }

      if (status.status === 'failed') {
        throw new Error(status.error || 'Job failed');
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error('Job timeout: Generation took too long');
  }
}
