/**
 * Type definitions for Text Generation Worker
 */

export interface Env {
  // KV namespace for encrypted provider API keys
  PROVIDER_KEYS: KVNamespace;

  // D1 Database for auth
  DB: D1Database;

  // Environment variables
  CONFIG_SERVICE_URL: string;
  DEFAULT_PROVIDER: string;
  DEFAULT_MODEL_ID: string;

  // Secrets
  ENCRYPTION_KEY?: string;

  // Fallback API keys (optional, for development)
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
}

export interface GenerateRequest {
  prompt: string;
  model?: string;
  instance_id?: string;
  options?: GenerateOptions;
}

export interface GenerateOptions {
  system_prompt?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
}

export interface GenerateResponse {
  success: true;
  text: string;
  metadata: {
    provider: string;
    model: string;
    tokens_used: number;
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

export interface InstanceConfig {
  instance_id: string;
  org_id: string;
  name: string;
  api_keys: Record<string, string>;
  rate_limits: Record<string, RateLimitConfig>;
}

export interface RateLimitConfig {
  rpm?: number;
  tpm?: number;
}

export interface ModelConfig {
  config_id: string;
  model_id: string;
  provider_id: string;
  display_name: string;
  description?: string;
  capabilities: Record<string, boolean>;
  pricing?: Record<string, any>;
  rate_limits?: RateLimitConfig;
  payload_mapping: PayloadMapping;
  prompt_template?: PromptTemplate;
  status: 'active' | 'beta' | 'deprecated';
}

export interface PayloadMapping {
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  body: any;
  response_mapping: Record<string, string>;
  defaults?: Record<string, any>;
}

export interface PromptTemplate {
  system_prompt?: string;
  user_prompt_wrapper?: string;
  default_temperature?: number;
  default_max_tokens?: number;
  stop_sequences?: string[];
}

export interface AuthResult {
  authorized: boolean;
  instance_id?: string;
  user_id?: string;
  error?: string;
}

export interface TextGenerationResult {
  text: string;
  provider: string;
  model: string;
  tokens_used: number;
}
