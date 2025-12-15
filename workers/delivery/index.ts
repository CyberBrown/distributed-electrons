/**
 * Delivery Worker
 * Handles provider responses and completes request lifecycle
 *
 * Responsibilities:
 * - Receive provider responses (webhook or polling)
 * - Assess deliverable quality
 * - Store deliverables in D1
 * - Notify Request Router DO of completion
 * - Trigger callbacks to client apps
 */

import type {
  Env,
  ProviderResponse,
  StoredDeliverable,
  CallbackPayload,
  ErrorResponse,
} from './types';
import { assessQuality, shouldAutoApprove, shouldAutoReject } from './quality';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID();

    try {
      const url = new URL(request.url);

      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: corsHeaders(),
        });
      }

      // Route handling
      if (url.pathname === '/deliver' && request.method === 'POST') {
        const response = await handleDeliver(request, env, requestId);
        return addCorsHeaders(response);
      }

      if (url.pathname === '/webhook' && request.method === 'POST') {
        // Webhook endpoint for providers
        const response = await handleWebhook(request, env, requestId);
        return addCorsHeaders(response);
      }

      if (url.pathname === '/deliverable' && request.method === 'GET') {
        const id = url.searchParams.get('id');
        if (!id) {
          return addCorsHeaders(createErrorResponse('id parameter required', 'MISSING_PARAM', requestId, 400));
        }
        const response = await handleGetDeliverable(id, env, requestId);
        return addCorsHeaders(response);
      }

      if (url.pathname === '/approve' && request.method === 'POST') {
        const response = await handleApprove(request, env, requestId);
        return addCorsHeaders(response);
      }

      if (url.pathname === '/reject' && request.method === 'POST') {
        const response = await handleReject(request, env, requestId);
        return addCorsHeaders(response);
      }

      if (url.pathname === '/health' && request.method === 'GET') {
        return addCorsHeaders(Response.json({
          status: 'healthy',
          service: 'delivery',
          timestamp: new Date().toISOString(),
        }));
      }

      return addCorsHeaders(createErrorResponse('Not Found', 'ROUTE_NOT_FOUND', requestId, 404));
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
 * Handle delivery of provider response
 */
