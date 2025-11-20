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
import type {
  Env,
  GenerateRequest,
  GenerateResponse,
  ErrorResponse,
  InstanceConfig,
} from './types';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Generate request ID for tracking
    const requestId = crypto.randomUUID();

    try {
      const url = new URL(request.url);

      // Route handling
      if (url.pathname === '/generate' && request.method === 'POST') {
        return await handleGenerate(request, env, requestId);
      }

      if (url.pathname === '/health' && request.method === 'GET') {
        return Response.json({ status: 'healthy', service: 'image-gen' });
      }

      return createErrorResponse(
        'Not Found',
        'ROUTE_NOT_FOUND',
        requestId,
        404
      );
    } catch (error) {
      console.error('Unhandled error:', error);
      return createErrorResponse(
        error instanceof Error ? error.message : 'Internal Server Error',
        'INTERNAL_ERROR',
        requestId,
        500
      );
    }
  },
};

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

    // Step 1: Get instance configuration
    // Note: In production, this would call Team 1's Config Service
    // For now, we'll create a mock config
    const instanceConfig = await getInstanceConfig(instanceId, env);

    if (!instanceConfig) {
      return createErrorResponse(
        `Instance not found: ${instanceId}`,
        'INSTANCE_NOT_FOUND',
        requestId,
        404
      );
    }

    // Step 2: Determine provider (default to ideogram for MVP)
    const provider = env.DEFAULT_PROVIDER || 'ideogram';

    // Step 3: Check rate limits
    const rateLimitConfig = instanceConfig.rate_limits[provider];
    if (rateLimitConfig && env.RATE_LIMITER) {
      const rateLimitResult = await checkAndRecordRequest(
        { RATE_LIMITER: env.RATE_LIMITER },
        instanceId,
        provider,
        rateLimitConfig
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

    // Step 4: Get provider adapter
    const adapter = providerRegistry.getAdapter(provider);

    // Step 5: Format request for provider
    const providerRequest = adapter.formatRequest(body.prompt, body.options || {});

    // Step 6: Submit job to provider
    const apiKey = instanceConfig.api_keys[provider];
    if (!apiKey) {
      return createErrorResponse(
        `API key not configured for provider: ${provider}`,
        'MISSING_API_KEY',
        requestId,
        500
      );
    }

    const jobId = await adapter.submitJob(providerRequest, apiKey);

    // Step 7: Poll until complete (with timeout)
    const imageResult = await adapter.pollUntilComplete(
      jobId,
      apiKey,
      60000, // 60 second timeout
      2000 // Poll every 2 seconds
    );

    // Step 8: Download image data
    const imageResponse = await fetch(imageResult.image_url);
    if (!imageResponse.ok) {
      throw new Error('Failed to download image from provider');
    }
    const imageData = await imageResponse.arrayBuffer();

    // Step 9: Upload to R2
    const filename = `${body.prompt.substring(0, 50).replace(/[^a-z0-9]/gi, '_')}.png`;
    const metadata = createImageMetadata(
      instanceId,
      provider,
      imageResult.model,
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
        CDN_URL: env.CDN_URL,
      }
    );

    // Step 10: Return success response
    const generationTime = Date.now() - startTime;

    const response: GenerateResponse = {
      success: true,
      image_url: uploadResult.cdn_url,
      r2_path: uploadResult.r2_path,
      metadata: {
        provider: imageResult.provider,
        model: imageResult.model,
        dimensions: imageResult.metadata.dimensions,
        format: imageResult.metadata.format,
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
 * Get instance configuration
 * Note: This is a mock implementation. In production, this would call
 * Team 1's Config Service to get the real configuration from D1.
 */
async function getInstanceConfig(
  instanceId: string,
  env: Env
): Promise<InstanceConfig | null> {
  // Mock configuration for MVP
  // In production, this would query Team 1's Config Service
  return {
    instance_id: instanceId,
    org_id: 'solamp',
    api_keys: {
      // These would come from D1 database in production
      ideogram: env.IDEOGRAM_API_KEY || 'ide_mock_key',
    },
    rate_limits: {
      ideogram: {
        rpm: 100,
        tpm: 50000,
      },
    },
    r2_bucket: 'production-images',
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
