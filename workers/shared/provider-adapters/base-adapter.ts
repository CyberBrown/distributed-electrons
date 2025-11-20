/**
 * Base Provider Adapter
 * Abstract class defining the interface for all AI provider adapters
 */

import type {
  ImageGenerationOptions,
  ProviderRequest,
  JobStatus,
  ImageResult,
} from './types';

export abstract class ProviderAdapter {
  protected readonly providerName: string;

  constructor(providerName: string) {
    this.providerName = providerName;
  }

  /**
   * Format a generation request into provider-specific format
   */
  abstract formatRequest(
    prompt: string,
    options: ImageGenerationOptions
  ): ProviderRequest;

  /**
   * Submit a job to the provider's API
   * @returns Job ID for tracking
   */
  abstract submitJob(
    request: ProviderRequest,
    apiKey: string
  ): Promise<string>;

  /**
   * Check the status of a submitted job
   */
  abstract checkStatus(jobId: string, apiKey: string): Promise<JobStatus>;

  /**
   * Fetch the final result of a completed job
   */
  abstract fetchResult(jobId: string, apiKey: string): Promise<ImageResult>;

  /**
   * Optional: Check if provider supports streaming responses
   */
  supportsStreaming(): boolean {
    return false;
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return this.providerName;
  }
}
