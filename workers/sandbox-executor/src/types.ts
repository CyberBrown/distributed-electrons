/**
 * Sandbox Executor Worker Types
 * For executing tasks via on-prem runners (Claude and Gemini)
 */

/**
 * Environment bindings for the worker
 */
export interface Env {
  // AI Gateway auth token (for logging)
  CF_AIG_TOKEN?: string;

  // On-prem Claude runner URL (via Cloudflare Tunnel)
  CLAUDE_RUNNER_URL?: string;

  // Secret for authenticating with the on-prem Claude runner
  RUNNER_SECRET?: string;

  // Cloudflare Access service token (for tunnel protection)
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;

  // On-prem Gemini runner URL (via Cloudflare Tunnel)
  // When set with executor_type: 'gemini', requests are delegated to this runner
  GEMINI_RUNNER_URL?: string;

  // Secret for authenticating with the on-prem Gemini runner
  GEMINI_RUNNER_SECRET?: string;

  // Config service URL for status updates
  CONFIG_SERVICE_URL?: string;

  // Internal API key for config-service calls (OAuth refresh, events)
  INTERNAL_API_KEY?: string;

  // Max execution time in ms
  MAX_EXECUTION_TIME?: string;

  // AI Gateway logging configuration
  // URL for logging execution metadata (defaults to standard gateway URL + /log)
  AI_GATEWAY_LOG_URL?: string;

  // Feature flag to enable AI Gateway logging (set to 'true' to enable)
  AI_GATEWAY_LOG_ENABLED?: string;
}

/**
 * Request to execute a task via the on-prem runner
 */
export interface ExecuteRequest {
  // The task/prompt to send to the AI agent
  task: string;

  // Executor type: 'claude' (default) or 'gemini'
  // Determines which on-prem runner to use
  executor_type?: 'claude' | 'gemini';

  // Optional: Git repository to clone and work on
  repo?: string;

  // Optional: Branch to work on
  branch?: string;

  // Optional: Commit message for changes
  commit_message?: string;

  // Optional: Instance ID for multi-tenant scenarios
  instance_id?: string;

  // Optional: Project ID for tracking
  project_id?: string;

  // Optional: Execution options
  options?: ExecuteOptions;
}

/**
 * Options for task execution
 */
export interface ExecuteOptions {
  // Maximum execution time in ms (default: 300000 = 5 min)
  timeout_ms?: number;

  // Whether to return git diff
  include_diff?: boolean;

  // Custom system prompt
  system_prompt?: string;

  // Permission mode for Claude Code
  permission_mode?: 'acceptEdits' | 'full' | 'restricted';

  // Working directory
  working_dir?: string;
}

/**
 * Response from task execution
 */
export interface ExecuteResponse {
  success: boolean;
  request_id: string;
  timestamp: string;
  logs?: string;
  diff?: string;
  result?: string;
  metadata?: {
    execution_time_ms: number;
    runner_duration_ms?: number;
    runner_url?: string;
    delegated_to_runner?: boolean;
    exit_code?: number;
    repo?: string;
    branch?: string;
    commit_sha?: string;
    commit_url?: string;
    pushed?: boolean;
  };
}

/**
 * Error response format
 */
export interface ErrorResponse {
  error: string;
  error_code: string;
  request_id: string;
  details?: Record<string, unknown>;
}

/**
 * Health check response
 */
export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  service: string;
  timestamp: string;
  version?: string;
  runner_url?: string;
  runner_configured?: boolean;
}
