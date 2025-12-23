/**
 * Sandbox Executor Worker
 * Delegates all CLI execution to on-prem Claude runner via Cloudflare Tunnel.
 * Also supports SDK mode via AI Gateway for lightweight queries.
 *
 * Endpoints:
 * - POST /execute - Delegate to on-prem Claude runner
 * - POST /execute/sdk - Execute using Anthropic SDK via AI Gateway
 * - GET /health - Health check endpoint
 *
 * @version 2.0.0 - Removed CF container/sandbox, runner-only mode
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  Env,
  ExecuteRequest,
  ErrorResponse,
  HealthResponse,
  SDKExecuteRequest,
  SDKExecuteResponse,
} from './types';

// Re-export Sandbox for Durable Object binding
export { Sandbox } from '@cloudflare/sandbox';

// Default runner URL (via Cloudflare Tunnel)
const DEFAULT_RUNNER_URL = 'https://claude-runner.shiftaltcreate.com';

/**
 * OAuth error patterns to detect when Claude auth fails
 */
const OAUTH_ERROR_PATTERNS = [
  'invalid_grant',
  'token expired',
  'token has expired',
  'unauthorized',
  'session expired',
  '401 unauthorized',
  'authentication failed',
  'invalid api key',
  'please log in',
  'not authenticated',
  'oauth credentials',
  'access token',
  'refresh token',
];

/**
 * Check if error output indicates OAuth failure
 */
function isOAuthError(output: string, exitCode?: number): boolean {
  const lowerOutput = output.toLowerCase();
  // Exit code 1 with auth-related error messages
  if (exitCode === 1 || exitCode === 401) {
    return OAUTH_ERROR_PATTERNS.some(pattern => lowerOutput.includes(pattern));
  }
  return false;
}

/**
 * Attempt to auto-refresh OAuth credentials
 * Returns true if refresh succeeded, false if human intervention is needed
 */
