/**
 * Sandbox Executor Worker Types
 * Handles Claude Code execution, Cloudflare deployment, and GitHub integration
 */

// ============================================================================
// Environment & Configuration
// ============================================================================

export interface Env {
  // Cloudflare deployment secrets
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;

  // GitHub integration secrets
  GITHUB_PAT: string;

  // Claude Code execution
  ANTHROPIC_API_KEY: string;

  // Optional bindings
  RATE_LIMITER?: DurableObjectNamespace;
  EXECUTION_STORAGE?: R2Bucket;
}

// ============================================================================
// Execute Endpoint Types
// ============================================================================

export interface ExecuteRequest {
  /** The task/prompt for Claude Code to execute */
  task: string;
  /** Optional context or additional instructions */
  context?: string;
  /** Working directory or project context */
  project?: string;
  /** Auto-deploy generated worker code to Cloudflare */
  auto_deploy?: boolean;
  /** Cloudflare worker name for auto-deploy */
  worker_name?: string;

  // GitHub integration
  /** GitHub repository to work with (owner/repo format, e.g., "Logos-Flux/nexus") */
  repo?: string;
  /** Branch to work on (default: main) */
  branch?: string;
  /** Commit message for changes (auto-generated if not provided) */
  commitMessage?: string;
  /** Paths to fetch from repo (default: fetches common code files) */
  paths?: string[];
  /** Skip committing changes back to repo */
  skipCommit?: boolean;

  // Legacy fields (kept for backwards compatibility)
  /** @deprecated Use repo instead */
  github_repo?: string;
  /** @deprecated Use branch instead */
  github_branch?: string;
  /** @deprecated Use commitMessage instead */
  commit_message?: string;
  /** @deprecated Use !skipCommit instead */
  auto_commit?: boolean;

  /** Execution options */
  options?: ExecuteOptions;
}

export interface ExecuteOptions {
  /** Maximum execution time in seconds */
  timeout?: number;
  /** Maximum tokens for Claude response */
  max_tokens?: number;
  /** Temperature for Claude response */
  temperature?: number;
}

export interface ExecuteResponse {
  success: boolean;
  /** Execution ID for tracking */
  execution_id: string;
  /** Claude Code output/result */
  result?: ExecutionResult;
  /** Deployment result if auto_deploy was true */
  deployment?: DeploymentResult;
  /** GitHub commit result if auto_commit was true */
  commit?: GitHubCommitResult;
  /** Error details if failed */
  error?: string;
  error_code?: string;
  timestamp: string;
}

export interface ExecutionResult {
  /** Generated code or text output */
  output: string;
  /** Files generated/modified */
  files?: GeneratedFile[];
  /** Execution metadata */
  metadata?: {
    tokens_used?: number;
    execution_time_ms?: number;
  };
}

export interface GeneratedFile {
  /** File path (relative) */
  path: string;
  /** File content */
  content: string;
  /** File type/language */
  type?: string;
}

// ============================================================================
// Deploy Endpoint Types
// ============================================================================

export interface DeployRequest {
  /** Worker name for deployment */
  worker_name: string;
  /** Worker source code */
  code: string;
  /** Optional wrangler.toml content */
  wrangler_config?: string;
  /** Worker compatibility date */
  compatibility_date?: string;
  /** Enable workers.dev subdomain */
  workers_dev?: boolean;
  /** Environment variables to set */
  env_vars?: Record<string, string>;
  /** Secrets to set (will be encrypted) */
  secrets?: Record<string, string>;
  /** Custom routes */
  routes?: string[];
}

export interface DeploymentResult {
  success: boolean;
  /** Deployed worker URL */
  url?: string;
  /** Worker ID */
  worker_id?: string;
  /** Deployment version */
  version?: string;
  /** Error message if failed */
  error?: string;
  /** Deployment timestamp */
  deployed_at?: string;
}

// ============================================================================
// GitHub Endpoint Types
// ============================================================================

export interface GitHubCommitRequest {
  /** Repository in owner/repo format */
  repo: string;
  /** Branch to commit to */
  branch?: string;
  /** Files to commit */
  files: GitHubFileChange[];
  /** Commit message */
  message: string;
  /** Create branch if it doesn't exist */
  create_branch?: boolean;
  /** Base branch for new branch (default: main) */
  base_branch?: string;
  /** Create a pull request after commit */
  create_pr?: boolean;
  /** PR title (if create_pr is true) */
  pr_title?: string;
  /** PR body (if create_pr is true) */
  pr_body?: string;
}

export interface GitHubFileChange {
  /** File path in repo */
  path: string;
  /** File content (null to delete) */
  content: string | null;
  /** Encoding (default: utf-8) */
  encoding?: 'utf-8' | 'base64';
}

export interface GitHubCommitResult {
  success: boolean;
  /** Commit SHA */
  sha?: string;
  /** Commit URL */
  url?: string;
  /** Branch committed to */
  branch?: string;
  /** Pull request URL if created */
  pr_url?: string;
  /** Error message if failed */
  error?: string;
}

// ============================================================================
// Common Types
// ============================================================================

export interface ErrorResponse {
  error: string;
  error_code: string;
  request_id: string;
  details?: Record<string, unknown>;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  service: string;
  timestamp: string;
  version?: string;
  checks?: {
    cloudflare?: boolean;
    github?: boolean;
    anthropic?: boolean;
  };
}

// ============================================================================
// Internal Types
// ============================================================================

export interface CloudflareDeployPayload {
  name: string;
  script: string;
  bindings?: CloudflareBinding[];
  compatibility_date?: string;
  compatibility_flags?: string[];
  routes?: { pattern: string; custom_domain?: boolean }[];
}

export interface CloudflareBinding {
  type: 'plain_text' | 'secret_text' | 'kv_namespace' | 'r2_bucket' | 'durable_object_namespace';
  name: string;
  text?: string;
  namespace_id?: string;
  bucket_name?: string;
  class_name?: string;
  script_name?: string;
}

export interface GitHubTreeEntry {
  path: string;
  mode: '100644' | '100755' | '040000' | '160000' | '120000';
  type: 'blob' | 'tree' | 'commit';
  sha?: string | null;
  content?: string;
}

export interface GitHubCreateTreeResponse {
  sha: string;
  url: string;
  tree: GitHubTreeEntry[];
}

export interface GitHubCreateCommitResponse {
  sha: string;
  url: string;
  html_url: string;
  message: string;
}

// ============================================================================
// GitHub Repo Content Types
// ============================================================================

export interface RepoFile {
  /** File path relative to repo root */
  path: string;
  /** File content */
  content: string;
  /** SHA of the file blob */
  sha: string;
  /** File size in bytes */
  size: number;
}

export interface RepoContext {
  /** Repository in owner/repo format */
  repo: string;
  /** Branch name */
  branch: string;
  /** Head commit SHA */
  headSha: string;
  /** Files fetched from the repo */
  files: RepoFile[];
  /** Tree SHA for the commit */
  treeSha: string;
}

export interface GitHubTreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}
