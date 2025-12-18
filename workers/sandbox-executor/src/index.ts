/**
 * Sandbox Executor Worker
 * Executes Claude tasks via two approaches:
 * 1. SDK approach (POST /execute/sdk) - Base Anthropic SDK via AI Gateway, lightweight
 * 2. Sandbox approach (POST /execute) - Full container isolation with CLI
 *
 * Endpoints:
 * - POST /execute/sdk - Execute using Anthropic SDK via AI Gateway (recommended)
 * - POST /execute - Execute using Claude Code CLI in sandbox container
 * - GET /health - Health check endpoint
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

      if (url.pathname === '/health' && request.method === 'GET') {
        const healthResponse: HealthResponse = {
          status: 'healthy',
          service: 'sandbox-executor',
          timestamp: new Date().toISOString(),
          version: '1.1.0',
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
 * Handle sandbox/CLI-based task execution request
 */
async function handleExecute(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  const startTime = Date.now();

  try {
    // Parse request body
    const body: ExecuteRequest = await request.json();

    // Validate request
    if (!body.task || body.task.trim() === '') {
      return createErrorResponse(
        'Task is required',
        'INVALID_REQUEST',
        requestId,
        400
      );
    }

    // Validate API key is configured (sandbox mode still needs direct API key)
    if (!env.ANTHROPIC_API_KEY) {
      return createErrorResponse(
        'ANTHROPIC_API_KEY not configured',
        'MISSING_API_KEY',
        requestId,
        500
      );
    }

    // Create sandbox with unique ID
    const sandboxId = crypto.randomUUID().slice(0, 8);
    const sandbox = getSandbox(env.Sandbox, sandboxId);

    // Set environment variables in sandbox
    await sandbox.setEnvVars({
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    });

    // Determine working directory and setup
    let workingDir = body.options?.working_dir || '/tmp/workspace';

    // If repo is provided, clone it
    if (body.repo) {
      const repoName = body.repo.split('/').pop() || 'repo';
      await sandbox.gitCheckout(body.repo, { targetDir: repoName });
      workingDir = repoName;
    } else {
      // Create workspace directory
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

    console.log(`Executing Claude Code in sandbox ${sandboxId}: ${cmd}`);

    // Execute Claude Code
    const execResult = (await sandbox.exec(cmd)) as CommandResult;
    const logs = getOutput(execResult);

    // Get git diff if repo was provided and diff is requested
    let diff: string | undefined;
    if (body.repo && body.options?.include_diff !== false) {
      const diffResult = (await sandbox.exec(
        `cd ${workingDir} && git diff`
      )) as CommandResult;
      diff = getOutput(diffResult);
    }

    const executionTime = Date.now() - startTime;

    // Build response
    const response: ExecuteResponse = {
      success: execResult.success,
      request_id: requestId,
      timestamp: new Date().toISOString(),
      logs,
      diff,
      metadata: {
        execution_time_ms: executionTime,
        sandbox_id: sandboxId,
        repo: body.repo,
      },
    };

    return Response.json(response, {
      headers: {
        'X-Request-ID': requestId,
      },
    });
  } catch (error) {
    console.error('Execution error:', error);

    // Handle specific error types
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        return createErrorResponse(
          'Task execution timed out',
          'EXECUTION_TIMEOUT',
          requestId,
          504
        );
      }
    }

    return createErrorResponse(
      error instanceof Error ? error.message : 'Execution failed',
      'EXECUTION_ERROR',
      requestId,
      500
    );
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
