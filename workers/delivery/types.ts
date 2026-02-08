/**
 * Delivery Worker Types
 */

// Environment bindings
export interface Env {
  // Durable Objects
  // REQUEST_ROUTER removed — Prometheus Phase 1.

  // D1 Database
  DB: D1Database;

  // R2 Storage for deliverables
  DELIVERABLES_STORAGE: R2Bucket;

  // Environment variables
  CONFIG_SERVICE_URL: string;
}

// Provider response payload (webhook or polling result)
export interface ProviderResponse {
  request_id: string;
  success: boolean;
  content_type: 'text' | 'image_url' | 'audio_url' | 'video_url' | 'json';
  content: string;
  raw_response?: Record<string, unknown>;
  error?: string;
  provider?: string;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

// Deliverable stored in D1
export interface StoredDeliverable {
  id: string;
  request_id: string;
  provider_response: string | null;  // JSON string
  content_type: string;
  content: string | null;
  quality_score: number | null;
  quality_metadata: string | null;  // JSON string
  status: string;
  post_processing_chain: string | null;  // JSON string
  post_processing_status: string | null;
  final_output: string | null;  // JSON string
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

// Quality assessment result
export interface QualityAssessment {
  score: number;  // 0.0 to 1.0
  passed: boolean;
  issues: string[];
  metadata: Record<string, unknown>;
}

// Post-processing step
export interface PostProcessingStep {
  type: string;  // 'grade_images', 'adjust_copy', 'combine', etc.
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
}

// Callback payload for client apps
export interface CallbackPayload {
  request_id: string;
  status: 'completed' | 'failed';
  deliverable_id?: string;
  content_type?: string;
  content?: string;
  quality_score?: number;
  error?: string;
  timestamp: string;
}

// Response types
export interface DeliveryResponse {
  success: boolean;
  deliverable_id?: string;
  status?: string;
  error?: string;
}

export interface ErrorResponse {
  error: string;
  error_code: string;
  request_id?: string;
}
