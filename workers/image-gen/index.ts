/**
 * Image Generation Worker
 * Main worker that orchestrates image generation workflow
 */

import { providerRegistry } from '../shared/provider-adapters';
import { checkAndRecordRequest } from '../shared/rate-limiter';
import {
  uploadImage,
  generateMetadata as createImageMetadata,
  serializeMetadata,
} from '../shared/r2-manager';
import {
  applyPayloadMapping,
  applyResponseMapping,
  type PayloadMapping,
} from '../shared/utils/payload-mapper';
import {
  fetchModelConfigCached,
  getInstanceConfigCached,
} from '../shared/config-cache';
import {
  addCorsHeaders,
  createErrorResponse,
} from '../shared/http';
import type {
  Env,
  GenerateRequest,
  GenerateResponse,
  ModelConfig,
} from './types';

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
          service: 'image-gen',
          r2_configured: !!env.R2_BUCKET,
        }));
      }

      // Test R2 upload
      if (url.pathname === '/test-r2' && request.method === 'GET') {
        try {
          if (!env.R2_BUCKET) {
            return Response.json({ error: 'R2_BUCKET not configured' }, { status: 500 });
          }
          const testData = new TextEncoder().encode('test');
          await env.R2_BUCKET.put('test/test.txt', testData);
          const retrieved = await env.R2_BUCKET.get('test/test.txt');
          return Response.json({
            success: true,
            uploaded: !!retrieved,
            url: `${request.url.split('/test-r2')[0]}/images/test/test.txt`
          });
        } catch (error) {
          return Response.json({
            error: error instanceof Error ? error.message : 'Unknown error'
          }, { status: 500 });
        }
      }

      // Serve images from R2
      if (url.pathname.startsWith('/images/') && request.method === 'GET') {
        const response = await handleImageServe(url.pathname.replace('/images/', ''), env);
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

// addCorsHeaders moved to shared/http

/**
 * Handle image generation request
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

    // Step 1: Get instance configuration (cached)
    const instanceConfig = getInstanceConfigCached(instanceId, env);

    if (!instanceConfig) {
      return createErrorResponse(
        `Instance not found: ${instanceId}`,
        'INSTANCE_NOT_FOUND',
        requestId,
        404
      );
    }

    // Step 2: Determine model_id and fetch configuration (cached)
    // Support both 'model' and 'model_id' parameters for backwards compatibility
    const modelId = body.model_id || body.model || getDefaultModelId(env);
    let modelConfig: ModelConfig | null = null;
    let useModelConfig = false;

    // Attempt to fetch model config (with caching)
    console.log(`Attempting to fetch model config for: ${modelId}`);
    const configServiceUrl = env.CONFIG_SERVICE_URL || 'https://api.distributedelectrons.com';
    modelConfig = await fetchModelConfigCached(modelId, configServiceUrl);

    if (modelConfig) {
      console.log(`Using dynamic model config for: ${modelConfig.model_id}`);
      useModelConfig = true;
    } else {
      console.log(`Model config fetch failed, falling back to legacy adapter`);
    }

    // Determine provider (from model config or default)
    const provider = modelConfig?.provider_id || env.DEFAULT_PROVIDER || 'ideogram';

    // Step 3: Check rate limits
    const rateLimitConfig = modelConfig?.rate_limits || instanceConfig.rate_limits[provider];
    if (rateLimitConfig && env.RATE_LIMITER) {
      const rateLimitResult = await checkAndRecordRequest(
        { RATE_LIMITER: env.RATE_LIMITER },
        instanceId,
        provider,
        {
          rpm: rateLimitConfig.rpm,
          tpm: rateLimitConfig.tpm,
        }
      );

      if (!rateLimitResult.allowed) {
        return createErrorResponse(
          'Rate limit exceeded',
          'RATE_LIMIT_EXCEEDED',
          requestId,
          429,
          {
            retry_after: rateLimitResult.retry_after,
            reset: rateLimitResult.reset,
          }
        );
      }
    }

    // Step 4: Get API key for provider
    const apiKey = instanceConfig.api_keys[provider];
    if (!apiKey) {
      return createErrorResponse(
        `API key not configured for provider: ${provider}`,
        'MISSING_API_KEY',
        requestId,
        500
      );
    }

    // Step 5-8: Generate image (using model config or fallback to legacy adapter)
    let imageData: ArrayBuffer;
    let imageMetadata: any;

    if (useModelConfig && modelConfig) {
      // Use dynamic model config system
      console.log('Generating image with dynamic model config');
      const result = await generateWithModelConfig(
        modelConfig,
        body.prompt,
        body.options || {},
        apiKey
      );
      imageData = result.imageData;
      imageMetadata = result.metadata;
    } else {
      // Fallback to legacy provider adapter system
      console.log('Generating image with legacy provider adapter');

      // Get provider adapter
      const adapter = providerRegistry.getAdapter(provider);

      // Step 5: Format request for provider
      const providerRequest = adapter.formatRequest(body.prompt, body.options || {});

      // Step 6: Submit job to provider
      const jobId = await adapter.submitJob(providerRequest, apiKey);

      // Step 7: Poll until complete (with timeout)
      const imageResult = await adapter.pollUntilComplete(
        jobId,
        apiKey,
        60000, // 60 second timeout
        2000 // Poll every 2 seconds
      );

      // Step 8: Download image from provider
      const imageResponse = await fetch(imageResult.image_url);
      if (!imageResponse.ok) {
        throw new Error('Failed to download image from provider');
      }
      imageData = await imageResponse.arrayBuffer();
      imageMetadata = {
        provider: imageResult.provider,
        model: imageResult.model,
        dimensions: imageResult.metadata.dimensions,
        format: imageResult.metadata.format,
        generation_time_ms: imageResult.metadata.generation_time_ms,
      };
    }

    // Step 9: Upload to R2
    const filename = `${body.prompt.substring(0, 50).replace(/[^a-z0-9]/gi, '_')}.png`;
    const metadata = createImageMetadata(
      instanceId,
      provider,
      imageMetadata.model,
      body.prompt,
      body.project_id
    );

    const uploadResult = await uploadImage(
      imageData,
      {
        instanceId,
        projectId: body.project_id,
        filename,
        metadata: serializeMetadata(metadata),
      },
      {
        R2_BUCKET: env.R2_BUCKET,
        CDN_URL: request.url.match(/^https?:\/\/[^\/]+/)?.[0] || '', // Use worker URL as CDN
      }
    );

    // Step 10: Return success response with R2 URL
    const generationTime = Date.now() - startTime;

    const response: GenerateResponse = {
      success: true,
      image_url: uploadResult.cdn_url,
      r2_path: uploadResult.r2_path,
      metadata: {
        provider: imageMetadata.provider,
        model: imageMetadata.model,
        dimensions: imageMetadata.dimensions,
        format: imageMetadata.format,
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
          'Image generation timed out',
          'GATEWAY_TIMEOUT',
          requestId,
          504
        );
      }

      if (error.message.includes('Rate limit')) {
        return createErrorResponse(
          'Provider rate limit exceeded',
          'PROVIDER_RATE_LIMIT',
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
 * Get default model ID for the instance
 */
function getDefaultModelId(env: Env): string {
  return env.DEFAULT_MODEL_ID || 'ideogram-v2';
}

// Config functions moved to shared/config-cache for caching support

/**
 * Generate image using dynamic model config and payload mapping
 * Returns image data and metadata on success
 */
async function generateWithModelConfig(
  modelConfig: ModelConfig,
  prompt: string,
  options: Record<string, any>,
  apiKey: string
): Promise<{ imageData: ArrayBuffer; metadata: any }> {
  const startTime = Date.now();

  // Prepare user inputs for payload mapping
  const userInputs = {
    user_prompt: prompt,
    ...options,
  };

  // Apply payload mapping to create provider request
  const providerRequest = applyPayloadMapping(
    modelConfig.payload_mapping as PayloadMapping,
    userInputs,
    apiKey
  );

  console.log(`Calling provider endpoint: ${modelConfig.payload_mapping.endpoint}`);

  // Construct full API URL
  const baseUrl = getProviderBaseUrl(modelConfig.provider_id);
  const fullUrl = `${baseUrl}${providerRequest.endpoint}`;

  // Submit job to provider
  const submitResponse = await fetch(fullUrl, {
    method: providerRequest.method,
    headers: providerRequest.headers,
    body: JSON.stringify(providerRequest.body),
  });

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    throw new Error(`Provider API error: ${submitResponse.status} - ${errorText}`);
  }

  const submitResult = await submitResponse.json();
  console.log('Provider submit response:', JSON.stringify(submitResult).substring(0, 200));

  // Extract job_id from response using response mapping
  const mappedResponse = applyResponseMapping(
    submitResult,
    modelConfig.payload_mapping.response_mapping
  );

  const jobId = mappedResponse.job_id;
  if (!jobId) {
    throw new Error('Failed to extract job_id from provider response');
  }

  console.log(`Job submitted with ID: ${jobId}`);

  // Poll for completion (similar to existing adapter pattern)
  const imageUrl = await pollForCompletion(
    modelConfig.provider_id,
    jobId,
    apiKey,
    modelConfig.payload_mapping.response_mapping,
    60000, // 60 second timeout
    2000 // Poll every 2 seconds
  );

  // Download image from provider
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to download image from provider: ${imageResponse.status}`);
  }

  const imageData = await imageResponse.arrayBuffer();
  const generationTime = Date.now() - startTime;

  return {
    imageData,
    metadata: {
      provider: modelConfig.provider_id,
      model: modelConfig.model_id,
      dimensions: options.aspect_ratio || '1:1',
      format: 'png',
      generation_time_ms: generationTime,
    },
  };
}

/**
 * Get base URL for a provider
 */
function getProviderBaseUrl(providerId: string): string {
  const baseUrls: Record<string, string> = {
    ideogram: 'https://api.ideogram.ai',
    openai: 'https://api.openai.com',
    stability: 'https://api.stability.ai',
  };

  return baseUrls[providerId] || `https://api.${providerId}.com`;
}

