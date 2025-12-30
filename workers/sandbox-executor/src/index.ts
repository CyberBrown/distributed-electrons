/**
 * Sandbox Executor Worker
 * Delegates all CLI execution to on-prem runners (Claude or Gemini) via Cloudflare Tunnel.
 *
 * Endpoints:
 * - POST /execute - Delegate to on-prem runner (Claude primary, Gemini fallback)
 * - GET /health - Health check endpoint
 *
 * @version 2.2.0 - Added false-positive detection for tasks marked complete without execution
 */

import type {
  Env,
  ExecuteRequest,
  ErrorResponse,
  HealthResponse,
} from './types';

// Note: Sandbox DO was removed in migration v2 - no longer exported

// ============================================================================
// Failure Indicator Detection
// Catches cases where AI reports success but output shows it couldn't complete
// ============================================================================

/**
 * Failure indicators that suggest the AI reported success but didn't actually complete the task.
 * These phrases in the output indicate the AI couldn't find resources, files, or complete the work.
 *
 * IMPORTANT: Must be kept in sync with:
 * - nexus/src/lib/validation.ts FAILURE_INDICATORS
 * - de/workers/workflows/lib/nexus-callback.ts FAILURE_INDICATORS
 */
const FAILURE_INDICATORS = [
  // Resource not found patterns
  "couldn't find", "could not find", "can't find", "cannot find",
  "doesn't have", "does not have", "not found", "no such file",
  "doesn't exist", "does not exist", "file not found", "directory not found",
  "repo not found", "repository not found", "project not found",
  "reference not found", "idea not found",
  // Failure action patterns
  "failed to", "unable to", "i can't", "i cannot",
  "i'm unable", "i am unable", "cannot locate", "couldn't locate",
  "couldn't create", "could not create", "wasn't able", "was not able",
  // Empty/missing result patterns
  "no matching", "nothing found", "no results", "empty result", "no data",
  // Explicit error indicators
  "error:", "error occurred", "exception:",
  // Task incomplete patterns
  "task incomplete", "could not complete", "couldn't complete",
  "unable to complete", "did not complete", "didn't complete",
  // Missing reference patterns (for idea-based tasks)
  "reference doesn't have", "reference does not have",
  "doesn't have a corresponding", "does not have a corresponding",
  "no corresponding file", "no corresponding project",
  "missing reference", "invalid reference",
  // Additional patterns for edge cases
  "i can find", // catches "file I can find" negation patterns
  "no repo", "no repository", "no project",
  "couldn't access", "could not access", "can't access", "cannot access",
  "no idea file", "idea file not", "idea reference not",
  "there is no", "there are no", "there isn't", "there aren't",
  "without a", "missing a", "lack of", "lacking",
  "haven't been created", "hasn't been created", "has not been created",
  "wasn't created", "were not created", "weren't created",
  "no github", "no cloudflare", "no d1", "no worker",
  "the task cannot", "the task could not", "this task cannot",
  // Additional patterns for false completions
  "idea reference doesn't", "idea reference does not",
  "file i can find",
  "no repo was created", "no repository was created",
  "no worker deployed", "no database created",
  "completion result says",
  // Additional patterns added 2024-12-30 to catch more edge cases
  "haven't found", "have not found", "hasn't found", "has not found",
  "haven't set up", "have not set up", "hasn't set up", "has not set up",
  "setup yet", "not initialized", "not been initialized",
  "no setup", "no configuration", "not configured",
  "doesn't appear", "does not appear", "didn't find", "did not find",
  "looked for", "searched for",
  "need to create", "needs to be created", "must be created",
  "should be created", "would need to", "will need to",
  "before i can", "before we can", "in order to",
  "prerequisite", "prerequisites", "first need",
  "no code", "no files", "no implementation",
  "empty repo", "empty repository", "blank project",
  "scaffold", "scaffolding", "boilerplate",
  "set up the project", "set up the repo", "create the project",
  "initialize the project", "initialize the repo",
  "project structure", "folder structure", "directory structure",
  "does not have any", "doesn't have any", "don't have any",
  "nothing has been", "nothing was", "nothing is",
] as const;

/**
 * Normalize text for comparison by replacing curly quotes with straight quotes.
 * Handles typographic quotes that AI models often use.
 */
function normalizeQuotes(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")  // Single curly quotes → '
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"'); // Double curly quotes → "
}