async function handleDeliver(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  try {
    const body: ProviderResponse = await request.json();

    // Validate required fields
    if (!body.request_id) {
      return createErrorResponse('request_id is required', 'MISSING_FIELD', requestId, 400);
    }

    // Verify the request exists
    const existingRequest = await env.DB.prepare(`
      SELECT id, status, callback_url FROM requests WHERE id = ?
    `).bind(body.request_id).first<{ id: string; status: string; callback_url: string | null }>();

    if (!existingRequest) {
      return createErrorResponse('Request not found', 'NOT_FOUND', requestId, 404);
    }

    const now = new Date().toISOString();
    const deliverableId = crypto.randomUUID();

    // Handle failure response
    if (!body.success) {
      // Store failed deliverable
      await env.DB.prepare(`
        INSERT INTO deliverables (
          id, request_id, provider_response, content_type, content,
          quality_score, quality_metadata, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        deliverableId,
        body.request_id,
        JSON.stringify(body.raw_response || {}),
        body.content_type || 'text',
        body.error || 'Unknown error',
        0,
        JSON.stringify({ error: body.error }),
        'failed',
        now,
        now
      ).run();

      // Notify Router DO of failure
      await notifyRouterCompletion(env, body.request_id, false, body.error);

      // Update request status
      await env.DB.prepare(`
        UPDATE requests SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?
      `).bind(body.error || 'Provider error', now, body.request_id).run();

      // Send callback if configured
      if (existingRequest.callback_url) {
        await sendCallback(existingRequest.callback_url, {
          request_id: body.request_id,
          status: 'failed',
          error: body.error,
          timestamp: now,
        });
      }

      return Response.json({
        success: true,
        deliverable_id: deliverableId,
        status: 'failed',
      });
    }

    // Assess quality
    const quality = assessQuality(body);

    // Determine initial status based on quality
    let status: string;
    if (shouldAutoApprove(quality)) {
      status = 'approved';
    } else if (shouldAutoReject(quality)) {
      status = 'rejected';
    } else {
      status = 'pending_review';
    }

    // Store deliverable
    await env.DB.prepare(`
      INSERT INTO deliverables (
        id, request_id, provider_response, content_type, content,
        quality_score, quality_metadata, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      deliverableId,
      body.request_id,
      JSON.stringify(body.raw_response || {}),
      body.content_type,
      body.content,
      quality.score,
      JSON.stringify(quality),
      status,
      now,
      now
    ).run();

    // If auto-approved, complete the request
    if (status === 'approved') {
      // Update deliverable status
      await env.DB.prepare(`
        UPDATE deliverables SET status = 'delivered', delivered_at = ?, final_output = ? WHERE id = ?
      `).bind(now, JSON.stringify({ content: body.content, content_type: body.content_type }), deliverableId).run();

      // Notify Router DO
      await notifyRouterCompletion(env, body.request_id, true);

      // Update request status
      await env.DB.prepare(`
        UPDATE requests SET status = 'completed', completed_at = ? WHERE id = ?
      `).bind(now, body.request_id).run();

      // Send callback
      if (existingRequest.callback_url) {
        await sendCallback(existingRequest.callback_url, {
          request_id: body.request_id,
          status: 'completed',
          deliverable_id: deliverableId,
          content_type: body.content_type,
          content: body.content,
          quality_score: quality.score,
          timestamp: now,
        });
      }
    } else if (status === 'rejected') {
      // Auto-rejected - notify as failure
      await notifyRouterCompletion(env, body.request_id, false, 'Quality check failed');

      await env.DB.prepare(`
        UPDATE requests SET status = 'failed', error_message = 'Quality check failed', completed_at = ? WHERE id = ?
      `).bind(now, body.request_id).run();

      if (existingRequest.callback_url) {
        await sendCallback(existingRequest.callback_url, {
          request_id: body.request_id,
          status: 'failed',
          error: 'Quality check failed: ' + quality.issues.join(', '),
          timestamp: now,
        });
      }
    }
    // If pending_review, wait for manual approval

    return Response.json({
      success: true,
      deliverable_id: deliverableId,
      status,
      quality_score: quality.score,
    });
  } catch (error) {
    console.error('Delivery error:', error);

    if (error instanceof SyntaxError) {
      return createErrorResponse('Invalid JSON body', 'INVALID_JSON', requestId, 400);
    }

    return createErrorResponse(
      error instanceof Error ? error.message : 'Delivery failed',
      'DELIVERY_ERROR',
      requestId,
      500
    );
  }
}

/**
 * Handle webhook from providers
 */
async function handleWebhook(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  try {
    // Get provider from header or query param
    const url = new URL(request.url);
    const provider = request.headers.get('X-Provider') || url.searchParams.get('provider');

    const rawBody = await request.text();
    let body: Record<string, any>;

    try {
      body = JSON.parse(rawBody);
    } catch {
      return createErrorResponse('Invalid JSON', 'INVALID_JSON', requestId, 400);
    }

    // Transform webhook payload to standard format
    const standardResponse = transformWebhookPayload(provider, body);

    if (!standardResponse.request_id) {
      return createErrorResponse('Could not extract request_id from webhook', 'MISSING_REQUEST_ID', requestId, 400);
    }

    // Process as regular delivery
    const deliverRequest = new Request(request.url.replace('/webhook', '/deliver'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(standardResponse),
    });

    return handleDeliver(deliverRequest, env, requestId);
  } catch (error) {
    console.error('Webhook error:', error);
    return createErrorResponse(
      error instanceof Error ? error.message : 'Webhook processing failed',
      'WEBHOOK_ERROR',
      requestId,
      500
    );
  }
}

/**
 * Get a deliverable by ID
 */
async function handleGetDeliverable(
  id: string,
  env: Env,
  requestId: string
): Promise<Response> {
  try {
    const result = await env.DB.prepare(`
      SELECT * FROM deliverables WHERE id = ?
    `).bind(id).first<StoredDeliverable>();

    if (!result) {
      return createErrorResponse('Deliverable not found', 'NOT_FOUND', requestId, 404);
    }

    return Response.json({
      success: true,
      deliverable: {
        ...result,
        provider_response: result.provider_response ? JSON.parse(result.provider_response) : null,
        quality_metadata: result.quality_metadata ? JSON.parse(result.quality_metadata) : null,
        post_processing_chain: result.post_processing_chain ? JSON.parse(result.post_processing_chain) : null,
        final_output: result.final_output ? JSON.parse(result.final_output) : null,
      },
    });
  } catch (error) {
    console.error('Get deliverable error:', error);
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to get deliverable',
      'DB_ERROR',
      requestId,
      500
    );
  }
}

/**
 * Manually approve a pending deliverable
 */
async function handleApprove(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  try {
    const body = await request.json() as { deliverable_id: string };

    if (!body.deliverable_id) {
      return createErrorResponse('deliverable_id is required', 'MISSING_FIELD', requestId, 400);
    }

    const deliverable = await env.DB.prepare(`
      SELECT d.*, r.callback_url FROM deliverables d
      JOIN requests r ON d.request_id = r.id
      WHERE d.id = ?
    `).bind(body.deliverable_id).first<StoredDeliverable & { callback_url: string | null }>();

    if (!deliverable) {
      return createErrorResponse('Deliverable not found', 'NOT_FOUND', requestId, 404);
    }

    if (deliverable.status !== 'pending_review') {
      return createErrorResponse(`Cannot approve deliverable in ${deliverable.status} status`, 'INVALID_STATUS', requestId, 400);
    }

    const now = new Date().toISOString();

    // Update deliverable
    await env.DB.prepare(`
      UPDATE deliverables SET status = 'delivered', delivered_at = ?, final_output = ?, updated_at = ? WHERE id = ?
    `).bind(
      now,
      JSON.stringify({ content: deliverable.content, content_type: deliverable.content_type }),
      now,
      body.deliverable_id
    ).run();

    // Notify Router and update request
    await notifyRouterCompletion(env, deliverable.request_id, true);
    await env.DB.prepare(`
      UPDATE requests SET status = 'completed', completed_at = ? WHERE id = ?
    `).bind(now, deliverable.request_id).run();

    // Send callback
    if (deliverable.callback_url) {
      await sendCallback(deliverable.callback_url, {
        request_id: deliverable.request_id,
        status: 'completed',
        deliverable_id: body.deliverable_id,
        content_type: deliverable.content_type,
        content: deliverable.content || '',
        quality_score: deliverable.quality_score || 0,
        timestamp: now,
      });
    }

    return Response.json({
      success: true,
      deliverable_id: body.deliverable_id,
      status: 'delivered',
    });
  } catch (error) {
    console.error('Approve error:', error);
    return createErrorResponse(
      error instanceof Error ? error.message : 'Approval failed',
      'APPROVE_ERROR',
      requestId,
      500
    );
  }
}

/**
 * Manually reject a pending deliverable
 */
async function handleReject(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  try {
    const body = await request.json() as { deliverable_id: string; reason?: string };

    if (!body.deliverable_id) {
      return createErrorResponse('deliverable_id is required', 'MISSING_FIELD', requestId, 400);
    }

    const deliverable = await env.DB.prepare(`
      SELECT d.*, r.callback_url FROM deliverables d
      JOIN requests r ON d.request_id = r.id
      WHERE d.id = ?
    `).bind(body.deliverable_id).first<StoredDeliverable & { callback_url: string | null }>();

    if (!deliverable) {
      return createErrorResponse('Deliverable not found', 'NOT_FOUND', requestId, 404);
    }

    if (deliverable.status !== 'pending_review') {
      return createErrorResponse(`Cannot reject deliverable in ${deliverable.status} status`, 'INVALID_STATUS', requestId, 400);
    }

    const now = new Date().toISOString();
    const reason = body.reason || 'Manually rejected';

    // Update deliverable
    await env.DB.prepare(`
      UPDATE deliverables SET status = 'rejected', updated_at = ? WHERE id = ?
    `).bind(now, body.deliverable_id).run();

    // Notify Router and update request
    await notifyRouterCompletion(env, deliverable.request_id, false, reason);
    await env.DB.prepare(`
      UPDATE requests SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?
    `).bind(reason, now, deliverable.request_id).run();

    // Send callback
    if (deliverable.callback_url) {
      await sendCallback(deliverable.callback_url, {
        request_id: deliverable.request_id,
        status: 'failed',
        error: reason,
        timestamp: now,
      });
    }

    return Response.json({
      success: true,
      deliverable_id: body.deliverable_id,
      status: 'rejected',
    });
  } catch (error) {
    console.error('Reject error:', error);
    return createErrorResponse(
      error instanceof Error ? error.message : 'Rejection failed',
      'REJECT_ERROR',
      requestId,
      500
    );
  }
}

/**
 * Notify Request Router DO of completion
 */
async function notifyRouterCompletion(
  env: Env,
  requestId: string,
  success: boolean,
  error?: string
): Promise<void> {
  try {
    const routerId = env.REQUEST_ROUTER.idFromName('global-router');
    const router = env.REQUEST_ROUTER.get(routerId);

    await router.fetch('http://router/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_id: requestId,
        success,
        error,
      }),
    });
  } catch (e) {
    console.error('Failed to notify router:', e);
    // Don't throw - this is non-critical
  }
}

