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

// ============================================================================
// Text Generation Workflow Types
// ============================================================================

/**
 * Parameters for TextGenerationWorkflow
 */
export interface TextGenerationParams {
  /** Unique request identifier */
  request_id: string;

  /** The prompt to generate text for */
  prompt: string;

  /** System prompt (optional) */
  system_prompt?: string;

  /** Maximum tokens to generate */
  max_tokens?: number;

  /** Temperature for generation */
  temperature?: number;

  /** Optional callback URL for completion notification */
  callback_url?: string;

  /** Execution timeout in milliseconds (default: 60000 = 1 minute) */
  timeout_ms?: number;
}

/**
 * Provider in the text generation waterfall
 */
export type TextProvider =
  | 'claude-runner'
  | 'gemini-runner'
  | 'nemotron'
  | 'zai'
  | 'anthropic'
  | 'gemini'
  | 'openai';

/**
 * Provider availability status
 */
export interface ProviderStatus {
  provider: TextProvider;
  available: boolean;
  queue_depth?: number;
  reason?: string;
}

/**
 * Result from text generation
 */
export interface TextGenerationResult {
  success: boolean;
  request_id: string;
  provider: TextProvider;
  text?: string;
  error?: string;
  tokens_used?: number;
  duration_ms: number;
  attempted_providers: TextProvider[];
}

/**
 * Environment bindings for TextGenerationWorkflow
 */
export interface TextGenerationEnv {
  /** Claude runner URL (on-prem via Cloudflare Tunnel) */
  CLAUDE_RUNNER_URL?: string;

  /** Gemini runner URL (on-prem via Cloudflare Tunnel) */
  GEMINI_RUNNER_URL?: string;

  /** Runner authentication secrets */
  RUNNER_SECRET?: string;
  GEMINI_RUNNER_SECRET?: string;

  /** Cloudflare Access credentials for protected runners */
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;

  /** Nemotron/Spark vLLM URL */
  SPARK_VLLM_URL?: string;

  /** Cloudflare AI Gateway token - when set, routes API calls through Gateway */
  CF_AIG_TOKEN?: string;

  /** z.ai API key (direct API - not routed through Gateway) */
  ZAI_API_KEY?: string;

  /** Anthropic API key (fallback if no Gateway token) */
  ANTHROPIC_API_KEY?: string;

  /** Gemini API key (fallback if no Gateway token) */
  GEMINI_API_KEY?: string;

  /** OpenAI API key (fallback if no Gateway token) */
  OPENAI_API_KEY?: string;

  /** Nexus API URL for queue checking */
  NEXUS_API_URL?: string;

  /** Nexus passphrase */
  NEXUS_PASSPHRASE?: string;

  /** Queue depth threshold - skip runners if queue exceeds this */
  QUEUE_DEPTH_THRESHOLD?: string;
}

// ============================================================================
// Nexus Callback Types
// ============================================================================

/**
 * Extended environment bindings with Nexus configuration
 * Extends CodeExecutionEnv with Nexus-specific settings
 */
export interface NexusEnv extends CodeExecutionEnv {
  /** Nexus MCP server API URL */
  NEXUS_API_URL?: string;

  /** Nexus write passphrase for authentication */
  NEXUS_PASSPHRASE?: string;

  /** ntfy topic for quarantine notifications (optional) */
  NTFY_TOPIC?: string;

  /** Sandbox executor URL for delegating code execution */
  SANDBOX_EXECUTOR_URL?: string;

  /** Sandbox executor API key (optional) */
  SANDBOX_EXECUTOR_SECRET?: string;
}

/**
 * Result from code execution to report to Nexus
 */
export interface NexusExecutionResult {
  task_id: string;
  success: boolean;
  output?: string;
  error?: string;
  exit_code?: number;
  executor_used: string;
  duration_ms: number;
}

/**
 * Nexus task update payload
 */
export interface NexusTaskUpdatePayload {
  task_id: string;
  status: 'completed' | 'failed' | 'quarantined';
  result?: {
    output?: string;
    error?: string;
    exit_code?: number;
    executor: string;
    duration_ms: number;
  };
  retry_count?: number;
  quarantine_reason?: string;
}

/**
 * Nexus API response
 */
export interface NexusResponse {
  success: boolean;
  task_id?: string;
  status?: string;
  retry_count?: number;
  error?: string;
}

// ============================================================================
// Prime Workflow Types
// ============================================================================

/**
 * Task type classification for routing
 */
export type TaskType = 'code' | 'text' | 'video';

/**
 * Workflow binding type (for Cloudflare Workflows)
 */
interface Workflow {
  create(options?: { id?: string; params?: unknown }): Promise<WorkflowInstance>;
  get(id: string): Promise<WorkflowInstance>;
}

interface WorkflowInstance {
  id: string;
  status(): Promise<{
    status: 'queued' | 'running' | 'paused' | 'complete' | 'errored' | 'terminated' | 'waiting';
    output?: unknown;
    error?: string;
  }>;
}

/**
 * Parameters for PrimeWorkflow - the unified entry point
 */
export interface PrimeWorkflowParams {
  /** Unique task identifier from caller */
  task_id: string;

  /** Task title (used for classification) */
  title: string;

  /** Full task description */
  description: string;

  /** Task context - provides signals for classification */
  context?: {
    /** GitHub repo (owner/repo format) - signals code task */
    repo?: string;
    /** Target branch for code changes */
    branch?: string;
    /** Relevant file paths */
    files?: string[];
    /** Video timeline - signals video task */
    timeline?: Timeline;
    /** Video output config */
    output?: OutputConfig;
    /** System prompt for text generation */
    system_prompt?: string;
    /** Domain area (work, personal, etc.) */
    domain?: string;
    /** Energy required (low, medium, high) */
    energy_required?: string;
    /** Parent idea if from Nexus idea execution */
    parent_idea?: object;
  };

  /** Hints from the caller - suggestions only, DE decides */
  hints?: {
    /** Suggested workflow type */
    workflow?: 'code-execution' | 'text-generation' | 'video-render';
    /** Suggested provider (e.g., 'claude', 'gemini') */
    provider?: string;
    /** Suggested model (e.g., 'claude-3-opus') */
    model?: string;
  };

  /** Callback URL for result notification */
  callback_url?: string;

  /** Overall timeout in milliseconds (default: 300000 = 5 min) */
  timeout_ms?: number;
}

/**
 * Result from PrimeWorkflow execution
 */
export interface PrimeWorkflowResult {
  success: boolean;
  task_id: string;
  task_type: TaskType;
  sub_workflow_id?: string;
  runner_used?: string;
  output?: string;
  error?: string;
  duration_ms: number;
}

/**
 * Environment bindings for PrimeWorkflow
 */
export interface PrimeEnv extends NexusEnv {
  /** DE Workflows worker URL (for triggering sub-workflows) */
  DE_WORKFLOWS_URL?: string;

  /** Workflow bindings */
  PRIME_WORKFLOW: Workflow;
  CODE_EXECUTION_WORKFLOW: Workflow;
  TEXT_GENERATION_WORKFLOW: Workflow;
  VIDEO_RENDER_WORKFLOW: Workflow;
}
