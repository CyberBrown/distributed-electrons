/**
 * Base Provider Adapter
 * Abstract base class for all provider adapters
 */

import type {
  ProviderAdapter,
  AdapterContext,
  MediaOptions,
  MediaResult,
  TextResult,
} from '../types';

/**
 * Error patterns that indicate quota exhaustion
 */
export const QUOTA_ERROR_PATTERNS = [
  /credit balance.*too low/i,  // Anthropic billing error
  /insufficient_quota/i,
  /rate_limit_exceeded/i,
  /billing.*issue/i,
  /payment.*required/i,
  /quota.*exceeded/i,
  /billing_hard_limit_reached/i,
  /you exceeded your current quota/i,
  /rate limit reached/i,
  /account.*billing/i,
  /out of credits/i,
  /no credits remaining/i,
  /subscription.*expired/i,
  /api key.*expired/i,
  /exceeded.*monthly.*limit/i,  // Usage limits
  /spending.*limit/i,
];

/**
 * Error patterns that indicate transient errors
 */
export const TRANSIENT_ERROR_PATTERNS = [
  /timeout/i,
  /connection.*reset/i,
  /network.*error/i,
  /temporarily unavailable/i,
  /service.*overloaded/i,
  /internal server error/i,
  /bad gateway/i,
  /service unavailable/i,
  /gateway timeout/i,
];

/**
 * Check if an error indicates quota exhaustion
 */
export function isQuotaError(error: string): boolean {
  return QUOTA_ERROR_PATTERNS.some((pattern) => pattern.test(error));
}

/**
 * Check if an error is transient (retryable)
 */
export function isTransientError(error: string): boolean {
  return TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(error));
}

/**
 * Abstract base adapter with common functionality
 */
export abstract class BaseAdapter implements ProviderAdapter {
  abstract readonly providerId: string;
  abstract readonly supportedWorkers: string[];

  abstract execute(
    prompt: string,
    options: MediaOptions,
    context: AdapterContext
  ): Promise<MediaResult>;

  /**
   * Make an HTTP request with standard error handling
   */
  protected async makeRequest(
    url: string,
    options: RequestInit
  ): Promise<Response> {
    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `${this.providerId} API error (${response.status}): ${errorText}`
      );
    }

    return response;
  }

  /**
   * Build authorization header
   */
  protected getAuthHeader(context: AdapterContext): Record<string, string> {
    const { provider, apiKey } = context;

    switch (provider.auth_type) {
      case 'bearer':
        return { Authorization: `Bearer ${apiKey}` };
      case 'api_key':
        // Provider-specific header names
        if (provider.id === 'anthropic') {
          return { 'x-api-key': apiKey };
        }
        if (provider.id === 'ideogram') {
          return { 'Api-Key': apiKey };
        }
        if (provider.id === 'elevenlabs') {
          return { 'xi-api-key': apiKey };
        }
        return { 'X-API-Key': apiKey };
      default:
        return {};
    }
  }

  /**
   * Default health check - try to hit the API
   */
  async checkHealth(context: AdapterContext): Promise<boolean> {
    try {
      // Most providers have a models endpoint
      const url = `${context.baseUrl}/v1/models`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeader(context),
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Text generation adapter base
 */
export abstract class TextAdapter extends BaseAdapter {
  readonly supportedWorkers = ['text-gen'];

  abstract execute(
    prompt: string,
    options: MediaOptions,
    context: AdapterContext
  ): Promise<TextResult>;
}

/**
 * Image generation adapter base
 */
export abstract class ImageAdapter extends BaseAdapter {
  readonly supportedWorkers = ['image-gen'];
}

/**
 * Audio generation adapter base
 */
export abstract class AudioAdapter extends BaseAdapter {
  readonly supportedWorkers = ['audio-gen'];
}

/**
 * Video generation adapter base
 */
export abstract class VideoAdapter extends BaseAdapter {
  readonly supportedWorkers = ['video-gen'];
}
