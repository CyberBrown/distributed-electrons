/**
 * Request Router Durable Object Types
 */

// Request status in the router lifecycle
export type RequestStatus =
  | 'pending'      // Just received, awaiting classification
  | 'queued'       // Classified and in provider queue
  | 'processing'   // Being processed by provider
  | 'completed'    // Successfully completed
  | 'failed'       // Failed after retries
  | 'cancelled';   // Cancelled by user/system

// Task types the router can handle
export type TaskType =
  | 'text'         // Text generation
  | 'image'        // Image generation
  | 'audio'        // Audio/TTS generation
  | 'video'        // Video rendering
  | 'context'      // Context/RAG queries
  | 'unknown';     // Needs classification

// Incoming request from Intake Worker
export interface IntakeRequest {
  id: string;
  app_id: string;
  instance_id?: string;
  query: string;
  metadata?: Record<string, unknown>;
  task_type?: TaskType;
  provider?: string;
  model?: string;
  priority?: number;
  callback_url?: string;
  created_at: string;
}

// Request stored in Router DO queue
export interface QueuedRequest extends IntakeRequest {
  status: RequestStatus;
  queue_position?: number;
  retry_count: number;
  max_retries: number;
  error_message?: string;
  queued_at?: string;
  started_at?: string;
  completed_at?: string;
}

// Rate limit configuration per provider/model
export interface ProviderRateLimit {
  provider: string;
  model?: string;
  requests_per_minute: number;
  tokens_per_minute?: number;
  concurrent_requests: number;
  current_rpm: number;
  current_concurrent: number;
  last_reset: number;
}

// Provider queue for managing requests per provider
export interface ProviderQueue {
  provider: string;
  model?: string;
  queue: string[];  // Request IDs
  processing: Set<string>;  // Currently processing request IDs
  rate_limit: ProviderRateLimit;
}

// Task classification result
export interface ClassificationResult {
  task_type: TaskType;
  provider: string;
  model: string;
  confidence: number;
  subtask?: string;
}

// Router state snapshot
export interface RouterState {
  total_requests: number;
  pending_requests: number;
  queued_requests: number;
  processing_requests: number;
  completed_requests: number;
  failed_requests: number;
  provider_queues: Record<string, {
    queue_length: number;
    processing: number;
    rate_limit: ProviderRateLimit;
  }>;
}

// Notification to send to processing workers
export interface ProcessingNotification {
  request_id: string;
  app_id: string;
  query: string;
  task_type: TaskType;
  provider: string;
  model: string;
  metadata?: Record<string, unknown>;
  callback_url?: string;
}

// Response from Router DO operations
export interface RouterResponse {
  success: boolean;
  request_id?: string;
  status?: RequestStatus;
  queue_position?: number;
  estimated_wait_ms?: number;
  error?: string;
}
