/**
 * Image Generation Worker Types
 */

export interface GenerateRequest {
  prompt: string;
  model?: string;
  instance_id?: string;
  project_id?: string;
  options?: {
    aspect_ratio?: string;
    style?: string;
    [key: string]: any;
  };
}

export interface GenerateResponse {
  success: boolean;
  image_url: string;
  r2_path: string;
  metadata: {
    provider: string;
    model: string;
    dimensions: string;
    format: string;
    generation_time_ms: number;
  };
  request_id: string;
  timestamp: string;
}

export interface ErrorResponse {
  error: string;
  error_code: string;
  request_id: string;
  details?: Record<string, any>;
}

export interface Env {
  // Bindings
  CONFIG_DB?: D1Database;
  KV_CACHE?: KVNamespace;
  R2_BUCKET?: R2Bucket;
  RATE_LIMITER?: DurableObjectNamespace;

  // Environment variables
  CDN_URL?: string;
  DEFAULT_INSTANCE_ID?: string;
  DEFAULT_PROVIDER?: string;
}

export interface InstanceConfig {
  instance_id: string;
  org_id: string;
  api_keys: Record<string, string>;
  rate_limits: Record<
    string,
    {
      rpm: number;
      tpm: number;
    }
  >;
  worker_urls?: Record<string, string>;
  r2_bucket?: string;
  authorized_users?: string[];
}
