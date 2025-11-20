/**
 * Provider Adapter Types
 * Standardized interfaces for AI provider integrations
 */

export interface ImageGenerationOptions {
  model?: string;
  aspect_ratio?: string;
  style?: string;
  [key: string]: any;
}

export interface ProviderRequest {
  provider: string;
  payload: any;
}

export interface JobStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number; // 0-100
  error?: string;
}

export interface ImageResult {
  image_url: string;
  image_data?: ArrayBuffer;
  provider: string;
  model: string;
  metadata: {
    dimensions: string;
    format: string;
    generation_time_ms: number;
  };
}

export interface ProviderError extends Error {
  code: string;
  statusCode?: number;
  retryAfter?: number;
}