/**
 * Send callback to client app
 */
async function sendCallback(url: string, payload: CallbackPayload): Promise<void> {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('Failed to send callback:', e);
    // Don't throw - callback failures shouldn't block delivery
  }
}

/**
 * Transform provider-specific webhook payload to standard format
 */
function transformWebhookPayload(
  provider: string | null,
  body: Record<string, any>
): ProviderResponse {
  // Handle different provider webhook formats
  switch (provider?.toLowerCase()) {
    case 'ideogram':
      return {
        request_id: body.request_id || body.id || body.metadata?.request_id,
        success: body.status === 'success' || body.status === 'completed',
        content_type: 'image_url',
        content: body.image_url || body.output?.image_url || body.data?.url,
        raw_response: body,
        error: body.error || body.message,
        provider: 'ideogram',
      };

    case 'elevenlabs':
      return {
        request_id: body.request_id || body.xi_api_key,
        success: !!body.audio_url || !!body.output,
        content_type: 'audio_url',
        content: body.audio_url || body.output,
        raw_response: body,
        error: body.error,
        provider: 'elevenlabs',
      };

    case 'shotstack':
      return {
        request_id: body.id || body.request_id,
        success: body.status === 'done',
        content_type: 'video_url',
        content: body.url || body.output?.url,
        raw_response: body,
        error: body.error,
        provider: 'shotstack',
      };

    default:
      // Generic format - try common field names
      return {
        request_id: body.request_id || body.id || body.correlation_id,
        success: body.success !== false && !body.error,
        content_type: body.content_type || body.type || 'text',
        content: body.content || body.output || body.result || body.text,
        raw_response: body,
        error: body.error || body.message,
        provider: provider || 'unknown',
      };
  }
}

/**
 * Create error response
 */
function createErrorResponse(
  message: string,
  code: string,
  requestId: string,
  status: number
): Response {
  const errorResponse: ErrorResponse = {
    error: message,
    error_code: code,
    request_id: requestId,
  };

  return Response.json(errorResponse, {
    status,
    headers: { 'X-Request-ID': requestId },
  });
}

/**
 * CORS headers
 */
function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Provider, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * Add CORS headers to response
 */
function addCorsHeaders(response: Response): Response {
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('Access-Control-Allow-Origin', '*');
  newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, X-Provider, Authorization');
  return newResponse;
}
