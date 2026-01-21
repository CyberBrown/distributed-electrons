/**
 * Intake Worker Types
 */

// Environment bindings
export interface Env {
  // Durable Objects
  REQUEST_ROUTER: DurableObjectNamespace;
  RATE_LIMITER: DurableObjectNamespace;

  // Cloudflare Workflows
  VIDEO_RENDER_WORKFLOW: Workflow;
  CODE_EXECUTION_WORKFLOW: Workflow;
  PRODUCT_SHIPPING_RESEARCH_WORKFLOW: Workflow;

  // D1 Database
  DB: D1Database;

  // Environment variables
  CONFIG_SERVICE_URL: string;
  DEFAULT_INSTANCE_ID?: string;
}

// Workflow binding type (Cloudflare Workflows)
export interface Workflow {
  create(options: { id?: string; params: Record<string, unknown> }): Promise<WorkflowInstance>;
  get(id: string): Promise<WorkflowInstance>;
}

export interface WorkflowInstance {
  id: string;
  status(): Promise<{ status: string; output?: unknown; error?: string }>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  terminate(): Promise<void>;
  restart(): Promise<void>;
}

// Timeline types for video rendering (mirrors render-service types)
export interface Timeline {
  soundtrack?: {
    src: string;
    effect?: 'fadeIn' | 'fadeOut' | 'fadeInFadeOut';
    volume?: number;
  };
  tracks: Track[];
}

export interface Track {
  clips: Clip[];
}

export interface Clip {
  asset: Asset;
  start: number;
  length: number;
  fit?: 'crop' | 'cover' | 'contain' | 'none';
  scale?: number;
  position?: string;
  offset?: { x: number; y: number };
  transition?: { in?: string; out?: string };
  effect?: string;
  filter?: string;
  opacity?: number;
}

export interface Asset {
  type: 'video' | 'image' | 'audio' | 'title' | 'html';
  src?: string;
  text?: string;
  html?: string;
  css?: string;
  width?: number;
  height?: number;
  background?: string;
  color?: string;
  trim?: number;
  volume?: number;
}

export interface OutputConfig {
  format?: 'mp4' | 'gif' | 'mp3';
  resolution?: 'hd' | 'sd' | '1080' | '720' | '480';
  fps?: number;
  quality?: 'high' | 'medium' | 'low';
}

// Incoming request from client app
export interface IntakePayload {
  query: string;
  app_id?: string;
  instance_id?: string;
  task_type?: 'text' | 'image' | 'audio' | 'video' | 'code' | 'context' | 'product-shipping';
  provider?: string;
  model?: string;
  priority?: number;
  callback_url?: string;
  metadata?: Record<string, unknown>;
  // Video rendering specific fields
  timeline?: Timeline;
  output?: OutputConfig;
  // Code execution specific fields
  repo_url?: string;
  executor?: 'claude' | 'gemini';  // DEPRECATED: Use model_waterfall or primary_model instead
  task_id?: string;
  prompt?: string;  // Alternative to query for code tasks
  timeout_ms?: number;  // Execution timeout in milliseconds (default: 300000)

  // Product shipping research specific fields
  product?: {
    sku: string;
    name: string;
    brand?: string;
    description?: string;
    image_urls?: string[];
  };

  // NEW: Model-specific routing (enhanced waterfall support)
  model_waterfall?: string[];        // Ordered list of models to try (e.g., ["gemini-2.0-flash-exp", "claude-sonnet-4.5"])
  primary_model?: string;            // Shorthand for single model preference (e.g., "claude-opus-4.5")

  // NEW: Time-based priority overrides
  override_until?: string;           // ISO timestamp - when the override expires
  override_waterfall?: string[];     // Temporary waterfall order until override_until
}

// Response to client
export interface IntakeResponse {
  success: boolean;
  request_id?: string;
  status?: string;
  queue_position?: number;
  estimated_wait_ms?: number;
  // Workflow-specific fields
  workflow_instance_id?: string;
  workflow_name?: string;
  message?: string;
  // Error fields
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
  // Workflow tracking fields (added in migration 005)
  workflow_instance_id: string | null;
  workflow_name: string | null;
}

// Error response
export interface ErrorResponse {
  error: string;
  error_code: string;
  request_id?: string;
  details?: Record<string, unknown>;
}
