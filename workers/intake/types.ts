/**
 * Intake Worker Types
 */

// Environment bindings
export interface Env {
  // Durable Objects
  REQUEST_ROUTER: DurableObjectNamespace;
  RATE_LIMITER: DurableObjectNamespace;

  // D1 Database
  DB: D1Database;

  // Environment variables
  CONFIG_SERVICE_URL: string;
  DEFAULT_INSTANCE_ID?: string;
}

// Incoming request from client app
export interface IntakePayload {
  query: string;
  app_id?: string;
  instance_id?: string;
  task_type?: 'text' | 'image' | 'audio' | 'video' | 'context';
  provider?: string;
  model?: string;
  priority?: number;
  callback_url?: string;
  metadata?: Record<string, unknown>;
}

// Response to client
export interface IntakeResponse {
  success: boolean;
  request_id?: string;
  status?: string;
  queue_position?: number;
  estimated_wait_ms?: number;
  error?: string;
  error_code?: string;
}

// Request stored in D1
export interface StoredRequest {
  id: string;
  app_id: string;
  instance_id: string | null;
  query: string;
  metadata: string | null;  // JSON string
  task_type: string | null;
  provider: string | null;
  model: string | null;
  status: string;
  priority: number;
  queue_position: number | null;
  retry_count: number;
  max_retries: number;
  error_message: string | null;
  callback_url: string | null;
  created_at: string;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

// Error response
export interface ErrorResponse {
  error: string;
  error_code: string;
  request_id?: string;
  details?: Record<string, unknown>;
}
