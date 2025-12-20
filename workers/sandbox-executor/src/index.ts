/**
 * Sandbox Executor Worker
 * Executes Claude tasks via two approaches:
 * 1. SDK approach (POST /execute/sdk) - Base Anthropic SDK via AI Gateway, lightweight
 * 2. Sandbox approach (POST /execute) - Full container isolation with CLI
 *
 * Endpoints:
 * - POST /execute/sdk - Execute using Anthropic SDK via AI Gateway (recommended)
 * - POST /execute - Execute using Claude Code CLI in sandbox container
 * - POST /debug - Debug endpoint for testing container execution
 * - GET /health - Health check endpoint
 *
 * @version 1.6.0 - Added Claude OAuth support for Max subscription
 */

import { getSandbox } from '@cloudflare/sandbox';
import Anthropic from '@anthropic-ai/sdk';
import type {
  Env,
  ExecuteRequest,
  ExecuteResponse,
  ErrorResponse,
  HealthResponse,
  CommandResult,
  SDKExecuteRequest,
  SDKExecuteResponse,
  CreateRepoOptions,
  GitCommitResult,
} from './types';

// Re-export Sandbox for Durable Object binding
export { Sandbox } from '@cloudflare/sandbox';

/**
 * AI Gateway configuration
 */
const AI_GATEWAY_URL =
  'https://gateway.ai.cloudflare.com/v1/52b1c60ff2a24fb21c1ef9a429e63261/de-gateway/anthropic';

/**
 * Default system prompt for SDK execution
 */
const DEFAULT_SDK_SYSTEM_PROMPT =
  'You are a helpful AI assistant. Provide clear, concise, and accurate responses.';

/**
 * Default system prompt for sandbox/CLI tasks
 * Instructs Claude to apply changes without committing
 */
const DEFAULT_SANDBOX_SYSTEM_PROMPT =
  'You are an automatic feature-implementer/bug-fixer. ' +
  'You apply all necessary changes to achieve the user request. You must ensure you DO NOT commit the changes, ' +
  'so the pipeline can read the local `git diff` and apply the change upstream.';

/**
 * Map model shorthand to full model ID
 */
function getModelId(model?: string): string {
  const modelMap: Record<string, string> = {
    opus: 'claude-opus-4-20250514',
    sonnet: 'claude-sonnet-4-20250514',
    haiku: 'claude-3-5-haiku-20241022',
  };
  return modelMap[model || 'sonnet'] || model || 'claude-sonnet-4-20250514';
}

/**
 * Helper to extract output from command result
 */
function getOutput(result: CommandResult): string {
  return result.success ? result.stdout : result.stderr;
}

/**
 * Format command result for detailed logging
 */
function formatCommandResult(cmd: string, result: CommandResult): string {
  return JSON.stringify({
    command: cmd,
    success: result.success,
    exitCode: result.exitCode,
    stdout: result.stdout?.slice(0, 1000) || '',
    stderr: result.stderr?.slice(0, 1000) || '',
    stdoutLength: result.stdout?.length || 0,
    stderrLength: result.stderr?.length || 0,
  }, null, 2);
}

/**
 * Debug info interface for tracking execution steps
 */
interface DebugInfo {
  steps: Array<{
    step: string;
    timestamp: string;
    duration_ms?: number;
    result?: unknown;
    error?: string;
  }>;
  environment: {
    has_anthropic_key: boolean;
    has_github_pat: boolean;
    has_oauth_credentials: boolean;
    sandbox_id: string;
  };
}

/**
 * Add a debug step to tracking
 */
function addDebugStep(
  debug: DebugInfo,
  step: string,
  result?: unknown,
  error?: string,
  startTime?: number
): void {
  debug.steps.push({
    step,
    timestamp: new Date().toISOString(),
    duration_ms: startTime ? Date.now() - startTime : undefined,
    result,
    error,
  });
}

// ============================================================================
// GitHub Repository Helpers
// ============================================================================

/**
 * Sanitize a string for use as GitHub repo description
 * Removes control characters, collapses whitespace, and truncates
 */
function sanitizeDescription(desc: string): string {
  return desc
    .replace(/[\n\r\t\x00-\x1F\x7F]/g, ' ') // Replace control chars with spaces
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim()
    .slice(0, 350); // GitHub limit is 350 chars
}

/**
 * Common headers for GitHub API requests
 */
function getGitHubHeaders(env: Env): Record<string, string> {
  return {
    Authorization: `token ${env.GITHUB_PAT}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent': 'sandbox-executor',
  };
}

/**
 * Check if a GitHub repository exists
 */
async function checkRepoExists(owner: string, repo: string, env: Env): Promise<boolean> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: getGitHubHeaders(env),
  });
  return response.status === 200;
}

/**
 * Check if an owner is an organization (vs a user)
 */
async function checkIfOrg(owner: string, env: Env): Promise<boolean> {
  const response = await fetch(`https://api.github.com/users/${owner}`, {
    headers: getGitHubHeaders(env),
  });
  if (response.ok) {
    const data = (await response.json()) as { type: string };
    return data.type === 'Organization';
  }
  return false;
}

