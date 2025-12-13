/**
 * Intake Worker
 * Entry point for all async requests to the DE platform
 *
 * Responsibilities:
 * - Accept requests from client apps
 * - Validate and enrich request data
 * - Store request in D1 database
 * - Notify Request Router DO
 * - Return request ID for tracking
 */

import type { Env, IntakePayload, IntakeResponse, ErrorResponse, StoredRequest } from './types';

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
      if (url.pathname === '/intake' && request.method === 'POST') {
        const response = await handleIntake(request, env, requestId);
        return addCorsHeaders(response);
      }

      if (url.pathname === '/status' && request.method === 'GET') {
        const id = url.searchParams.get('request_id');
        if (!id) {
          return addCorsHeaders(createErrorResponse('request_id parameter required', 'MISSING_PARAM', requestId, 400));
        }
        const response = await handleStatus(id, env, requestId);
        return addCorsHeaders(response);
      }

      if (url.pathname === '/cancel' && request.method === 'POST') {
        const response = await handleCancel(request, env, requestId);
        return addCorsHeaders(response);
      }

      if (url.pathname === '/health' && request.method === 'GET') {
        return addCorsHeaders(Response.json({
          status: 'healthy',
          service: 'intake',
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
 * Handle intake request - main entry point for async processing
 */
async function handleIntake(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  try {
    // Parse request body
    const body: IntakePayload = await request.json();

    // Validate required fields
    if (!body.query || body.query.trim() === '') {
      return createErrorResponse('Query is required', 'MISSING_QUERY', requestId, 400);
    }

    // Extract app_id (required for tracking)
    const appId = body.app_id || request.headers.get('X-App-ID') || 'anonymous';

    // Extract instance_id
    const instanceId = body.instance_id ||
      request.headers.get('X-Instance-ID') ||
      env.DEFAULT_INSTANCE_ID ||
      null;

    const now = new Date().toISOString();

    // Store request in D1 database
    const storedRequest: StoredRequest = {
      id: requestId,
      app_id: appId,
      instance_id: instanceId,
      query: body.query.trim(),
      metadata: body.metadata ? JSON.stringify(body.metadata) : null,
      task_type: body.task_type || null,
      provider: body.provider || null,
      model: body.model || null,
      status: 'pending',
      priority: body.priority || 0,
      queue_position: null,
      retry_count: 0,
      max_retries: 3,
      error_message: null,
      callback_url: body.callback_url || null,
      created_at: now,
      queued_at: null,
      started_at: null,
      completed_at: null,
    };

    // Insert into D1
    await env.DB.prepare(`
      INSERT INTO requests (
        id, app_id, instance_id, query, metadata, task_type,
        provider, model, status, priority, queue_position,
        retry_count, max_retries, error_message, callback_url,
        created_at, queued_at, started_at, completed_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `).bind(
      storedRequest.id,
      storedRequest.app_id,
      storedRequest.instance_id,
      storedRequest.query,
      storedRequest.metadata,
      storedRequest.task_type,
      storedRequest.provider,
      storedRequest.model,
      storedRequest.status,
      storedRequest.priority,
      storedRequest.queue_position,
      storedRequest.retry_count,
      storedRequest.max_retries,
      storedRequest.error_message,
      storedRequest.callback_url,
      storedRequest.created_at,
      storedRequest.queued_at,
      storedRequest.started_at,
      storedRequest.completed_at
    ).run();

    // Notify Request Router DO
    const routerId = env.REQUEST_ROUTER.idFromName('global-router');
    const router = env.REQUEST_ROUTER.get(routerId);

    const routerResponse = await router.fetch('http://router/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: requestId,
        app_id: appId,
        instance_id: instanceId,
        query: body.query.trim(),
        metadata: body.metadata,
        task_type: body.task_type,
        provider: body.provider,
        model: body.model,
        priority: body.priority || 0,
        callback_url: body.callback_url,
        created_at: now,
      }),
    });

    const routerResult = await routerResponse.json() as any;

    if (!routerResult.success) {
      // Update D1 with error
      await env.DB.prepare(`
        UPDATE requests SET status = 'failed', error_message = ? WHERE id = ?
      `).bind(routerResult.error || 'Router submission failed', requestId).run();

      return createErrorResponse(
        routerResult.error || 'Failed to submit to router',
        'ROUTER_ERROR',
        requestId,
        500
      );
    }

    // Update D1 with queue info
    await env.DB.prepare(`
      UPDATE requests SET status = 'queued', queue_position = ?, queued_at = ? WHERE id = ?
    `).bind(routerResult.queue_position, now, requestId).run();

    // Return success response
    const response: IntakeResponse = {
      success: true,
      request_id: requestId,
      status: 'queued',
      queue_position: routerResult.queue_position,
      estimated_wait_ms: routerResult.estimated_wait_ms,
    };

    return Response.json(response, {
      status: 202, // Accepted
      headers: { 'X-Request-ID': requestId },
    });
  } catch (error) {
    console.error('Intake error:', error);

    // Check for JSON parse error
    if (error instanceof SyntaxError) {
      return createErrorResponse('Invalid JSON body', 'INVALID_JSON', requestId, 400);
    }

    return createErrorResponse(
      error instanceof Error ? error.message : 'Intake processing failed',
      'INTAKE_ERROR',
      requestId,
      500
    );
  }
}

/**
 * Handle status check request
 */
async function handleStatus(
  id: string,
  env: Env,
  requestId: string
): Promise<Response> {
  try {
    // Query D1 for request status
    const result = await env.DB.prepare(`
      SELECT id, app_id, status, queue_position, task_type, provider, model,
             error_message, created_at, queued_at, started_at, completed_at
      FROM requests WHERE id = ?
    `).bind(id).first<StoredRequest>();

    if (!result) {
      return createErrorResponse('Request not found', 'NOT_FOUND', requestId, 404);
    }

    // Also check Router DO for live queue position
    let liveQueuePosition = result.queue_position;
    if (result.status === 'queued') {
      try {
        const routerId = env.REQUEST_ROUTER.idFromName('global-router');
        const router = env.REQUEST_ROUTER.get(routerId);
        const routerResponse = await router.fetch(`http://router/status?request_id=${id}`);
        const routerResult = await routerResponse.json() as any;
        if (routerResult.success && routerResult.queue_position !== undefined) {
          liveQueuePosition = routerResult.queue_position;
        }
      } catch {
        // Use D1 value if router unavailable
      }
    }

    return Response.json({
      success: true,
      request_id: result.id,
      app_id: result.app_id,
      status: result.status,
      queue_position: liveQueuePosition,
      task_type: result.task_type,
      provider: result.provider,
      model: result.model,
      error_message: result.error_message,
      created_at: result.created_at,
      queued_at: result.queued_at,
      started_at: result.started_at,
      completed_at: result.completed_at,
    }, {
      headers: { 'X-Request-ID': requestId },
    });
  } catch (error) {
    console.error('Status check error:', error);
    return createErrorResponse(
      error instanceof Error ? error.message : 'Status check failed',
      'STATUS_ERROR',
      requestId,
      500
    );
  }
}

/**
 * Handle cancel request
 */
async function handleCancel(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  try {
    const body = await request.json() as { request_id: string };

    if (!body.request_id) {
      return createErrorResponse('request_id is required', 'MISSING_PARAM', requestId, 400);
    }

    // Check if request exists and is cancellable
    const existing = await env.DB.prepare(`
      SELECT id, status FROM requests WHERE id = ?
    `).bind(body.request_id).first<{ id: string; status: string }>();

    if (!existing) {
      return createErrorResponse('Request not found', 'NOT_FOUND', requestId, 404);
    }

    if (existing.status === 'completed' || existing.status === 'processing') {
      return createErrorResponse(
        `Cannot cancel request in ${existing.status} status`,
        'INVALID_STATUS',
        requestId,
        400
      );
    }

    // Cancel in Router DO
    const routerId = env.REQUEST_ROUTER.idFromName('global-router');
    const router = env.REQUEST_ROUTER.get(routerId);

    await router.fetch('http://router/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: body.request_id }),
    });

    // Update D1
    await env.DB.prepare(`
      UPDATE requests SET status = 'cancelled', completed_at = ? WHERE id = ?
    `).bind(new Date().toISOString(), body.request_id).run();

    return Response.json({
      success: true,
      request_id: body.request_id,
      status: 'cancelled',
    }, {
      headers: { 'X-Request-ID': requestId },
    });
  } catch (error) {
    console.error('Cancel error:', error);
    return createErrorResponse(
      error instanceof Error ? error.message : 'Cancel failed',
      'CANCEL_ERROR',
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
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-App-ID, X-Instance-ID, Authorization',
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
  newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, X-App-ID, X-Instance-ID, Authorization');
  return newResponse;
}
