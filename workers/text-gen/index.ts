/**
 * Text Generation Worker
 * Main worker that orchestrates text generation workflow with proper auth
 */

import type {
  Env,
  GenerateRequest,
  GenerateResponse,
  ErrorResponse,
} from './types';

import { authenticateRequest, unauthorizedResponse } from './auth';
import { getInstanceConfig, getModelConfig, getProviderApiKey } from './config';
import { generateText, getDefaultModel, extractProvider } from './providers';

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
            'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization, X-Instance-ID',
            'Access-Control-Max-Age': '86400',
          },
        });
      }

      // Health check (no auth required)
      if (url.pathname === '/health' && request.method === 'GET') {
        return addCorsHeaders(Response.json({
          status: 'healthy',
          service: 'text-gen',
          timestamp: new Date().toISOString(),
        }));
      }

      // Models list (no auth required for discovery)
      if (url.pathname === '/models' && request.method === 'GET') {
        return addCorsHeaders(await handleListModels(env, requestId));
      }

      // Generate endpoint - requires authentication
      if (url.pathname === '/generate' && request.method === 'POST') {
        const response = await handleGenerate(request, env, requestId);
        return addCorsHeaders(response);
      }

      return addCorsHeaders(createErrorResponse(
        'Not Found',
        'ROUTE_NOT_FOUND',
        requestId,
        404
      ));
    } catch (error) {
      console.error('Unhandled error:', error);
      return addCorsHeaders(createErrorResponse(
        error instanceof Error ? error.message : 'Internal Server Error',
        'INTERNAL_ERROR',
        requestId,
        500
      ));
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
  newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization, X-Instance-ID');
  return newResponse;
}

/**
 * Handle text generation request
 */
async function handleGenerate(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  const startTime = Date.now();

  try {
    // Step 1: Authenticate the request
    const authResult = await authenticateRequest(request, env);

    if (!authResult.authorized) {
      return unauthorizedResponse(authResult.error || 'Unauthorized', requestId);
    }

    const instanceId = authResult.instance_id!;

    // Step 2: Parse request body
    const body: GenerateRequest = await request.json();

    // Validate request
    if (!body.prompt || body.prompt.trim() === '') {
      return createErrorResponse(
        'Prompt is required',
        'INVALID_REQUEST',
        requestId,
        400
      );
    }

    // Step 3: Get instance configuration
    const instanceConfig = await getInstanceConfig(instanceId, env);

    if (!instanceConfig) {
      return createErrorResponse(
        `Instance not found: ${instanceId}`,
        'INSTANCE_NOT_FOUND',
        requestId,
        404
      );
    }

    // Step 4: Determine provider and model
    const modelId = body.model || env.DEFAULT_MODEL_ID || 'gpt-4o-mini';
    const { provider, model } = extractProvider(modelId, env.DEFAULT_PROVIDER || 'openai');

    // Step 5: Get model configuration (optional, for prompt templates)
    const modelConfig = await getModelConfig(modelId, env);

    if (modelConfig) {
      console.log(`Using model config for ${modelId}`);
    } else {
      console.log(`No model config for ${modelId}, using defaults`);
    }

    // Step 6: Get provider API key
    const apiKey = await getProviderApiKey(instanceId, provider, env);

    if (!apiKey) {
      return createErrorResponse(
        `API key not configured for provider: ${provider}. Please add the API key in the admin panel.`,
        'MISSING_API_KEY',
        requestId,
        400
      );
    }

    // Step 7: Generate text
    const result = await generateText(
      provider,
      model,
      body.prompt,
      body.options || {},
      apiKey,
      modelConfig || undefined
    );

    // Step 8: Return success response
    const generationTime = Date.now() - startTime;

    const response: GenerateResponse = {
      success: true,
      text: result.text,
      metadata: {
        provider: result.provider,
        model: result.model,
        tokens_used: result.tokens_used,
        generation_time_ms: generationTime,
      },
      request_id: requestId,
      timestamp: new Date().toISOString(),
    };

    return Response.json(response, {
      headers: {
        'X-Request-ID': requestId,
      },
    });
  } catch (error) {
    console.error('Generation error:', error);

    // Handle specific error types
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        return createErrorResponse(
          'Text generation timed out',
          'GATEWAY_TIMEOUT',
          requestId,
          504
        );
      }

      if (error.message.includes('Rate limit') || error.message.includes('429')) {
        return createErrorResponse(
          'Provider rate limit exceeded',
          'PROVIDER_RATE_LIMIT',
          requestId,
          429
        );
      }

      if (error.message.includes('401') || error.message.includes('403')) {
        return createErrorResponse(
          'Invalid provider API key',
          'INVALID_PROVIDER_KEY',
          requestId,
          502
        );
      }
    }

    return createErrorResponse(
      error instanceof Error ? error.message : 'Generation failed',
      'GENERATION_ERROR',
      requestId,
      500
    );
  }
}

/**
 * Handle models list request
 */
async function handleListModels(env: Env, requestId: string): Promise<Response> {
  const configServiceUrl = env.CONFIG_SERVICE_URL || 'https://api.distributedelectrons.com';

  try {
    const response = await fetch(`${configServiceUrl}/model-config?status=active`, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return createErrorResponse(
        'Failed to fetch models',
        'CONFIG_SERVICE_ERROR',
        requestId,
        502
      );
    }

    const result = await response.json();

    return Response.json({
      success: true,
      data: result,
      request_id: requestId,
    }, {
      headers: {
        'X-Request-ID': requestId,
      },
    });
  } catch (error) {
    console.error('Error fetching models:', error);
    return createErrorResponse(
      'Failed to fetch models',
      'CONFIG_SERVICE_ERROR',
      requestId,
      502
    );
  }
}

/**
 * Create error response
 */
function createErrorResponse(
  message: string,
  code: string,
  requestId: string,
  status: number,
  details?: Record<string, any>
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