/**
 * Create a new GitHub repository
 * Uses different endpoints for org vs user repos
 */
async function createRepo(
  owner: string,
  repo: string,
  env: Env,
  options: CreateRepoOptions = {}
): Promise<void> {
  const isOrg = await checkIfOrg(owner, env);

  // Different endpoints for org vs user repos
  const url = isOrg
    ? `https://api.github.com/orgs/${owner}/repos`
    : `https://api.github.com/user/repos`;

  const description = sanitizeDescription(options.description || 'Created by sandbox-executor');

  const response = await fetch(url, {
    method: 'POST',
    headers: getGitHubHeaders(env),
    body: JSON.stringify({
      name: repo,
      description,
      private: options.private ?? false,
      auto_init: options.autoInit ?? true, // Creates default branch with README
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create repo ${owner}/${repo}: ${response.status} - ${error}`);
  }

  console.log(`Created repo: ${owner}/${repo}`);
}

/**
 * Ensure a GitHub repository exists, creating it if needed
 * Returns whether a new repo was created
 */
async function ensureRepoExists(
  owner: string,
  repo: string,
  env: Env,
  options?: CreateRepoOptions
): Promise<{ created: boolean }> {
  const exists = await checkRepoExists(owner, repo, env);

  if (!exists) {
    console.log(`Repo ${owner}/${repo} not found, creating...`);
    await createRepo(owner, repo, env, options);

    // Brief delay for GitHub to initialize the repo fully
    await new Promise((resolve) => setTimeout(resolve, 2000));

    return { created: true };
  }

  return { created: false };
}

/**
 * Main worker entry point
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID();

    try {
      const url = new URL(request.url);

      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
            'Access-Control-Max-Age': '86400',
          },
        });
      }

      // Route handling
      // SDK-based execution via AI Gateway (recommended - lighter weight)
      if (url.pathname === '/execute/sdk' && request.method === 'POST') {
        const response = await handleSDKExecute(request, env, requestId);
        return addCorsHeaders(response);
      }

      // Sandbox/CLI-based execution (full container isolation)
      if (url.pathname === '/execute' && request.method === 'POST') {
        const response = await handleExecute(request, env, requestId);
        return addCorsHeaders(response);
      }

      // Debug endpoint for testing container execution
      if (url.pathname === '/debug' && request.method === 'POST') {
        const response = await handleDebugExecute(request, env, requestId);
        return addCorsHeaders(response);
      }

      if (url.pathname === '/health' && request.method === 'GET') {
        const healthResponse: HealthResponse = {
          status: 'healthy',
          service: 'sandbox-executor',
          timestamp: new Date().toISOString(),
          version: '1.6.0',
        };
        return addCorsHeaders(Response.json(healthResponse));
      }

      return addCorsHeaders(
        createErrorResponse('Not Found', 'ROUTE_NOT_FOUND', requestId, 404)
      );
    } catch (error) {
      console.error('Unhandled error:', error);
      return addCorsHeaders(
        createErrorResponse(
          error instanceof Error ? error.message : 'Internal Server Error',
          'INTERNAL_ERROR',
          requestId,
          500
        )
      );
    }
  },
};

/**
 * Handle SDK-based execution via AI Gateway
 * Uses base Anthropic SDK with Cloudflare AI Gateway for BYOK
 */
async function handleSDKExecute(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  const startTime = Date.now();

  try {
    // Parse request body
    const body: SDKExecuteRequest = await request.json();

    // Validate request
    if (!body.prompt || body.prompt.trim() === '') {
      return createErrorResponse(
        'Prompt is required',
        'INVALID_REQUEST',
        requestId,
        400
      );
    }

    // Validate AI Gateway token is configured
    if (!env.CF_AIG_TOKEN) {
      return createErrorResponse(
        'CF_AIG_TOKEN not configured',
        'MISSING_GATEWAY_TOKEN',
        requestId,
        500
      );
    }

    // Build options
    const model = getModelId(body.options?.model);
    const maxTokens = body.options?.max_tokens || 1024;
    const systemPrompt = body.options?.system_prompt || DEFAULT_SDK_SYSTEM_PROMPT;

    console.log(`Executing SDK query via AI Gateway (model: ${model})`);

    // Create Anthropic client with AI Gateway + BYOK
    // The gateway has the Anthropic API key stored, so we:
    // - Use cf-aig-authorization to auth with the gateway
    // - Strip x-api-key header so gateway injects its stored key
    const anthropic = new Anthropic({
      apiKey: 'placeholder', // Required by SDK but will be stripped
      baseURL: AI_GATEWAY_URL,
      defaultHeaders: {
        'cf-aig-authorization': `Bearer ${env.CF_AIG_TOKEN}`,
        'anthropic-version': '2023-06-01',
      },
      fetch: async (url, init) => {
        // Strip x-api-key header - gateway will inject its BYOK key
        const headers = new Headers(init?.headers);
        headers.delete('x-api-key');
        return fetch(url, { ...init, headers });
      },
    });

    // Execute the query
    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: body.prompt }],
    });

    const executionTime = Date.now() - startTime;

    // Extract text from response
    const resultText = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    // Calculate cost estimate (approximate)
    const inputTokens = response.usage?.input_tokens || 0;
    const outputTokens = response.usage?.output_tokens || 0;

    // Build response
    const sdkResponse: SDKExecuteResponse = {
      success: true,
      request_id: requestId,
      timestamp: new Date().toISOString(),
      result: resultText,
      metadata: {
        execution_time_ms: executionTime,
        model,
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        },
        stop_reason: response.stop_reason,
      },
    };

    return Response.json(sdkResponse, {
      headers: {
        'X-Request-ID': requestId,
      },
    });
  } catch (error) {
    console.error('SDK execution error:', error);

    // Handle specific error types
    if (error instanceof Anthropic.APIError) {
      const errorDetails = {
        status: error.status,
        message: error.message,
        headers: error.headers,
      };
      console.error('Anthropic API error details:', errorDetails);

      if (error.status === 429) {
        return createErrorResponse('Rate limit exceeded', 'RATE_LIMITED', requestId, 429);
      }

      if (error.status === 401 || error.status === 403) {
        return createErrorResponse(
          `Auth error (${error.status}): ${error.message}`,
          'AUTH_ERROR',
          requestId,
          error.status
        );
      }

      return createErrorResponse(error.message, 'API_ERROR', requestId, error.status || 500);
    }

    // Log full error for debugging
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Non-API error:', errorMessage);

    return createErrorResponse(errorMessage, 'SDK_EXECUTION_ERROR', requestId, 500);
  }
}

/**
 * Debug endpoint for testing container execution without Claude
 * Tests: sandbox creation, env vars, basic commands, file operations
 */
async function handleDebugExecute(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  const startTime = Date.now();
  const sandboxId = crypto.randomUUID().slice(0, 8);

  const debug: DebugInfo = {
    steps: [],
    environment: {
      has_anthropic_key: !!env.ANTHROPIC_API_KEY,
      has_github_pat: !!env.GITHUB_PAT,
      has_oauth_credentials: !!env.CLAUDE_OAUTH_CREDENTIALS,
      sandbox_id: sandboxId,
    },
  };

  try {
    // Parse optional command from request body
    let customCommand: string | undefined;
    try {
      const body = await request.json() as { command?: string };
      customCommand = body.command;
    } catch {
      // No body or invalid JSON is fine
    }

    addDebugStep(debug, 'request_parsed', { customCommand });

    // Step 1: Create sandbox
    const sandboxStartTime = Date.now();
    console.log(`[DEBUG ${requestId}] Creating sandbox ${sandboxId}...`);
    const sandbox = getSandbox(env.Sandbox, sandboxId);
    addDebugStep(debug, 'sandbox_created', { sandboxId }, undefined, sandboxStartTime);

    // Step 2: Set environment variables
    const envStartTime = Date.now();
    console.log(`[DEBUG ${requestId}] Setting environment variables...`);
    try {
      await sandbox.setEnvVars({
        ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY || 'not-set',
        GITHUB_PAT: env.GITHUB_PAT || 'not-set',
        DEBUG_MODE: 'true',
      });
      addDebugStep(debug, 'env_vars_set', { success: true }, undefined, envStartTime);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      addDebugStep(debug, 'env_vars_set', null, errMsg, envStartTime);
      console.error(`[DEBUG ${requestId}] Failed to set env vars: ${errMsg}`);
    }

    // Step 3: Test basic command - echo
    const echoStartTime = Date.now();
    console.log(`[DEBUG ${requestId}] Testing echo command...`);
    const echoResult = await sandbox.exec('echo "Hello from sandbox"') as CommandResult;
    console.log(`[DEBUG ${requestId}] Echo result: ${formatCommandResult('echo', echoResult)}`);
    addDebugStep(debug, 'echo_test', {
      success: echoResult.success,
      exitCode: echoResult.exitCode,
      stdout: echoResult.stdout,
      stderr: echoResult.stderr,
    }, undefined, echoStartTime);

    // Step 4: Test pwd (working directory)
    const pwdStartTime = Date.now();
    console.log(`[DEBUG ${requestId}] Testing pwd command...`);
    const pwdResult = await sandbox.exec('pwd') as CommandResult;
    console.log(`[DEBUG ${requestId}] PWD result: ${formatCommandResult('pwd', pwdResult)}`);
    addDebugStep(debug, 'pwd_test', {
      success: pwdResult.success,
      exitCode: pwdResult.exitCode,
      stdout: pwdResult.stdout?.trim(),
      stderr: pwdResult.stderr,
    }, undefined, pwdStartTime);

    // Step 5: Test environment variable access
    const envCheckStartTime = Date.now();
    console.log(`[DEBUG ${requestId}] Testing env var access...`);
    const envCheckResult = await sandbox.exec('echo "ANTHROPIC_KEY_SET=$([[ -n $ANTHROPIC_API_KEY ]] && echo yes || echo no)"') as CommandResult;
    console.log(`[DEBUG ${requestId}] Env check result: ${formatCommandResult('env_check', envCheckResult)}`);
    addDebugStep(debug, 'env_var_access', {
      success: envCheckResult.success,
      exitCode: envCheckResult.exitCode,
      stdout: envCheckResult.stdout?.trim(),
      stderr: envCheckResult.stderr,
    }, undefined, envCheckStartTime);

    // Step 6: Test file creation
    const fileStartTime = Date.now();
    console.log(`[DEBUG ${requestId}] Testing file creation...`);
    const fileResult = await sandbox.exec('echo "test content" > /tmp/debug-test.txt && cat /tmp/debug-test.txt') as CommandResult;
    console.log(`[DEBUG ${requestId}] File result: ${formatCommandResult('file_test', fileResult)}`);
    addDebugStep(debug, 'file_creation', {
      success: fileResult.success,
      exitCode: fileResult.exitCode,
      stdout: fileResult.stdout?.trim(),
      stderr: fileResult.stderr,
    }, undefined, fileStartTime);

    // Step 7: Check if Claude CLI is available
    const claudeCheckStartTime = Date.now();
    console.log(`[DEBUG ${requestId}] Checking Claude CLI availability...`);
    const claudeCheckResult = await sandbox.exec('which claude || echo "claude not found"') as CommandResult;
    console.log(`[DEBUG ${requestId}] Claude check result: ${formatCommandResult('which_claude', claudeCheckResult)}`);
    addDebugStep(debug, 'claude_cli_check', {
      success: claudeCheckResult.success,
      exitCode: claudeCheckResult.exitCode,
      stdout: claudeCheckResult.stdout?.trim(),
      stderr: claudeCheckResult.stderr,
      claude_available: claudeCheckResult.stdout?.includes('/claude') || false,
    }, undefined, claudeCheckStartTime);

    // Step 8: Check Claude CLI version (if available)
    const claudeVersionStartTime = Date.now();
    console.log(`[DEBUG ${requestId}] Checking Claude CLI version...`);
    const claudeVersionResult = await sandbox.exec('claude --version 2>&1 || echo "version check failed"') as CommandResult;
    console.log(`[DEBUG ${requestId}] Claude version result: ${formatCommandResult('claude_version', claudeVersionResult)}`);
    addDebugStep(debug, 'claude_version', {
      success: claudeVersionResult.success,
      exitCode: claudeVersionResult.exitCode,
      stdout: claudeVersionResult.stdout?.trim(),
      stderr: claudeVersionResult.stderr,
    }, undefined, claudeVersionStartTime);

    // Step 9: Run custom command if provided
    if (customCommand) {
      const customStartTime = Date.now();
      console.log(`[DEBUG ${requestId}] Running custom command: ${customCommand}`);
      const customResult = await sandbox.exec(customCommand) as CommandResult;
      console.log(`[DEBUG ${requestId}] Custom command result: ${formatCommandResult(customCommand, customResult)}`);
      addDebugStep(debug, 'custom_command', {
        command: customCommand,
        success: customResult.success,
        exitCode: customResult.exitCode,
        stdout: customResult.stdout,
        stderr: customResult.stderr,
      }, undefined, customStartTime);
    }

    // Step 10: Test a minimal Claude execution (just --help to verify it runs)
    const claudeHelpStartTime = Date.now();
    console.log(`[DEBUG ${requestId}] Testing Claude CLI help...`);
    const claudeHelpResult = await sandbox.exec('claude --help 2>&1 | head -20') as CommandResult;
    console.log(`[DEBUG ${requestId}] Claude help result: ${formatCommandResult('claude_help', claudeHelpResult)}`);
    addDebugStep(debug, 'claude_help', {
      success: claudeHelpResult.success,
      exitCode: claudeHelpResult.exitCode,
      stdout: claudeHelpResult.stdout?.slice(0, 500),
      stderr: claudeHelpResult.stderr?.slice(0, 500),
    }, undefined, claudeHelpStartTime);

    const executionTime = Date.now() - startTime;
    addDebugStep(debug, 'completed', { total_time_ms: executionTime });

    return Response.json({
      success: true,
      request_id: requestId,
      timestamp: new Date().toISOString(),
      execution_time_ms: executionTime,
      debug,
    }, {
      headers: { 'X-Request-ID': requestId },
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error(`[DEBUG ${requestId}] Fatal error: ${errorMessage}`);
    console.error(`[DEBUG ${requestId}] Stack: ${errorStack}`);

    addDebugStep(debug, 'fatal_error', null, errorMessage);

    return Response.json({
      success: false,
      request_id: requestId,
      timestamp: new Date().toISOString(),
      execution_time_ms: Date.now() - startTime,
      error: errorMessage,
      error_stack: errorStack,
      debug,
    }, {
      status: 500,
      headers: { 'X-Request-ID': requestId },
    });
  }
}

/**
 * Handle sandbox/CLI-based task execution request
 */
async function handleExecute(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  const startTime = Date.now();
  const sandboxId = crypto.randomUUID().slice(0, 8);

  // Initialize debug tracking
  const debug: DebugInfo = {
    steps: [],
    environment: {
      has_anthropic_key: !!env.ANTHROPIC_API_KEY,
      has_github_pat: !!env.GITHUB_PAT,
      has_oauth_credentials: !!env.CLAUDE_OAUTH_CREDENTIALS,
      sandbox_id: sandboxId,
    },
  };

  // Collect all errors for better debugging
  const errors: string[] = [];

  try {
    // Parse request body
    console.log(`[EXEC ${requestId}] Starting execution...`);
    const body: ExecuteRequest = await request.json();
    addDebugStep(debug, 'request_parsed', { task: body.task?.slice(0, 100), repo: body.repo, branch: body.branch });

    // Validate request
    if (!body.task || body.task.trim() === '') {
      return createErrorResponse(
        'Task is required',
        'INVALID_REQUEST',
        requestId,
        400
      );
    }

    // Validate that either API key or OAuth credentials are configured
    if (!env.ANTHROPIC_API_KEY && !env.CLAUDE_OAUTH_CREDENTIALS) {
      return createErrorResponse(
        'Neither ANTHROPIC_API_KEY nor CLAUDE_OAUTH_CREDENTIALS configured',
        'MISSING_AUTH',
        requestId,
        500
      );
    }

    // Create sandbox with unique ID
    console.log(`[EXEC ${requestId}] Creating sandbox ${sandboxId}...`);
    const sandboxStartTime = Date.now();
    const sandbox = getSandbox(env.Sandbox, sandboxId);
    addDebugStep(debug, 'sandbox_created', { sandboxId }, undefined, sandboxStartTime);

    // Set environment variables in sandbox
    // If OAuth credentials are available, do NOT set ANTHROPIC_API_KEY so Claude uses OAuth
    console.log(`[EXEC ${requestId}] Setting environment variables...`);
    const envStartTime = Date.now();
    try {
      const envVars: Record<string, string> = {
        GITHUB_PAT: env.GITHUB_PAT || '', // For git push authentication
      };

      // Only set ANTHROPIC_API_KEY if we don't have OAuth credentials
      // Claude Code will fall back to OAuth if no API key is set
      if (!env.CLAUDE_OAUTH_CREDENTIALS && env.ANTHROPIC_API_KEY) {
        envVars.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
        console.log(`[EXEC ${requestId}] Using API key auth (no OAuth credentials)`);
      } else if (env.CLAUDE_OAUTH_CREDENTIALS) {
        console.log(`[EXEC ${requestId}] Will use OAuth credentials (not setting API key)`);
      }

      await sandbox.setEnvVars(envVars);
      addDebugStep(debug, 'env_vars_set', { success: true, using_api_key: !env.CLAUDE_OAUTH_CREDENTIALS }, undefined, envStartTime);
    } catch (envError) {
      const errMsg = envError instanceof Error ? envError.message : String(envError);
      addDebugStep(debug, 'env_vars_set', null, errMsg, envStartTime);
      errors.push(`Failed to set env vars: ${errMsg}`);
      console.error(`[EXEC ${requestId}] Failed to set env vars: ${errMsg}`);
    }

    // Set up Claude OAuth credentials if available (uses Claude.ai Max subscription)
    let usingOAuth = false;
    if (env.CLAUDE_OAUTH_CREDENTIALS) {
      console.log(`[EXEC ${requestId}] Setting up Claude OAuth credentials...`);
      const oauthStartTime = Date.now();
      try {
        // Create the .claude directory and write credentials
        // The home directory in the sandbox is /root (runs as root)
        const credentialsPath = '/root/.claude/.credentials.json';
        const mkdirResult = await sandbox.exec('mkdir -p /root/.claude') as CommandResult;

        if (!mkdirResult.success) {
          throw new Error(`Failed to create .claude directory: ${mkdirResult.stderr}`);
        }

        // Write the credentials file using printf to handle JSON properly
        // Escape single quotes for the shell by replacing ' with '\''
        const escapedCreds = env.CLAUDE_OAUTH_CREDENTIALS.replace(/'/g, "'\\''");
        const writeResult = await sandbox.exec(
          `printf '%s' '${escapedCreds}' > ${credentialsPath}`
        ) as CommandResult;

        if (!writeResult.success) {
          throw new Error(`Failed to write credentials: ${writeResult.stderr}`);
        }

        // Verify the file was written
        const verifyResult = await sandbox.exec(`cat ${credentialsPath} | head -c 50`) as CommandResult;
        console.log(`[EXEC ${requestId}] Credentials file written, preview: ${verifyResult.stdout?.slice(0, 30)}...`);

        usingOAuth = true;
        addDebugStep(debug, 'oauth_credentials_set', {
          success: true,
          path: credentialsPath,
          using_oauth: true
        }, undefined, oauthStartTime);
        console.log(`[EXEC ${requestId}] Claude OAuth credentials configured successfully`);
      } catch (oauthError) {
        const errMsg = oauthError instanceof Error ? oauthError.message : String(oauthError);
        addDebugStep(debug, 'oauth_credentials_set', null, errMsg, oauthStartTime);
        errors.push(`Failed to set OAuth credentials: ${errMsg}`);
        console.error(`[EXEC ${requestId}] Failed to set OAuth credentials: ${errMsg}`);
        // Continue execution - will fall back to API key if available
      }
    } else {
      console.log(`[EXEC ${requestId}] No OAuth credentials configured, using API key`);
      addDebugStep(debug, 'oauth_credentials_set', {
        success: false,
        reason: 'CLAUDE_OAUTH_CREDENTIALS not configured',
        using_oauth: false
      });
    }

    // Determine working directory and setup
    // Use absolute paths to ensure consistency
    // Note: sandbox runs as root, home is /root, default working dir is /workspace
    const baseDir = '/workspace';
    let workingDir = body.options?.working_dir || baseDir;
    let repoCreated = false;

    // If repo is provided, ensure it exists and clone it
    if (body.repo) {
      // Parse repo - can be "owner/repo" or full URL
      const repoPath = body.repo.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
      const [owner, repoName] = repoPath.split('/');

      if (!owner || !repoName) {
        return createErrorResponse(
          'Invalid repo format. Expected "owner/repo" or GitHub URL',
          'INVALID_REPO_FORMAT',
          requestId,
          400
        );
      }

      // Ensure repo exists (create if needed) - requires GITHUB_PAT
      if (env.GITHUB_PAT) {
        console.log(`Checking if repo ${owner}/${repoName} exists...`);
        const { created } = await ensureRepoExists(owner, repoName, env, {
          description: `Scaffolded by sandbox-executor for task: ${body.task.slice(0, 100)}`,
          private: false,
          autoInit: true,
        });
        repoCreated = created;
        if (created) {
          console.log(`New repo created: ${owner}/${repoName}`);
        } else {
          console.log(`Repo ${owner}/${repoName} already exists`);
        }
      } else {
        console.log('GITHUB_PAT not configured, skipping repo existence check');
      }

      // Clone the repo using absolute path
      const cloneDir = `${baseDir}/${repoName}`;

      // Use authenticated URL for clone if GITHUB_PAT is available
      // This is required for private repos or newly created repos
      const repoUrl = env.GITHUB_PAT
        ? `https://x-access-token:${env.GITHUB_PAT}@github.com/${owner}/${repoName}.git`
        : `https://github.com/${owner}/${repoName}`;

      console.log(`Cloning ${owner}/${repoName} to ${cloneDir} (authenticated: ${!!env.GITHUB_PAT})`);

      // Use git clone directly instead of sandbox.gitCheckout for authenticated URLs
      const cloneResult = await sandbox.exec(
        `git clone "${repoUrl}" "${cloneDir}"`
      ) as CommandResult;

      if (!cloneResult.success) {
        const cloneError = getOutput(cloneResult);
        console.error(`Clone failed: ${cloneError}`);
        throw new Error(`Failed to clone repository: ${cloneError}`);
      }
      console.log(`Clone successful`);

      // Set workingDir to the absolute clone path
      workingDir = cloneDir;
      console.log(`Working directory set to: ${workingDir}`);

      // Configure git user for commits
      console.log('Configuring git user...');
      await sandbox.exec(`cd ${workingDir} && git config user.email "sandbox-executor@distributedelectrons.com"`);
      await sandbox.exec(`cd ${workingDir} && git config user.name "Sandbox Executor"`);
      console.log('Git user configured');

      // If branch specified, create/checkout branch
      if (body.branch) {
        console.log(`Switching to branch: ${body.branch}`);
        // Try to checkout existing branch, or create new one
        const checkoutResult = await sandbox.exec(
          `cd ${workingDir} && git checkout ${body.branch} 2>/dev/null || git checkout -b ${body.branch}`
        ) as CommandResult;
        console.log(`Branch checkout result: ${getOutput(checkoutResult)}`);
      }
    } else {
      // Create workspace directory
      console.log(`Creating workspace directory: ${workingDir}`);
      await sandbox.exec(`mkdir -p ${workingDir}`);
    }

    // Build system prompt
    const systemPrompt = body.options?.system_prompt || DEFAULT_SANDBOX_SYSTEM_PROMPT;

    // Build permission mode flag
    const permissionMode = body.options?.permission_mode || 'acceptEdits';

    // Escape task for shell
    const escapedTask = body.task.replace(/"/g, '\\"');

    // Build Claude Code command
    const cmd = `cd ${workingDir} && claude --append-system-prompt "${systemPrompt}" -p "${escapedTask}" --permission-mode ${permissionMode}`;

    console.log(`[EXEC ${requestId}] Executing Claude Code command...`);
    console.log(`[EXEC ${requestId}] Command: ${cmd.slice(0, 200)}...`);
    addDebugStep(debug, 'claude_cmd_prepared', { cmd_length: cmd.length, working_dir: workingDir });

    // First verify Claude is available
    const claudeCheckStartTime = Date.now();
    console.log(`[EXEC ${requestId}] Checking Claude CLI availability...`);
    const claudeCheck = await sandbox.exec('which claude && claude --version') as CommandResult;
    console.log(`[EXEC ${requestId}] Claude check: ${formatCommandResult('which claude', claudeCheck)}`);
    addDebugStep(debug, 'claude_check', {
      success: claudeCheck.success,
      exitCode: claudeCheck.exitCode,
      stdout: claudeCheck.stdout?.trim(),
      stderr: claudeCheck.stderr,
    }, undefined, claudeCheckStartTime);

    if (!claudeCheck.success || !claudeCheck.stdout?.includes('claude')) {
      errors.push(`Claude CLI not available: ${claudeCheck.stderr || 'not found'}`);
      console.error(`[EXEC ${requestId}] Claude CLI not available!`);
    }

    // Execute Claude Code with timeout tracking
    const claudeStartTime = Date.now();
    console.log(`[EXEC ${requestId}] Starting Claude execution at ${new Date().toISOString()}...`);
    const execResult = (await sandbox.exec(cmd)) as CommandResult;
    const claudeEndTime = Date.now();
    const claudeDuration = claudeEndTime - claudeStartTime;

    console.log(`[EXEC ${requestId}] Claude execution completed in ${claudeDuration}ms`);
    console.log(`[EXEC ${requestId}] Claude result: ${formatCommandResult('claude', execResult)}`);

    // Capture both stdout and stderr for debugging
    const logs = execResult.stdout || '';
    const stderrLogs = execResult.stderr || '';

    addDebugStep(debug, 'claude_executed', {
      success: execResult.success,
      exitCode: execResult.exitCode,
      stdout_length: logs.length,
      stderr_length: stderrLogs.length,
      duration_ms: claudeDuration,
      stdout_preview: logs.slice(0, 200),
      stderr_preview: stderrLogs.slice(0, 200),
    }, undefined, claudeStartTime);

    // If Claude failed, record the error
    if (!execResult.success) {
      const claudeError = stderrLogs || logs || `Exit code: ${execResult.exitCode}`;
      errors.push(`Claude execution failed: ${claudeError.slice(0, 500)}`);
      console.error(`[EXEC ${requestId}] Claude failed: ${claudeError}`);
    }

    // If logs are empty but command "succeeded", that's suspicious
    if (execResult.success && !logs.trim() && !stderrLogs.trim()) {
      errors.push('Claude execution returned empty output - possible silent failure');
      console.warn(`[EXEC ${requestId}] Warning: Claude returned empty output`);
    }

    // Get git diff if repo was provided and diff is requested
    let diff: string | undefined;
    if (body.repo && body.options?.include_diff !== false) {
      // Get diff including untracked files
      const diffResult = (await sandbox.exec(
        `cd ${workingDir} && git diff && git diff --cached`
      )) as CommandResult;
      diff = getOutput(diffResult);
    }

    // Git commit and push if repo was provided and GITHUB_PAT is available
    let commitResult: GitCommitResult | undefined;
    if (body.repo && env.GITHUB_PAT) {
      console.log('Starting git commit/push flow...');

      // Check if there are any changes to commit
      const statusResult = (await sandbox.exec(
        `cd ${workingDir} && git status --porcelain`
      )) as CommandResult;
      const statusOutput = getOutput(statusResult);
      console.log(`Git status: ${statusOutput}`);

      if (statusOutput.trim()) {
        // There are changes to commit
        console.log('Changes detected, committing...');

        // Stage all changes including new files
        const addResult = (await sandbox.exec(
          `cd ${workingDir} && git add -A`
        )) as CommandResult;
        console.log(`Git add result: success=${addResult.success}`);

        // Generate commit message
        const commitMessage = body.commit_message || `chore: sandbox-executor task - ${body.task.slice(0, 50)}`;
        const escapedMessage = commitMessage.replace(/"/g, '\\"');

        // Commit
        const commitCmd = `cd ${workingDir} && git commit -m "${escapedMessage}"`;
        const commitExecResult = (await sandbox.exec(commitCmd)) as CommandResult;
        const commitOutput = getOutput(commitExecResult);
        console.log(`Git commit result: ${commitOutput}`);

        if (commitExecResult.success) {
          // Get the commit SHA
          const shaResult = (await sandbox.exec(
            `cd ${workingDir} && git rev-parse HEAD`
          )) as CommandResult;
          const sha = getOutput(shaResult).trim();

          // Get current branch name
          const branchResult = (await sandbox.exec(
            `cd ${workingDir} && git rev-parse --abbrev-ref HEAD`
          )) as CommandResult;
          const currentBranch = getOutput(branchResult).trim();

          // Push to remote
          console.log(`Pushing to origin/${currentBranch}...`);
          const pushResult = (await sandbox.exec(
            `cd ${workingDir} && git push -u origin ${currentBranch}`
          )) as CommandResult;
          const pushOutput = getOutput(pushResult);
          console.log(`Git push result: success=${pushResult.success}, output=${pushOutput}`);

          if (pushResult.success) {
            commitResult = {
              success: true,
              sha,
              branch: currentBranch,
            };
            console.log(`Successfully pushed commit ${sha} to ${currentBranch}`);
          } else {
            commitResult = {
              success: false,
              sha,
              branch: currentBranch,
              error: `Push failed: ${pushOutput}`,
            };
            console.error(`Push failed: ${pushOutput}`);
          }
        } else {
          commitResult = {
            success: false,
            error: `Commit failed: ${commitOutput}`,
          };
          console.error(`Commit failed: ${commitOutput}`);
        }
      } else {
        console.log('No changes to commit');
        commitResult = {
          success: true,
          error: 'No changes to commit',
        };
      }
    }

    const executionTime = Date.now() - startTime;
    addDebugStep(debug, 'execution_complete', { total_time_ms: executionTime, errors_count: errors.length });

    // Parse repo for response metadata
    let repoOwner: string | undefined;
    let repoNameForUrl: string | undefined;
    if (body.repo) {
      const repoPath = body.repo.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
      [repoOwner, repoNameForUrl] = repoPath.split('/');
    }

    // Determine overall success - consider it failed if Claude didn't produce output
    const overallSuccess = execResult.success && (logs.trim().length > 0 || errors.length === 0);

    console.log(`[EXEC ${requestId}] Execution complete. Success: ${overallSuccess}, Errors: ${errors.length}`);

    // Build response with enhanced debugging info
    const response: ExecuteResponse & {
      stderr?: string;
      errors?: string[];
      debug?: DebugInfo;
    } = {
      success: overallSuccess,
      request_id: requestId,
      timestamp: new Date().toISOString(),
      logs: logs || stderrLogs || (errors.length > 0 ? errors.join('\n') : 'No output captured'),
      diff,
      metadata: {
        execution_time_ms: executionTime,
        sandbox_id: sandboxId,
        repo: body.repo,
        repo_created: repoCreated,
        branch: commitResult?.branch,
        commit_sha: commitResult?.sha,
        commit_url: commitResult?.sha && repoOwner && repoNameForUrl
          ? `https://github.com/${repoOwner}/${repoNameForUrl}/commit/${commitResult.sha}`
          : undefined,
        pushed: commitResult?.success,
        using_oauth: usingOAuth,
      },
    };

    // Include stderr separately if it has content
    if (stderrLogs.trim()) {
      response.stderr = stderrLogs;
    }

    // Include any errors we collected
    if (errors.length > 0) {
      response.errors = errors;
    }

    // Include debug info for troubleshooting
    response.debug = debug;

    return Response.json(response, {
      headers: {
        'X-Request-ID': requestId,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error(`[EXEC ${requestId}] Fatal error: ${errorMessage}`);
    console.error(`[EXEC ${requestId}] Stack: ${errorStack}`);

    addDebugStep(debug, 'fatal_error', null, errorMessage);

    // Handle specific error types
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        return Response.json({
          success: false,
          error: 'Task execution timed out',
          error_code: 'EXECUTION_TIMEOUT',
          request_id: requestId,
          errors,
          debug,
        }, {
          status: 504,
          headers: { 'X-Request-ID': requestId },
        });
      }
    }

    return Response.json({
      success: false,
      error: errorMessage,
      error_code: 'EXECUTION_ERROR',
      request_id: requestId,
      error_stack: errorStack,
      errors,
      debug,
    }, {
      status: 500,
      headers: { 'X-Request-ID': requestId },
    });
  }
}

/**
 * Add CORS headers to response
 */
function addCorsHeaders(response: Response): Response {
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('Access-Control-Allow-Origin', '*');
  newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  newResponse.headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, X-API-Key, Authorization'
  );
  return newResponse;
}

/**
 * Create error response
 */
function createErrorResponse(
  message: string,
  code: string,
  requestId: string,
  status: number,
  details?: Record<string, unknown>
): Response {
  const errorResponse: ErrorResponse = {
    error: message,
    error_code: code,
    request_id: requestId,
    details,
  };

  return Response.json(errorResponse, {
    status,
    headers: {
      'X-Request-ID': requestId,
    },
  });
}
