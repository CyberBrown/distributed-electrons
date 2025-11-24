/**
 * Text Generation Worker Types
 */

export interface GenerateRequest {
  prompt: string;
  model?: string;
  instance_id?: string;
  project_id?: string;
  options?: {
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    stream?: boolean;
    [key: string]: any;
  };
}

export interface GenerateResponse {
  success: boolean;
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

export interface Env {
  // Bindings
  RATE_LIMITER?: DurableObjectNamespace;

  // Environment variables
  DEFAULT_INSTANCE_ID?: string;
  DEFAULT_PROVIDER?: string;

  // API Keys (from secrets)
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
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
  authorized_users?: string[];
}

export interface ProviderAdapter {
  name: string;
  generate: (prompt: string, options: any, apiKey: string) => Promise<TextResult>;
}

export interface TextResult {
  text: string;
  provider: string;
  model: string;
  tokens_used: number;
  metadata?: Record<string, any>;
}
