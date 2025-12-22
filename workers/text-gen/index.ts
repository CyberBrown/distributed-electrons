/**
 * Text Generation Worker
 * Main worker that orchestrates text generation workflow
 * Now with Universal LLM Router for automatic fallback
 */

import type {
  Env,
  GenerateRequest,
  GenerateResponse,
  ErrorResponse,
  InstanceConfig,
  TextResult,
  ModelConfig,
} from './types';
import {
  applyPayloadMapping,
  applyResponseMapping,
  validatePayloadMapping,
} from '../shared/utils/payload-mapper';
import { createRouter, LLMRouter } from './llm-router';
import { generateWithSparkLocal } from './spark-provider';
// Phase 2 Router
import { createRouter as createRouterV2, type RouterRequest, type RouterEnv } from './src/lib/router';

/**
 * Infer the provider from model name when no explicit prefix is given
 */
function inferProvider(model: string, defaultProvider: string = 'openai'): string {
  // Explicit provider prefix takes precedence
  if (model.includes(':')) {
    return model.split(':')[0];
  }

  // Infer from model name
  const modelLower = model.toLowerCase();
  if (modelLower.startsWith('claude')) return 'anthropic';
  if (modelLower.startsWith('gpt') || modelLower.startsWith('o1') || modelLower.startsWith('chatgpt')) return 'openai';
  if (modelLower.startsWith('gemini')) return 'google';
  if (modelLower.startsWith('llama') || modelLower.startsWith('mixtral') || modelLower.startsWith('mistral')) return 'together';

  return defaultProvider;
}

/**
 * Strip provider prefix from model name if present
 */
function stripProviderPrefix(model: string): string {
  return model.includes(':') ? model.split(':').slice(1).join(':') : model;
}

/**
 * Create a router with all configured generators
 */