/**
 * Poll provider until job is complete
 * Uses response mapping to extract status and image URL
 */
async function pollForCompletion(
  providerId: string,
  jobId: string,
  apiKey: string,
  responseMapping: Record<string, string>,
  timeoutMs: number = 60000,
  pollIntervalMs: number = 2000
): Promise<string> {
  const startTime = Date.now();
  const baseUrl = getProviderBaseUrl(providerId);

  while (Date.now() - startTime < timeoutMs) {
    // Poll the job status endpoint
    const pollUrl = `${baseUrl}/${jobId}`;

    const response = await fetch(pollUrl, {
      method: 'GET',
      headers: {
        'Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Polling failed: ${response.status}`);
    }

    const result = await response.json();
    const mapped = applyResponseMapping(result, responseMapping);

    console.log(`Job ${jobId} status: ${mapped.status}`);

    // Check if completed
    if (mapped.status === 'COMPLETE' || mapped.status === 'completed') {
      if (!mapped.image_url) {
        throw new Error('Job completed but no image_url in response');
      }
      return mapped.image_url;
    }

    // Check if failed
    if (mapped.status === 'FAILED' || mapped.status === 'failed') {
      throw new Error(`Job failed: ${JSON.stringify(result)}`);
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Job polling timeout after ${timeoutMs}ms`);
}

/**
 * Serve image from R2
 */
async function handleImageServe(path: string, env: Env): Promise<Response> {
  if (!env.R2_BUCKET) {
    return new Response('R2 bucket not configured', { status: 500 });
  }

  const object = await env.R2_BUCKET.get(path);

  if (!object) {
    return new Response('Image not found', { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');

  return new Response(object.body, {
    headers,
  });
}

// createErrorResponse moved to shared/http