/**
 * Check if output contains failure indicators suggesting the AI didn't complete the task.
 * Returns the matched indicator for logging, or null if no match.
 */
function findFailureIndicator(output: string | undefined): string | null {
  if (!output) return null;
  const normalized = normalizeQuotes(output.toLowerCase());
  for (const indicator of FAILURE_INDICATORS) {
    if (normalized.includes(indicator)) {
      return indicator;
    }
  }
  return null;
}

// Default runner URLs (via Cloudflare Tunnel)
const DEFAULT_RUNNER_URL = 'https://claude-runner.shiftaltcreate.com';
const DEFAULT_GEMINI_RUNNER_URL = 'https://gemini-runner.shiftaltcreate.com';

// ============================================================================
// On-Prem Runner Delegation (Claude & Gemini)
// ============================================================================

/**
 * Response from on-prem runners (Claude or Gemini)
 */
interface RunnerExecuteResponse {
  success: boolean;
  output?: string;
  error?: string;
  exit_code?: number;
  duration_ms: number;
}

/**
 * Default AI Gateway logging URL (base endpoint without /anthropic suffix)
 */
const DEFAULT_AI_GATEWAY_LOG_URL =
  'https://gateway.ai.cloudflare.com/v1/52b1c60ff2a24fb21c1ef9a429e63261/de-gateway';

/**
 * Metadata for AI Gateway execution logging
 */
interface GatewayLogMetadata {
  request_id: string;
  executor: 'claude-runner' | 'gemini-runner' | 'z-ai-runner';
  task_summary: string;
  repo_url?: string;
  start_time: number;
  end_time?: number;
  duration_ms?: number;
  success?: boolean;
  error?: string;
  event_type: 'execution_start' | 'execution_end';
}

/**
 * Log execution metadata to AI Gateway for unified visibility
 * This provides a logging layer without changing the execution path
 *
 * @param env - Environment bindings
 * @param metadata - Execution metadata to log
 */
