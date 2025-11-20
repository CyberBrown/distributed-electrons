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