function createRouterWithGenerators(env: Env): LLMRouter {
  // Generator functions that match the expected signature
  const openaiGenerator = async (
    model: string,
    prompt: string,
    options: any,
    apiKey: string
  ): Promise<TextResult> => {
    return await generateWithOpenAI(model, prompt, options, apiKey);
  };

  const anthropicGenerator = async (
    model: string,
    prompt: string,
    options: any,
    apiKey: string
  ): Promise<TextResult> => {
    return await generateWithAnthropic(model, prompt, options, apiKey);
  };

  const sparkLocalGenerator = async (
    model: string,
    prompt: string,
    options: any,
    _apiKey: string
  ): Promise<TextResult> => {
    const sparkUrl = (env as any).SPARK_LOCAL_URL;
    const sparkApiKey = (env as any).SPARK_API_KEY;
    return await generateWithSparkLocal(model, prompt, options, sparkUrl, sparkApiKey);
  };

  return createRouter(env, {
    openai: openaiGenerator,
    anthropic: anthropicGenerator,
    sparkLocal: sparkLocalGenerator,
  });
}

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

      if (url.pathname === '/generate/stream' && request.method === 'POST') {
        const response = await handleGenerateStream(request, env, requestId);
        return addCorsHeaders(response);
      }

      if (url.pathname === '/health' && request.method === 'GET') {
        // Create router to get provider health
        const router = createRouterWithGenerators(env);
        return addCorsHeaders(Response.json({
          status: 'healthy',
          service: 'text-gen',
          timestamp: new Date().toISOString(),
          providers: router.getHealthSummary(),
        }));
      }

      // ===========================================
      // Phase 2 Router Endpoints (multi-media, workflows)
      // ===========================================

      // Route a request through the v2 router
      if (url.pathname === '/v2/route' && request.method === 'POST') {
        const response = await handleRouterV2Request(request, env, requestId);
        return addCorsHeaders(response);
      }

      // Get v2 router health status
      if (url.pathname === '/v2/health' && request.method === 'GET') {
        const response = await handleRouterV2Health(env, requestId);
        return addCorsHeaders(response);
      }

      // List available workflows
      if (url.pathname === '/v2/workflows' && request.method === 'GET') {
        const response = await handleListWorkflows(env, requestId);
        return addCorsHeaders(response);
      }

      // Get router stats
      if (url.pathname === '/v2/stats' && request.method === 'GET') {
        const response = await handleRouterStats(env, requestId);
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

    let result: TextResult;

    // Check if model_id is provided - use dynamic model config if available
    if (body.model_id) {
      console.log(`Fetching model config for: ${body.model_id}`);

      const modelConfig = await fetchModelConfig(body.model_id, env);

      if (modelConfig) {
        // Verify this is a text generation model
        if (!modelConfig.capabilities.text) {
          return createErrorResponse(
            `Model ${body.model_id} does not support text generation`,
            'INVALID_MODEL_CAPABILITY',
            requestId,
            400
          );
        }

        // Get API key for this provider
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

        // Generate using dynamic model config
        console.log(`Using dynamic model config for ${modelConfig.display_name}`);
        result = await generateWithModelConfig(
          modelConfig,
          body.prompt,
          body.options || {},
          apiKey
        );
      } else {
        // Model config not found, fall back to default behavior
        console.warn(`Model config not found for ${body.model_id}, falling back to hardcoded providers`);

        const provider = inferProvider(body.model || '', env.DEFAULT_PROVIDER || 'openai');
        const model = stripProviderPrefix(body.model || '') || getDefaultModel(provider);
        const apiKey = instanceConfig.api_keys[provider] || getEnvApiKey(provider, env);

        if (!apiKey) {
          return createErrorResponse(
            `API key not configured for provider: ${provider}`,
            'MISSING_API_KEY',
            requestId,
            500
          );
        }

        result = await generateText(provider, model, body.prompt, body.options || {}, apiKey);
      }
    } else {
      // No model_id provided - use smart router with automatic fallback
      const model = stripProviderPrefix(body.model || '') || getDefaultModel(env.DEFAULT_PROVIDER || 'openai');

      // Create router and route request with automatic fallback
      const router = createRouterWithGenerators(env);

      try {
        const routerResult = await router.route(
          model,
          body.prompt,
          body.options || {},
          {
            preferredProvider: body.model?.includes(':')
              ? inferProvider(body.model, env.DEFAULT_PROVIDER || 'openai')
              : undefined,
          }
        );

        result = {
          text: routerResult.text,
          provider: routerResult.provider,
          model: routerResult.model,
          tokens_used: routerResult.tokens_used,
          metadata: {
            ...routerResult.metadata,
            routing: routerResult.routingInfo,
          },
        };

        // Log routing info
        if (routerResult.routingInfo.fallbackUsed) {
          console.log(
            `Request used fallback: tried ${routerResult.routingInfo.attemptedProviders.join(' → ')}, ` +
            `succeeded with ${routerResult.routingInfo.finalProvider}`
          );
        }
      } catch (routerError) {
        // All providers failed - return error with details
        console.error('All providers failed:', routerError);
        return createErrorResponse(
          routerError instanceof Error ? routerError.message : 'All providers failed',
          'ALL_PROVIDERS_FAILED',
          requestId,
          503
        );
      }
    }

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
 * Generate text using dynamic model configuration
 * This uses the payload mapper to support any provider
 */
async function generateWithModelConfig(
  modelConfig: ModelConfig,
  prompt: string,
  options: any,
  apiKey: string
): Promise<TextResult> {
  const { payload_mapping, provider_id, model_id } = modelConfig;

  // Validate payload mapping
  if (!validatePayloadMapping(payload_mapping)) {
    throw new Error('Invalid payload mapping in model config');
  }

  // Prepare user inputs for payload mapping
  const userInputs: Record<string, any> = {
    user_prompt: prompt,
    prompt: prompt, // Support both naming conventions
    max_tokens: options.max_tokens,
    temperature: options.temperature,
    top_p: options.top_p,
    ...options,
  };

  // Apply payload mapping to generate provider request
  const providerRequest = applyPayloadMapping(
    payload_mapping,
    userInputs,
    apiKey
  );

  // Build full URL
  const baseUrl = getProviderBaseUrl(provider_id);
  const fullUrl = `${baseUrl}${providerRequest.endpoint}`;

  console.log(`Calling ${provider_id} at ${fullUrl}`);

  // Make request to provider
  const response = await fetch(fullUrl, {
    method: providerRequest.method,
    headers: providerRequest.headers,
    body: JSON.stringify(providerRequest.body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Provider API error (${response.status}): ${errorText}`);
  }

  const responseData = await response.json();

  // Extract relevant fields using response mapping
  const extracted = applyResponseMapping(responseData, payload_mapping.response_mapping);

  // Return standardized result
  return {
    text: extracted.text || extracted.content || extracted.message || '',
    provider: provider_id,
    model: model_id,
    tokens_used: extracted.tokens_used || extracted.usage_tokens || 0,
    metadata: {
      ...extracted,
      raw_response: responseData,
      config_id: modelConfig.config_id,
      display_name: modelConfig.display_name,
    },
  };
}

/**
 * Get base URL for provider
 */
function getProviderBaseUrl(providerId: string): string {
  const providerUrls: Record<string, string> = {
    openai: 'https://api.openai.com',
    anthropic: 'https://api.anthropic.com',
    google: 'https://generativelanguage.googleapis.com',
    cohere: 'https://api.cohere.ai',
    // Add more providers as needed
  };

  return providerUrls[providerId.toLowerCase()] || `https://api.${providerId}.com`;
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
  const providerLower = provider.toLowerCase();
  if (providerLower === 'openai') {
    return env.OPENAI_API_KEY;
  }
  if (providerLower === 'anthropic') {
    return env.ANTHROPIC_API_KEY;
  }
  return undefined;
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
 * Fetch model configuration from Config Service
 */
async function fetchModelConfig(
  modelId: string,
  env: Env
): Promise<ModelConfig | null> {
  const configServiceUrl = env.CONFIG_SERVICE_URL || 'https://api.distributedelectrons.com';
  const url = `${configServiceUrl}/model-config/${modelId}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch model config for ${modelId}: ${response.status}`);
      return null;
    }

    const data = await response.json() as any;

    // The config service returns { data: ModelConfig, request_id: string }
    if (data && data.data) {
      return data.data as ModelConfig;
    }

    return null;
  } catch (error) {
    console.error(`Error fetching model config for ${modelId}:`, error);
    return null;
  }
}

/**
 * Handle streaming text generation request
 */
async function handleGenerateStream(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
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

    // Extract instance ID
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

    // Determine provider and model
    const provider = inferProvider(body.model || '', env.DEFAULT_PROVIDER || 'openai');
    const model = stripProviderPrefix(body.model || '') || getDefaultModel(provider);

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

    // Create streaming response based on provider
    let stream: ReadableStream;

    switch (provider.toLowerCase()) {
      case 'openai':
        stream = await streamWithOpenAI(model, body.prompt, body.options || {}, apiKey, requestId);
        break;
      case 'anthropic':
        stream = await streamWithAnthropic(model, body.prompt, body.options || {}, apiKey, requestId);
        break;
      default:
        return createErrorResponse(
          `Streaming not supported for provider: ${provider}`,
          'UNSUPPORTED_PROVIDER',
          requestId,
          400
        );
    }

    // Return SSE response
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Request-ID': requestId,
      },
    });
  } catch (error) {
    console.error('Streaming error:', error);
    return createErrorResponse(
      error instanceof Error ? error.message : 'Streaming failed',
      'STREAMING_ERROR',
      requestId,
      500
    );
  }
}

