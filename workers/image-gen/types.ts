/**
 * Image Generation Worker Types
 */

export interface GenerateRequest {
  prompt: string;
  model?: string; // Legacy: will be treated as model_id
  model_id?: string; // Preferred: explicit model config ID (e.g., "ideogram-v2")
  instance_id?: string;
  project_id?: string;
  options?: {
    aspect_ratio?: string;
    style?: string;
    quality?: string;
    num_images?: number;
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
  DEFAULT_MODEL_ID?: string;
  CONFIG_SERVICE_URL?: string; // URL for Config Service API

  // Legacy API keys (fallback when config service unavailable)
  IDEOGRAM_API_KEY?: string;
  GEMINI_API_KEY?: string;
  OPENAI_API_KEY?: string;
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

export interface ModelConfig {
  config_id: string;
  model_id: string;
  provider_id: string;
  display_name: string;
  description: string;
  capabilities: {
    image: boolean;
    video: boolean;
    text: boolean;
    inpainting: boolean;
  };
  pricing: {
    cost_per_image: number;
    currency: string;
    billing_unit: string;
  };
  rate_limits: {
    rpm: number;
    tpm: number;
    concurrent_requests: number;
  };
  payload_mapping: {
    endpoint: string;
    method: string;
    headers: Record<string, string>;
    body: any;
    response_mapping: Record<string, string>;
    defaults?: Record<string, any>;
  };
  status: string;
  created_at: string;
  updated_at: string;
}