async function logToGateway(env: Env, metadata: GatewayLogMetadata): Promise<void> {
  // Check if logging is enabled
  if (env.AI_GATEWAY_LOG_ENABLED !== 'true') {
    return;
  }

  const logUrl = env.AI_GATEWAY_LOG_URL || DEFAULT_AI_GATEWAY_LOG_URL;

  try {
    // POST metadata to AI Gateway logging endpoint
    // Using the /logs endpoint for custom event logging
    const response = await fetch(`${logUrl}/logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Include auth token if available for authenticated logging
        ...(env.CF_AIG_TOKEN && { 'cf-aig-authorization': `Bearer ${env.CF_AIG_TOKEN}` }),
      },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        event_type: metadata.event_type,
        request_id: metadata.request_id,
        executor: metadata.executor,
        task_summary: metadata.task_summary.substring(0, 500), // Truncate for logging
        repo_url: metadata.repo_url,
        start_time: metadata.start_time,
        end_time: metadata.end_time,
        duration_ms: metadata.duration_ms,
        success: metadata.success,
        error: metadata.error?.substring(0, 200), // Truncate error for logging
      }),
    });

    if (!response.ok) {
      // Log failure but don't throw - this is a visibility layer, not critical path
      console.warn(
        `[Gateway Log] Failed to log ${metadata.event_type} for ${metadata.request_id}: ${response.status}`
      );
    } else {
      console.log(
        `[Gateway Log] Logged ${metadata.event_type} for ${metadata.request_id} (executor: ${metadata.executor})`
      );
    }
  } catch (error) {
    // Non-blocking - log the error but don't fail the execution
    console.warn(
      `[Gateway Log] Error logging ${metadata.event_type} for ${metadata.request_id}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Generate a summary of the task for logging purposes
 * Extracts the first line or first N characters
 */
function generateTaskSummary(task: string, maxLength = 100): string {
  // Get first line or first maxLength chars, whichever is shorter
  const firstLine = task.split('\n')[0].trim();
  if (firstLine.length <= maxLength) {
    return firstLine;
  }
  return firstLine.substring(0, maxLength - 3) + '...';
}

/**
 * Deployment reminder to prepend to all tasks
 * Ensures code changes are deployed before marking tasks complete
 */
const DEPLOYMENT_REMINDER = `
IMPORTANT - DEPLOYMENT REQUIRED:
After committing changes, you MUST deploy before marking the task complete:
- For Workers projects: run \`wrangler deploy\`
- For Pages projects: run \`wrangler pages deploy dist/\` or \`bun run deploy\`
- Verify the deployment succeeded by checking the live URL
- If deployment fails, debug and retry

A task is NOT complete until the changes are live and verified.

---

`;

/**
 * Build the full prompt with deployment instructions
 * Prepends deployment reminder to ensure tasks include deployment steps
 */
function buildPromptWithDeploymentReminder(task: string): string {
  return DEPLOYMENT_REMINDER + task;
}

/**
 * Delegate task execution to on-prem Claude runner
 *
 * @param env - Environment bindings
 * @param runnerUrl - URL of the on-prem Claude runner (via Cloudflare Tunnel)
 * @param task - Task description/prompt
 * @param repoUrl - Optional repository URL to clone
 * @param runnerSecret - Secret for authenticating with the runner
 * @param requestId - Request ID for tracking
 * @param options - Additional execution options
 */
async function delegateToRunner(
  env: Env,
  runnerUrl: string,
  task: string,
  repoUrl: string | undefined,
  runnerSecret: string,
  requestId: string,
  options?: {
    timeout_ms?: number;
    allowed_tools?: string[];
    max_turns?: number;
  },
  accessCredentials?: {
    clientId?: string;
    clientSecret?: string;
  }
): Promise<Response> {
  const startTime = Date.now();

  console.log(`[RUNNER ${requestId}] Delegating to on-prem runner at ${runnerUrl}`);

  // Log execution start to AI Gateway (non-blocking)
  const taskSummary = generateTaskSummary(task);
  logToGateway(env, {
    request_id: requestId,
    executor: 'claude-runner',
    task_summary: taskSummary,
    repo_url: repoUrl,
    start_time: startTime,
    event_type: 'execution_start',
  });

  try {
    // Build headers - include CF-Access credentials if configured
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Runner-Secret': runnerSecret,
      'X-Request-ID': requestId,
    };

    // Add Cloudflare Access service token headers if configured
    if (accessCredentials?.clientId && accessCredentials?.clientSecret) {
      headers['CF-Access-Client-Id'] = accessCredentials.clientId;
      headers['CF-Access-Client-Secret'] = accessCredentials.clientSecret;
    }

    const response = await fetch(`${runnerUrl}/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: buildPromptWithDeploymentReminder(task),
        repo_url: repoUrl,
        timeout_ms: options?.timeout_ms || 300000, // 5 minutes default
        allowed_tools: options?.allowed_tools,
        max_turns: options?.max_turns,
      }),
    });

    const result = (await response.json()) as RunnerExecuteResponse;
    const totalTime = Date.now() - startTime;

    console.log(
      `[RUNNER ${requestId}] Runner response: success=${result.success}, duration=${result.duration_ms}ms`
    );

    // Check if runner reports OAuth issues
    if (!result.success && result.error?.includes('OAuth')) {
      console.error(`[RUNNER ${requestId}] Runner OAuth error: ${result.error}`);

      // Log execution end with error to AI Gateway
      logToGateway(env, {
        request_id: requestId,
        executor: 'claude-runner',
        task_summary: taskSummary,
        repo_url: repoUrl,
        start_time: startTime,
        end_time: Date.now(),
        duration_ms: totalTime,
        success: false,
        error: 'RUNNER_OAUTH_ERROR',
        event_type: 'execution_end',
      });

      return Response.json(
        {
          success: false,
          error: result.error,
          error_code: 'RUNNER_OAUTH_ERROR',
          request_id: requestId,
          metadata: {
            execution_time_ms: totalTime,
            runner_duration_ms: result.duration_ms,
            runner_url: runnerUrl,
            needs_reauth: true,
          },
        },
        {
          status: 401,
          headers: { 'X-Request-ID': requestId },
        }
      );
    }

    // Check for false positive success - runner says success but output indicates failure
    // This catches cases where the AI generates a response explaining why it couldn't complete
    let actualSuccess = result.success;
    let failureReason: string | undefined;

    if (result.success && result.output) {
      const matchedIndicator = findFailureIndicator(result.output);
      if (matchedIndicator) {
        actualSuccess = false;
        failureReason = `FALSE_POSITIVE: AI reported success but output contains failure indicator: "${matchedIndicator}"`;
        console.warn(`[RUNNER ${requestId}] ${failureReason}`);
        console.warn(`[RUNNER ${requestId}] Output preview (first 300 chars): ${result.output.substring(0, 300)}`);
      }
    }

    // Log execution end to AI Gateway
    logToGateway(env, {
      request_id: requestId,
      executor: 'claude-runner',
      task_summary: taskSummary,
      repo_url: repoUrl,
      start_time: startTime,
      end_time: Date.now(),
      duration_ms: totalTime,
      success: actualSuccess,
      error: actualSuccess ? undefined : (failureReason || result.error),
      event_type: 'execution_end',
    });

    // Return runner result formatted for our API
    return Response.json(
      {
        success: actualSuccess,
        request_id: requestId,
        timestamp: new Date().toISOString(),
        logs: result.output || result.error || 'No output',
        error: failureReason, // Include failure reason if false positive detected
        error_code: failureReason ? 'FALSE_POSITIVE_SUCCESS' : undefined,
        metadata: {
          execution_time_ms: totalTime,
          runner_duration_ms: result.duration_ms,
          runner_url: runnerUrl,
          delegated_to_runner: true,
          exit_code: result.exit_code,
          false_positive_detected: !!failureReason,
        },
      },
      {
        status: actualSuccess ? 200 : 500,
        headers: { 'X-Request-ID': requestId },
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorTime = Date.now();
    console.error(`[RUNNER ${requestId}] Failed to reach runner: ${errorMessage}`);

    // Log execution end with error to AI Gateway
    logToGateway(env, {
      request_id: requestId,
      executor: 'claude-runner',
      task_summary: taskSummary,
      repo_url: repoUrl,
      start_time: startTime,
      end_time: errorTime,
      duration_ms: errorTime - startTime,
      success: false,
      error: 'RUNNER_UNREACHABLE',
      event_type: 'execution_end',
    });

    return Response.json(
      {
        success: false,
        error: `Runner unreachable: ${errorMessage}`,
        error_code: 'RUNNER_UNREACHABLE',
        request_id: requestId,
        metadata: {
          execution_time_ms: errorTime - startTime,
          runner_url: runnerUrl,
        },
      },
      {
        status: 503,
        headers: { 'X-Request-ID': requestId },
      }
    );
  }
}

/**
 * Delegate task execution to on-prem Gemini runner
 * This is the preferred path when GEMINI_RUNNER_URL is configured and executor_type is 'gemini'
 *
 * @param env - Environment bindings
 * @param runnerUrl - URL of the on-prem Gemini runner (via Cloudflare Tunnel)
 * @param task - Task description/prompt
 * @param repoUrl - Optional repository URL to clone
 * @param runnerSecret - Secret for authenticating with the runner
 * @param requestId - Request ID for tracking
 * @param options - Additional execution options
 */
async function delegateToGeminiRunner(
  env: Env,
  runnerUrl: string,
  task: string,
  repoUrl: string | undefined,
  runnerSecret: string,
  requestId: string,
  options?: {
    timeout_ms?: number;
    model?: string;
    sandbox?: boolean;
  }
): Promise<Response> {
  const startTime = Date.now();

  console.log(`[GEMINI ${requestId}] Delegating to on-prem Gemini runner at ${runnerUrl}`);

  // Log execution start to AI Gateway (non-blocking)
  const taskSummary = generateTaskSummary(task);
  logToGateway(env, {
    request_id: requestId,
    executor: 'gemini-runner',
    task_summary: taskSummary,
    repo_url: repoUrl,
    start_time: startTime,
    event_type: 'execution_start',
  });

  try {
    const response = await fetch(`${runnerUrl}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Runner-Secret': runnerSecret,
        'X-Request-ID': requestId,
      },
      body: JSON.stringify({
        prompt: buildPromptWithDeploymentReminder(task),
        repo_url: repoUrl,
        timeout_ms: options?.timeout_ms || 300000, // 5 minutes default
        model: options?.model,
        sandbox: options?.sandbox,
      }),
    });

    const result = await response.json() as RunnerExecuteResponse;
    const totalTime = Date.now() - startTime;

    console.log(`[GEMINI ${requestId}] Runner response: success=${result.success}, duration=${result.duration_ms}ms`);

    // Check if runner reports auth issues
    if (!result.success && result.error?.includes('authentication')) {
      console.error(`[GEMINI ${requestId}] Runner auth error: ${result.error}`);

      // Log execution end with error to AI Gateway
      logToGateway(env, {
        request_id: requestId,
        executor: 'gemini-runner',
        task_summary: taskSummary,
        repo_url: repoUrl,
        start_time: startTime,
        end_time: Date.now(),
        duration_ms: totalTime,
        success: false,
        error: 'GEMINI_AUTH_ERROR',
        event_type: 'execution_end',
      });

      return Response.json({
        success: false,
        error: result.error,
        error_code: 'GEMINI_AUTH_ERROR',
        request_id: requestId,
        metadata: {
          execution_time_ms: totalTime,
          runner_duration_ms: result.duration_ms,
          runner_url: runnerUrl,
          needs_reauth: true,
        },
      }, {
        status: 401,
        headers: { 'X-Request-ID': requestId },
      });
    }

    // Check for false positive success - runner says success but output indicates failure
    // This catches cases where the AI generates a response explaining why it couldn't complete
    let actualSuccess = result.success;
    let failureReason: string | undefined;

    if (result.success && result.output) {
      const matchedIndicator = findFailureIndicator(result.output);
      if (matchedIndicator) {
        actualSuccess = false;
        failureReason = `FALSE_POSITIVE: AI reported success but output contains failure indicator: "${matchedIndicator}"`;
        console.warn(`[GEMINI ${requestId}] ${failureReason}`);
        console.warn(`[GEMINI ${requestId}] Output preview (first 300 chars): ${result.output.substring(0, 300)}`);
      }
    }

    // Log execution end to AI Gateway
    logToGateway(env, {
      request_id: requestId,
      executor: 'gemini-runner',
      task_summary: taskSummary,
      repo_url: repoUrl,
      start_time: startTime,
      end_time: Date.now(),
      duration_ms: totalTime,
      success: actualSuccess,
      error: actualSuccess ? undefined : (failureReason || result.error),
      event_type: 'execution_end',
    });

    // Return runner result formatted for our API
    return Response.json({
      success: actualSuccess,
      request_id: requestId,
      timestamp: new Date().toISOString(),
      logs: result.output || result.error || 'No output',
      error: failureReason, // Include failure reason if false positive detected
      error_code: failureReason ? 'FALSE_POSITIVE_SUCCESS' : undefined,
      metadata: {
        execution_time_ms: totalTime,
        runner_duration_ms: result.duration_ms,
        runner_url: runnerUrl,
        delegated_to_runner: true,
        executor_type: 'gemini',
        exit_code: result.exit_code,
        false_positive_detected: !!failureReason,
      },
    }, {
      status: actualSuccess ? 200 : 500,
      headers: { 'X-Request-ID': requestId },
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorTime = Date.now();
    console.error(`[GEMINI ${requestId}] Failed to reach runner: ${errorMessage}`);

    // Log execution end with error to AI Gateway
    logToGateway(env, {
      request_id: requestId,
      executor: 'gemini-runner',
      task_summary: taskSummary,
      repo_url: repoUrl,
      start_time: startTime,
      end_time: errorTime,
      duration_ms: errorTime - startTime,
      success: false,
      error: 'GEMINI_RUNNER_UNREACHABLE',
      event_type: 'execution_end',
    });

    // Runner unreachable - return error
    return Response.json({
      success: false,
      error: `Gemini runner unreachable: ${errorMessage}`,
      error_code: 'GEMINI_RUNNER_UNREACHABLE',
      request_id: requestId,
      metadata: {
        execution_time_ms: errorTime - startTime,
        runner_url: runnerUrl,
        delegated_to_runner: true,
        executor_type: 'gemini',
        runner_failed: true,
      },
    }, {
      status: 503, // Service Unavailable
      headers: { 'X-Request-ID': requestId },
    });
  }
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
      if (url.pathname === '/execute' && request.method === 'POST') {
        const body: ExecuteRequest = await request.clone().json();
        const executorType = body.executor_type || 'claude';

        // Route to Gemini runner if requested
        if (executorType === 'gemini') {
          if (env.GEMINI_RUNNER_URL && env.GEMINI_RUNNER_SECRET) {
            console.log(`[EXEC ${requestId}] Gemini executor requested, delegating to Gemini runner...`);

            const geminiResponse = await delegateToGeminiRunner(
              env,
              env.GEMINI_RUNNER_URL,
              body.task,
              body.repo,
              env.GEMINI_RUNNER_SECRET,
              requestId,
              {
                timeout_ms: body.options?.timeout_ms,
              }
            );

            return addCorsHeaders(geminiResponse);
          } else {
            // Gemini runner not configured
            return addCorsHeaders(
              createErrorResponse(
                'Gemini executor requested but GEMINI_RUNNER_URL not configured',
                'GEMINI_NOT_CONFIGURED',
                requestId,
                503
              )
            );
          }
        }

        // Default: Claude executor with Gemini fallback
        // Try claude-runner first, then gemini-runner if claude fails
        let claudeError: string | null = null;

        if (env.CLAUDE_RUNNER_URL && env.RUNNER_SECRET) {
          console.log(`[EXEC ${requestId}] Attempting claude-runner...`);

          const claudeResponse = await delegateToRunner(
            env,
            env.CLAUDE_RUNNER_URL,
            body.task,
            body.repo,
            env.RUNNER_SECRET,
            requestId,
            {
              timeout_ms: body.options?.timeout_ms,
            },
            {
              clientId: env.CF_ACCESS_CLIENT_ID,
              clientSecret: env.CF_ACCESS_CLIENT_SECRET,
            }
          );

          const claudeResult = await claudeResponse.clone().json() as { success?: boolean; error_code?: string; error?: string };

          // If claude succeeded, return it
          if (claudeResult.success) {
            return addCorsHeaders(claudeResponse);
          }

          // Claude failed - log and try gemini fallback
          claudeError = claudeResult.error_code || claudeResult.error || 'Unknown error';
          console.log(`[EXEC ${requestId}] claude-runner failed (${claudeError}), trying gemini fallback...`);
        } else {
          claudeError = 'claude-runner not configured';
          console.log(`[EXEC ${requestId}] claude-runner not configured, trying gemini...`);
        }

        // Gemini fallback
        if (env.GEMINI_RUNNER_URL && env.GEMINI_RUNNER_SECRET) {
          console.log(`[EXEC ${requestId}] Attempting gemini-runner fallback...`);

          const geminiResponse = await delegateToGeminiRunner(
            env,
            env.GEMINI_RUNNER_URL,
            body.task,
            body.repo,
            env.GEMINI_RUNNER_SECRET,
            requestId,
            {
              timeout_ms: body.options?.timeout_ms,
            }
          );

          const geminiResult = await geminiResponse.clone().json() as { success?: boolean; error_code?: string; error?: string };

          // If gemini succeeded, return it
          if (geminiResult.success) {
            console.log(`[EXEC ${requestId}] gemini-runner fallback succeeded`);
            return addCorsHeaders(geminiResponse);
          }

          // Both runners failed
          const geminiError = geminiResult.error_code || geminiResult.error || 'Unknown error';
          console.error(`[EXEC ${requestId}] Both runners failed. Claude: ${claudeError}, Gemini: ${geminiError}`);

          return addCorsHeaders(
            createErrorResponse(
              `Both runners failed. Claude: ${claudeError}. Gemini: ${geminiError}`,
              'ALL_RUNNERS_FAILED',
              requestId,
              503
            )
          );
        }

        // No gemini configured - return claude error
        console.error(`[EXEC ${requestId}] claude-runner failed and gemini-runner not configured`);
        return addCorsHeaders(
          createErrorResponse(
            `Claude runner failed (${claudeError}) and gemini fallback not configured`,
            'RUNNER_FAILED_NO_FALLBACK',
            requestId,
            503
          )
        );
      }

      if (url.pathname === '/health' && request.method === 'GET') {
        const claudeRunnerUrl = env.CLAUDE_RUNNER_URL || DEFAULT_RUNNER_URL;
        const geminiRunnerUrl = env.GEMINI_RUNNER_URL || DEFAULT_GEMINI_RUNNER_URL;
        const healthResponse: HealthResponse = {
          status: 'healthy',
          service: 'sandbox-executor',
          timestamp: new Date().toISOString(),
          version: '2.2.0', // Added false-positive detection
          runner_url: claudeRunnerUrl,
          runner_configured: !!env.RUNNER_SECRET,
        };

        // Add fallback info to health response
        const extendedHealth = {
          ...healthResponse,
          fallback: {
            gemini_runner_url: geminiRunnerUrl,
            gemini_configured: !!(env.GEMINI_RUNNER_URL && env.GEMINI_RUNNER_SECRET),
          },
        };

        return addCorsHeaders(Response.json(extendedHealth));
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
    headers: { 'X-Request-ID': requestId },
  });
}