/**
 * Stream text generation using OpenAI API
 */
async function streamWithOpenAI(
  model: string,
  prompt: string,
  options: any,
  apiKey: string,
  requestId: string
): Promise<ReadableStream> {
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
      stream: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${error}`);
  }

  if (!response.body) {
    throw new Error('No response body from OpenAI');
  }

  // Transform OpenAI's SSE stream to our format
  return transformOpenAIStream(response.body, requestId);
}

/**
 * Transform OpenAI's SSE stream to our standardized format
 */
function transformOpenAIStream(inputStream: ReadableStream, requestId: string): ReadableStream {
  const reader = inputStream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';

  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();

        if (done) {
          // Send final done message
          const doneEvent = `data: ${JSON.stringify({ text: '', done: true, request_id: requestId })}\n\n`;
          controller.enqueue(encoder.encode(doneEvent));
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();

            if (data === '[DONE]') {
              const doneEvent = `data: ${JSON.stringify({ text: '', done: true, request_id: requestId })}\n\n`;
              controller.enqueue(encoder.encode(doneEvent));
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;

              if (content) {
                const event = `data: ${JSON.stringify({ text: content, done: false, request_id: requestId })}\n\n`;
                controller.enqueue(encoder.encode(event));
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      } catch (error) {
        const errorEvent = `data: ${JSON.stringify({ error: 'Stream error', done: true, request_id: requestId })}\n\n`;
        controller.enqueue(encoder.encode(errorEvent));
        controller.close();
      }
    },
    cancel() {
      reader.cancel();
    },
  });
}

/**
 * Stream text generation using Anthropic API
 */
async function streamWithAnthropic(
  model: string,
  prompt: string,
  options: any,
  apiKey: string,
  requestId: string
): Promise<ReadableStream> {
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
      stream: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${error}`);
  }

  if (!response.body) {
    throw new Error('No response body from Anthropic');
  }

  // Transform Anthropic's SSE stream to our format
  return transformAnthropicStream(response.body, requestId);
}