async function tryAutoRefreshOAuth(env: Env, requestId: string): Promise<boolean> {
  try {
    const configServiceUrl = env.CONFIG_SERVICE_URL || 'https://api.distributedelectrons.com';

    console.log(`[OAuth Refresh] Attempting automatic token refresh for request ${requestId}`);

    const response = await fetch(`${configServiceUrl}/oauth/claude/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': env.INTERNAL_API_KEY || '',
      },
    });

    if (response.ok) {
      console.log(`[OAuth Refresh] Successfully refreshed tokens for request ${requestId}`);
      return true;
    }

    const errorData = await response.json().catch(() => ({})) as { error?: string };
    console.warn(`[OAuth Refresh] Refresh failed: ${response.status} - ${errorData.error || 'Unknown error'}`);

    // 401 means refresh token is invalid - need human intervention
    return false;
  } catch (error) {
    console.error('[OAuth Refresh] Error during refresh attempt:', error);
    return false;
  }
}

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
 * Delegate task execution to on-prem Claude runner
 *
 * @param runnerUrl - URL of the on-prem Claude runner (via Cloudflare Tunnel)
 * @param task - Task description/prompt
 * @param repoUrl - Optional repository URL to clone
 * @param runnerSecret - Secret for authenticating with the runner
 * @param requestId - Request ID for tracking
 * @param options - Additional execution options
 */
async function delegateToRunner(
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
        prompt: task,
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

    // Return runner result formatted for our API
    return Response.json(
      {
        success: result.success,
        request_id: requestId,
        timestamp: new Date().toISOString(),
        logs: result.output || result.error || 'No output',
        metadata: {
          execution_time_ms: totalTime,
          runner_duration_ms: result.duration_ms,
          runner_url: runnerUrl,
          delegated_to_runner: true,
          exit_code: result.exit_code,
        },
      },
      {
        status: result.success ? 200 : 500,
        headers: { 'X-Request-ID': requestId },
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[RUNNER ${requestId}] Failed to reach runner: ${errorMessage}`);

    return Response.json(
      {
        success: false,
        error: `Runner unreachable: ${errorMessage}`,
        error_code: 'RUNNER_UNREACHABLE',
        request_id: requestId,
        metadata: {
          execution_time_ms: Date.now() - startTime,
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
 * Handle /execute requests - always delegates to on-prem runner
 */
async function handleExecute(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  // Get runner URL and secret
  const runnerUrl = env.CLAUDE_RUNNER_URL || DEFAULT_RUNNER_URL;
  const runnerSecret = env.RUNNER_SECRET;

  if (!runnerSecret) {
    return createErrorResponse(
      'RUNNER_SECRET not configured',
      'MISSING_RUNNER_SECRET',
      requestId,
      500
    );
  }

  // Parse request body
  const body: ExecuteRequest = await request.json();

  // Validate request
  if (!body.task || body.task.trim() === '') {
    return createErrorResponse('Task is required', 'INVALID_REQUEST', requestId, 400);
  }

  console.log(`[EXEC ${requestId}] Delegating to runner: ${runnerUrl}`);

  // Delegate to on-prem runner
  return delegateToRunner(runnerUrl, body.task, body.repo, runnerSecret, requestId, {
    timeout_ms: body.options?.timeout_ms,
  });
}

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
      return createErrorResponse('Prompt is required', 'INVALID_REQUEST', requestId, 400);
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

    console.log(`[SDK ${requestId}] Executing via AI Gateway (model: ${model})`);

    // Create Anthropic client with AI Gateway + BYOK
    const anthropic = new Anthropic({
      apiKey: 'placeholder',
      baseURL: AI_GATEWAY_URL,
      defaultHeaders: {
        'cf-aig-authorization': `Bearer ${env.CF_AIG_TOKEN}`,
        'anthropic-version': '2023-06-01',
      },
      fetch: async (url, init) => {
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

    const inputTokens = response.usage?.input_tokens || 0;
    const outputTokens = response.usage?.output_tokens || 0;

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
      headers: { 'X-Request-ID': requestId },
    });
  }
}

/**
 * Delegate task execution to on-prem Gemini runner
 * This is the preferred path when GEMINI_RUNNER_URL is configured and executor_type is 'gemini'
 *
 * @param runnerUrl - URL of the on-prem Gemini runner (via Cloudflare Tunnel)
 * @param task - Task description/prompt
 * @param repoUrl - Optional repository URL to clone
 * @param runnerSecret - Secret for authenticating with the runner
 * @param requestId - Request ID for tracking
 * @param options - Additional execution options
 */
async function delegateToGeminiRunner(
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

  try {
    const response = await fetch(`${runnerUrl}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Runner-Secret': runnerSecret,
        'X-Request-ID': requestId,
      },
      body: JSON.stringify({
        prompt: task,
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

    // Return runner result formatted for our API
    return Response.json({
      success: result.success,
      request_id: requestId,
      timestamp: new Date().toISOString(),
      logs: result.output || result.error || 'No output',
      metadata: {
        execution_time_ms: totalTime,
        runner_duration_ms: result.duration_ms,
        runner_url: runnerUrl,
        delegated_to_runner: true,
        executor_type: 'gemini',
        exit_code: result.exit_code,
      },
    }, {
      status: result.success ? 200 : 500,
      headers: { 'X-Request-ID': requestId },
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[GEMINI ${requestId}] Failed to reach runner: ${errorMessage}`);

    // Runner unreachable - return error
    return Response.json({
      success: false,
      error: `Gemini runner unreachable: ${errorMessage}`,
      error_code: 'GEMINI_RUNNER_UNREACHABLE',
      request_id: requestId,
      metadata: {
        execution_time_ms: Date.now() - startTime,
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
 * Emit OAuth expired event to config-service for webhook notifications
 * Only called when auto-refresh fails and human intervention is needed
 */
async function emitOAuthExpiredEvent(
  env: Env,
  requestId: string,
  details: Record<string, unknown>
): Promise<void> {
  try {
    // Use CONFIG_SERVICE_URL from env if available
    const configServiceUrl = env.CONFIG_SERVICE_URL || 'https://api.distributedelectrons.com';

    const response = await fetch(`${configServiceUrl}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: 'system', // System-level event
        action: 'oauth.expired',
        eventable_type: 'oauth_credentials',
        eventable_id: 'claude_max',
        particulars: {
          request_id: requestId,
          service: 'sandbox-executor',
          timestamp: new Date().toISOString(),
          auto_refresh_failed: true,
          ...details,
        },
      }),
    });

    if (!response.ok) {
      console.error(`[OAuth Event] Failed to emit event: ${response.status} ${await response.text()}`);
    } else {
      console.log(`[OAuth Event] Successfully emitted oauth.expired event for request ${requestId}`);
    }
  } catch (error) {
    console.error(`[SDK ${requestId}] Execution error:`, error);

    if (error instanceof Anthropic.APIError) {
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

    const errorMessage = error instanceof Error ? error.message : String(error);
    return createErrorResponse(errorMessage, 'SDK_EXECUTION_ERROR', requestId, 500);
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
      if (url.pathname === '/execute/sdk' && request.method === 'POST') {
        const response = await handleSDKExecute(request, env, requestId);
        return addCorsHeaders(response);
      }

      if (url.pathname === '/execute' && request.method === 'POST') {
        const body: ExecuteRequest = await request.clone().json();
        const executorType = body.executor_type || 'claude';

        // Route to Gemini runner if requested
        if (executorType === 'gemini') {
          if (env.GEMINI_RUNNER_URL && env.GEMINI_RUNNER_SECRET) {
            console.log(`[EXEC ${requestId}] Gemini executor requested, delegating to Gemini runner...`);

            const geminiResponse = await delegateToGeminiRunner(
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

        // Default: Claude executor
        // If on-prem runner is configured, delegate to it
        if (env.CLAUDE_RUNNER_URL && env.RUNNER_SECRET) {
          console.log(`[EXEC ${requestId}] On-prem Claude runner configured, delegating...`);

          const runnerResponse = await delegateToRunner(
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

          // If runner succeeded or returned an auth error, return that response
          // Only fall back to sandbox if runner is unreachable
          const runnerResult = await runnerResponse.clone().json() as { error_code?: string };
          if (runnerResult.error_code !== 'RUNNER_UNREACHABLE') {
            return addCorsHeaders(runnerResponse);
          }

          // Runner unreachable - fall back to sandbox execution
          console.log(`[EXEC ${requestId}] Runner unreachable, falling back to sandbox`);
        }

        // Fallback to handleExecute (for sandbox or if no runner configured)
        const response = await handleExecute(request, env, requestId);
        return addCorsHeaders(response);
      }

      if (url.pathname === '/health' && request.method === 'GET') {
        const runnerUrl = env.CLAUDE_RUNNER_URL || DEFAULT_RUNNER_URL;
        const healthResponse: HealthResponse = {
          status: 'healthy',
          service: 'sandbox-executor',
          timestamp: new Date().toISOString(),
          version: '2.0.0',
          runner_url: runnerUrl,
          runner_configured: !!env.RUNNER_SECRET,
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
