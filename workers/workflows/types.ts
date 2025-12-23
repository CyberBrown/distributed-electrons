/**
 * DE Workflows Types
 * Shared types for Cloudflare Workflows in Distributed Electrons
 */

// Re-export timeline types from render-service
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
  position?: 'top' | 'topRight' | 'right' | 'bottomRight' | 'bottom' | 'bottomLeft' | 'left' | 'topLeft' | 'center';
  offset?: { x: number; y: number };
  transition?: {
    in?: string;
    out?: string;
  };
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
  crop?: { top: number; bottom: number; left: number; right: number };
}

export interface OutputConfig {
  format?: 'mp4' | 'gif' | 'mp3';
  resolution?: 'hd' | 'sd' | '1080' | '720' | '480';
  fps?: number;
  quality?: 'high' | 'medium' | 'low';
}

/**
 * Environment bindings for DE Workflows
 */
export interface Env {
  // D1 Database for request tracking
  DB: D1Database;

  // R2 bucket for storing rendered videos (optional)
  R2_BUCKET?: R2Bucket;

  // URLs for HTTP communication (workflows can't use service bindings)
  DELIVERY_URL: string;

  // Shotstack configuration
  SHOTSTACK_API_KEY: string;
  SHOTSTACK_ENV: 'v1' | 'stage';
}

/**
 * Parameters for VideoRenderWorkflow
 */
export interface VideoRenderParams {
  request_id: string;
  app_id: string;
  instance_id?: string;
  timeline: Timeline;
  output?: OutputConfig;
  callback_url?: string;
}

/**
 * Result from Shotstack render submission
 */
export interface ShotstackSubmitResult {
  id: string;
}

/**
 * Result from Shotstack status poll
 */
export interface ShotstackStatusResult {
  status: 'queued' | 'fetching' | 'rendering' | 'saving' | 'done' | 'failed';
  progress?: number;
  url?: string;
  error?: string;
}

/**
 * Final render result
 */
export interface RenderResult {
  video_url: string;
  status: 'done';
  duration_ms?: number;
}

/**
 * Delivery payload sent to Delivery Worker
 */
export interface DeliveryPayload {
  request_id: string;
  success: boolean;
  content_type: 'video_url';
  content: string;
  provider: 'shotstack';
  raw_response?: RenderResult;
  error?: string;
}

/**
 * Callback payload sent to client
 */
export interface CallbackPayload {
  request_id: string;
  status: 'completed' | 'failed';
  content_type?: 'video_url';
  content?: string;
  error?: string;
  timestamp: string;
}

// ============================================================================
// Code Execution Workflow Types
// ============================================================================

/**
 * Environment bindings for CodeExecutionWorkflow
 */
export interface CodeExecutionEnv {
  // D1 Database for task tracking
  DB?: D1Database;

  // Runner URLs (via Cloudflare Tunnel)
  CLAUDE_RUNNER_URL?: string;
  GEMINI_RUNNER_URL?: string;

  // Runner authentication secrets
  RUNNER_SECRET?: string;
  GEMINI_RUNNER_SECRET?: string;

  // Cloudflare Access service token (for protected runners)
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;

  // Config service URL for event emission
  CONFIG_SERVICE_URL?: string;
}

/**
 * Parameters for CodeExecutionWorkflow
 */
export interface CodeExecutionParams {
  /** Unique task identifier from Nexus */
  task_id: string;

  /** The prompt/task to execute */
  prompt: string;

  /** Optional repository URL to clone before execution */
  repo_url?: string;

  /** Preferred executor: 'claude' (default) or 'gemini' */
  preferred_executor?: 'claude' | 'gemini';

  /** Optional context to pass to the executor */
  context?: Record<string, unknown>;

  /** Optional callback URL for completion notification */
  callback_url?: string;

  /** Execution timeout in milliseconds (default: 300000 = 5 minutes) */
  timeout_ms?: number;
}

/**
 * Response from on-prem runners (Claude or Gemini)
 */
export interface RunnerResponse {
  success: boolean;
  output?: string;
  error?: string;
  exit_code?: number;
  duration_ms?: number;
}

/**
 * Result from code execution
 */
export interface ExecutionResult {
  success: boolean;
  task_id: string;
  executor: 'claude' | 'gemini';
  output?: string;
  error?: string;
  exit_code?: number;
  quarantine?: boolean;
  duration_ms: number;
}

/**
 * Code execution callback payload sent to client
 */
export interface CodeExecutionCallbackPayload {
  task_id: string;
  status: 'completed' | 'failed' | 'quarantined';
  executor: 'claude' | 'gemini';
  output?: string;
  error?: string;
  duration_ms: number;
  timestamp: string;
}