/**
 * Transform Anthropic's SSE stream to our standardized format
 */
function transformAnthropicStream(inputStream: ReadableStream, requestId: string): ReadableStream {
  const reader = inputStream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';

  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();

        if (done) {
          const doneEvent = `data: ${JSON.stringify({ text: '', done: true, request_id: requestId })}\n\n`;
          controller.enqueue(encoder.encode(doneEvent));
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();

            try {
              const parsed = JSON.parse(data);

              // Anthropic sends different event types
              if (parsed.type === 'content_block_delta') {
                const content = parsed.delta?.text;
                if (content) {
                  const event = `data: ${JSON.stringify({ text: content, done: false, request_id: requestId })}\n\n`;
                  controller.enqueue(encoder.encode(event));
                }
              } else if (parsed.type === 'message_stop') {
                const doneEvent = `data: ${JSON.stringify({ text: '', done: true, request_id: requestId })}\n\n`;
                controller.enqueue(encoder.encode(doneEvent));
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      } catch (error) {
        const errorEvent = `data: ${JSON.stringify({ error: 'Stream error', done: true, request_id: requestId })}\n\n`;
        controller.enqueue(encoder.encode(errorEvent));
        controller.close();
      }
    },
    cancel() {
      reader.cancel();
    },
  });
}

// ===========================================
// Phase 2 Router Handlers
// ===========================================

/**
 * Handle v2 router request (supports simple and workflow requests)
 */
async function handleRouterV2Request(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  try {
    const body = await request.json() as RouterRequest;

    // Create router v2 instance (needs DB binding from env)
    const routerEnv: RouterEnv = {
      DB: (env as any).DB,
      CF_AIG_TOKEN: (env as any).CF_AIG_TOKEN,
      AI_GATEWAY_URL: (env as any).AI_GATEWAY_URL,
      OPENAI_API_KEY: env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      GOOGLE_API_KEY: (env as any).GOOGLE_API_KEY,
      SPARK_LOCAL_URL: (env as any).SPARK_LOCAL_URL,
      SPARK_API_KEY: (env as any).SPARK_API_KEY,
      IDEOGRAM_API_KEY: (env as any).IDEOGRAM_API_KEY,
      ELEVENLABS_API_KEY: (env as any).ELEVENLABS_API_KEY,
      REPLICATE_API_KEY: (env as any).REPLICATE_API_TOKEN,
      ZAI_API_KEY: (env as any).ZAI_API_KEY,
    };

    const router = createRouterV2(routerEnv);
    const result = await router.route(body);

    return Response.json({
      ...result,
      request_id: requestId,
      timestamp: new Date().toISOString(),
    }, {
      status: result.success ? 200 : 500,
      headers: {
        'X-Request-ID': requestId,
      },
    });
  } catch (error) {
    console.error('Router v2 error:', error);
    return createErrorResponse(
      error instanceof Error ? error.message : 'Router request failed',
      'ROUTER_ERROR',
      requestId,
      500
    );
  }
}

/**
 * Handle v2 router health check
 */
