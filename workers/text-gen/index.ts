/**
 * Text Generation Worker
 * Main worker that orchestrates text generation workflow
 */

import type {
  Env,
  GenerateRequest,
  GenerateResponse,
  ErrorResponse,
  InstanceConfig,
  TextResult,
} from './types';
import type { ModelConfig } from './model-config-types';
import {
  applyPayloadMapping,
  applyResponseMapping,
  validatePayloadMapping,
} from '../shared/utils/payload-mapper';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Generate request ID for tracking
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
      if (url.pathname === '/generate' && request.method === 'POST') {
        const response = await handleGenerate(request, env, requestId);
        return addCorsHeaders(response);
      }

      if (url.pathname === '/health' && request.method === 'GET') {
        return addCorsHeaders(Response.json({
          status: 'healthy',
          service: 'text-gen',
          timestamp: new Date().toISOString(),
        }));
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
  newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');
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
    // Parse request body
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

    // Extract instance ID (from body, header, or default)
    const instanceId =
      body.instance_id ||
      request.headers.get('X-Instance-ID') ||
      env.DEFAULT_INSTANCE_ID ||
      'default';

    // Get instance configuration
    const instanceConfig = await getInstanceConfig(instanceId, env);

    if (!instanceConfig) {
      return createErrorResponse(
        `Instance not found: ${instanceId}`,
        'INSTANCE_NOT_FOUND',
        requestId,
        404
      );
    }

    // NEW: Try dynamic model config if model_id is provided
    if (body.model_id) {
      try {
        const modelConfig = await fetchModelConfig(body.model_id);

        if (modelConfig && validatePayloadMapping(modelConfig.payload_mapping)) {
          // Get API key based on provider
          const provider = modelConfig.provider_id;
          const apiKey = instanceConfig.api_keys[provider] || getEnvApiKey(provider, env);

          if (!apiKey) {
            return createErrorResponse(
              `API key not configured for provider: ${provider}`,
              'MISSING_API_KEY',
              requestId,
              500
            );
          }

          // Generate text using dynamic config
          const result = await generateTextWithConfig(
            modelConfig,
            body.prompt,
            body.options || {},
            apiKey
          );

          // Calculate generation time
          const generationTime = Date.now() - startTime;

          // Return success response
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
        }
      } catch (configError) {
        // Log error but continue to fallback logic
        console.warn(`Failed to fetch model config for ${body.model_id}, falling back to legacy logic:`, configError);
      }
    }

    // LEGACY: Use existing hardcoded logic
    // Determine provider and model
    const modelParts = body.model?.split(':') || [];
    const provider = modelParts.length > 1 ? modelParts[0] : (env.DEFAULT_PROVIDER || 'openai');
    const model = modelParts.length > 1 ? modelParts[1] : (body.model || getDefaultModel(provider));

    // Get API key
    const apiKey = instanceConfig.api_keys[provider] || getEnvApiKey(provider, env);
    if (!apiKey) {
      return createErrorResponse(
        `API key not configured for provider: ${provider}`,
        'MISSING_API_KEY',
        requestId,
        500
      );
    }

    // Generate text using provider
    const result = await generateText(
      provider,
      model,
      body.prompt,
      body.options || {},
      apiKey
    );

    // Calculate generation time
    const generationTime = Date.now() - startTime;

    // Return success response
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
          'Invalid API key',
          'INVALID_API_KEY',
          requestId,
          401
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
 * Fetch model configuration from Config Service
 */
async function fetchModelConfig(modelId: string): Promise<ModelConfig | null> {
  try {
    const response = await fetch(
      `https://api.distributedelectrons.com/model-config/${encodeURIComponent(modelId)}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      console.error(`Failed to fetch model config for ${modelId}: ${response.status}`);
      return null;
    }

    const data = await response.json() as any;
    return data.data || null;
  } catch (error) {
    console.error(`Error fetching model config for ${modelId}:`, error);
    return null;
  }
}

/**
 * Generate text using dynamic model configuration
 */
async function generateTextWithConfig(
  modelConfig: ModelConfig,
  prompt: string,
  options: any,
  apiKey: string
): Promise<TextResult> {
  const { payload_mapping } = modelConfig;

  // Prepare user inputs for payload mapping
  const userInputs = {
    user_prompt: prompt,
    prompt: prompt,
    max_tokens: options.max_tokens,
    temperature: options.temperature,
    top_p: options.top_p,
    model: modelConfig.model_id,
    ...options, // Include any other options
  };

  // Apply payload mapping to create provider-specific request
  const providerRequest = applyPayloadMapping(
    payload_mapping,
    userInputs,
    apiKey
  );

  // Make the request to the provider
  const response = await fetch(providerRequest.endpoint, {
    method: providerRequest.method,
    headers: providerRequest.headers,
    body: JSON.stringify(providerRequest.body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Provider API error (${response.status}): ${error}`);
  }

  const providerResponse = await response.json();

  // Apply response mapping to extract standardized fields
  const mappedResponse = applyResponseMapping(
    providerResponse,
    payload_mapping.response_mapping
  );

  // Return standardized result
  return {
    text: mappedResponse.text || '',
    provider: modelConfig.provider_id,
    model: mappedResponse.model || modelConfig.model_id,
    tokens_used: mappedResponse.tokens_used || 0,
    metadata: {
      config_id: modelConfig.config_id,
      display_name: modelConfig.display_name,
    },
  };
}

/**
 * Generate text using specified provider
 */
async function generateText(
  provider: string,
  model: string,
  prompt: string,
  options: any,
  apiKey: string
): Promise<TextResult> {
  switch (provider.toLowerCase()) {
    case 'openai':
      return await generateWithOpenAI(model, prompt, options, apiKey);
    case 'anthropic':
      return await generateWithAnthropic(model, prompt, options, apiKey);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

/**
 * Generate text using OpenAI API
 */
async function generateWithOpenAI(
  model: string,
  prompt: string,
  options: any,
  apiKey: string
): Promise<TextResult> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: options.max_tokens || 1000,
      temperature: options.temperature || 0.7,
      top_p: options.top_p || 1.0,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${error}`);
  }

  const data = await response.json() as any;

  return {
    text: data.choices[0].message.content,
    provider: 'openai',
    model: data.model,
    tokens_used: data.usage?.total_tokens || 0,
  };
}

/**
 * Generate text using Anthropic API
 */
async function generateWithAnthropic(
  model: string,
  prompt: string,
  options: any,
  apiKey: string
): Promise<TextResult> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: options.max_tokens || 1000,
      temperature: options.temperature || 0.7,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${error}`);
  }

  const data = await response.json() as any;

  return {
    text: data.content[0].text,
    provider: 'anthropic',
    model: data.model,
    tokens_used: data.usage?.input_tokens + data.usage?.output_tokens || 0,
  };
}

/**
 * Get default model for provider
 */
function getDefaultModel(provider: string): string {
  const defaults: Record<string, string> = {
    openai: 'gpt-4o-mini',
    anthropic: 'claude-sonnet-4-20250514',
  };
  return defaults[provider.toLowerCase()] || 'gpt-4o-mini';
}

/**
 * Get API key from environment
 */
function getEnvApiKey(provider: string, env: Env): string | undefined {
  const keyMap: Record<string, keyof Env> = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
  };
  const key = keyMap[provider.toLowerCase()];
  return key ? env[key] : undefined;
}

/**
 * Get instance configuration
 * Mock implementation for MVP
 */
async function getInstanceConfig(
  instanceId: string,
  env: Env
): Promise<InstanceConfig | null> {
  // Mock configuration for MVP
  // In production, this would query the Config Service
  return {
    instance_id: instanceId,
    org_id: 'solamp',
    api_keys: {
      openai: env.OPENAI_API_KEY || '',
      anthropic: env.ANTHROPIC_API_KEY || '',
    },
    rate_limits: {
      openai: {
        rpm: 100,
        tpm: 50000,
      },
      anthropic: {
        rpm: 50,
        tpm: 50000,
      },
    },
  };
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
