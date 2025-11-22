// Type definitions for Config Service

export interface Env {
  DB: D1Database;
  ENVIRONMENT?: string;
}

export interface Instance {
  instance_id: string;
  org_id: string;
  name: string;
  api_keys: string; // JSON string of API keys
  rate_limits: string; // JSON string of rate limits config
  worker_urls: string; // JSON string of worker URLs
  r2_bucket: string;
  created_at: string;
  updated_at: string;
}

export interface User {
  user_id: string;
  org_id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
  updated_at: string;
}

export interface Project {
  project_id: string;
  instance_id: string;
  name: string;
  description?: string;
  config: string; // JSON string of project config
  created_at: string;
  updated_at: string;
}

export interface Capabilities {
  image?: boolean;
  video?: boolean;
  text?: boolean;
  audio?: boolean;
  inpainting?: boolean;
  outpainting?: boolean;
  upscaling?: boolean;
  style_transfer?: boolean;
  image_to_video?: boolean;
  text_to_speech?: boolean;
  [key: string]: boolean | undefined;
}

export interface Pricing {
  cost_per_image?: number;
  cost_per_video?: number;
  cost_per_1k_tokens?: number;
  cost_per_minute?: number;
  cost_per_request?: number;
  currency?: string;
  billing_unit?: string;
  free_tier?: {
    requests_per_month?: number;
    tokens_per_month?: number;
  };
  notes?: string;
}

export interface RateLimits {
  rpm?: number;
  rph?: number;
  rpd?: number;
  tpm?: number;
  tph?: number;
  concurrent_requests?: number;
  burst_limit?: number;
  notes?: string;
}

export interface PayloadMapping {
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  body: any;
  response_mapping: Record<string, string>;
  defaults?: Record<string, any>;
  transformations?: Record<string, string>;
}

export interface ModelConfig {
  config_id: string;
  model_id: string;
  provider_id: string;
  display_name: string;
  description?: string;
  capabilities: Capabilities;
  pricing?: Pricing;
  rate_limits?: RateLimits;
  payload_mapping: PayloadMapping;
  status: 'active' | 'beta' | 'deprecated';
  created_at: string;
  updated_at: string;
}

export interface CreateModelConfigRequest {
  model_id: string;
  provider_id: string;
  display_name: string;
  description?: string;
  capabilities: Capabilities;
  pricing?: Pricing;
  rate_limits?: RateLimits;
  payload_mapping: PayloadMapping;
  status: 'active' | 'beta' | 'deprecated';
}

export interface UpdateModelConfigRequest {
  display_name?: string;
  description?: string;
  capabilities?: Capabilities;
  pricing?: Pricing;
  rate_limits?: RateLimits;
  payload_mapping?: PayloadMapping;
  status?: 'active' | 'beta' | 'deprecated';
}

export interface ErrorResponse {
  error: string;
  request_id: string;
  status?: number;
}

export interface SuccessResponse<T> {
  data: T;
  request_id: string;
}

export type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;