async function handleRouterV2Health(
  env: Env,
  requestId: string
): Promise<Response> {
  try {
    const routerEnv: RouterEnv = {
      DB: (env as any).DB,
      CF_AIG_TOKEN: (env as any).CF_AIG_TOKEN,
      AI_GATEWAY_URL: (env as any).AI_GATEWAY_URL,
      OPENAI_API_KEY: env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      GOOGLE_API_KEY: (env as any).GOOGLE_API_KEY,
      SPARK_LOCAL_URL: (env as any).SPARK_LOCAL_URL,
      SPARK_API_KEY: (env as any).SPARK_API_KEY,
      IDEOGRAM_API_KEY: (env as any).IDEOGRAM_API_KEY,
      ELEVENLABS_API_KEY: (env as any).ELEVENLABS_API_KEY,
      REPLICATE_API_KEY: (env as any).REPLICATE_API_TOKEN,
      ZAI_API_KEY: (env as any).ZAI_API_KEY,
    };

    const router = createRouterV2(routerEnv);
    const health = await router.getHealth();

    return Response.json({
      ...health,
      request_id: requestId,
      timestamp: new Date().toISOString(),
    }, {
      headers: {
        'X-Request-ID': requestId,
      },
    });
  } catch (error) {
    console.error('Router health check error:', error);
    return createErrorResponse(
      error instanceof Error ? error.message : 'Health check failed',
      'HEALTH_CHECK_ERROR',
      requestId,
      500
    );
  }
}

/**
 * Handle listing available workflows
 */
async function handleListWorkflows(
  env: Env,
  requestId: string
): Promise<Response> {
  try {
    const routerEnv: RouterEnv = {
      DB: (env as any).DB,
      CF_AIG_TOKEN: (env as any).CF_AIG_TOKEN,
      AI_GATEWAY_URL: (env as any).AI_GATEWAY_URL,
      OPENAI_API_KEY: env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      GOOGLE_API_KEY: (env as any).GOOGLE_API_KEY,
      SPARK_LOCAL_URL: (env as any).SPARK_LOCAL_URL,
      SPARK_API_KEY: (env as any).SPARK_API_KEY,
      IDEOGRAM_API_KEY: (env as any).IDEOGRAM_API_KEY,
      ELEVENLABS_API_KEY: (env as any).ELEVENLABS_API_KEY,
      REPLICATE_API_KEY: (env as any).REPLICATE_API_TOKEN,
      ZAI_API_KEY: (env as any).ZAI_API_KEY,
    };

    const router = createRouterV2(routerEnv);
    const workflows = await router.listWorkflows();

    return Response.json({
      workflows,
      request_id: requestId,
      timestamp: new Date().toISOString(),
    }, {
      headers: {
        'X-Request-ID': requestId,
      },
    });
  } catch (error) {
    console.error('List workflows error:', error);
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to list workflows',
      'WORKFLOW_LIST_ERROR',
      requestId,
      500
    );
  }
}

/**
 * Handle router stats request
 */
async function handleRouterStats(
  env: Env,
  requestId: string
): Promise<Response> {
  try {
    const routerEnv: RouterEnv = {
      DB: (env as any).DB,
      CF_AIG_TOKEN: (env as any).CF_AIG_TOKEN,
      AI_GATEWAY_URL: (env as any).AI_GATEWAY_URL,
      OPENAI_API_KEY: env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      GOOGLE_API_KEY: (env as any).GOOGLE_API_KEY,
      SPARK_LOCAL_URL: (env as any).SPARK_LOCAL_URL,
      SPARK_API_KEY: (env as any).SPARK_API_KEY,
      IDEOGRAM_API_KEY: (env as any).IDEOGRAM_API_KEY,
      ELEVENLABS_API_KEY: (env as any).ELEVENLABS_API_KEY,
      REPLICATE_API_KEY: (env as any).REPLICATE_API_TOKEN,
      ZAI_API_KEY: (env as any).ZAI_API_KEY,
    };

    const router = createRouterV2(routerEnv);
    const stats = await router.getStats();

    return Response.json({
      stats,
      request_id: requestId,
      timestamp: new Date().toISOString(),
    }, {
      headers: {
        'X-Request-ID': requestId,
      },
    });
  } catch (error) {
    console.error('Router stats error:', error);
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to get stats',
      'STATS_ERROR',
      requestId,
      500
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
