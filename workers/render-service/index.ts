/**
 * Render Service Worker
 * Renders videos using Shotstack API
 */

import type {
  Env,
  RenderRequest,
  RenderResponse,
  RenderStatusResponse,
  Timeline,
} from './types';
import {
  addCorsHeaders,
  createErrorResponse,
  handleCorsPrelight,
  fetchWithRetry,
} from '../shared/http';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID();

    try {
      const url = new URL(request.url);

      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return handleCorsPrelight();
      }

      // Route handling
      if (url.pathname === '/render' && request.method === 'POST') {
        const response = await handleRender(request, env, requestId);
        return addCorsHeaders(response);
      }

      if (url.pathname.startsWith('/render/') && request.method === 'GET') {
        const renderId = url.pathname.split('/')[2];
        const response = await handleGetStatus(renderId, env, requestId);
        return addCorsHeaders(response);
      }

      if (url.pathname === '/health' && request.method === 'GET') {
        return addCorsHeaders(Response.json({
          status: 'healthy',
          service: 'render-service',
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

// addCorsHeaders imported from shared/http

async function handleRender(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  try {
    const body: RenderRequest = await request.json();

    // Validate request
    if (!body.timeline || !body.timeline.tracks || body.timeline.tracks.length === 0) {
      return createErrorResponse(
        'Timeline with tracks is required',
        'INVALID_REQUEST',
        requestId,
        400
      );
    }

    const apiKey = env.SHOTSTACK_API_KEY;
    if (!apiKey) {
      return createErrorResponse(
        'Shotstack API key not configured',
        'MISSING_API_KEY',
        requestId,
        500
      );
    }

    const shotstackEnv = env.SHOTSTACK_ENV || 'v1';

    // Convert our timeline format to Shotstack format
    const shotstackTimeline = convertToShotstackFormat(body.timeline);

    // Submit render job
    const renderResult = await submitShotstackRender(
      shotstackTimeline,
      body.output || {},
      apiKey,
      shotstackEnv
    );

    const response: RenderResponse = {
      success: true,
      render_id: renderResult.id,
      status: 'queued',
      metadata: {
        provider: 'shotstack',
        format: body.output?.format || 'mp4',
        resolution: body.output?.resolution || 'hd',
      },
      request_id: requestId,
      timestamp: new Date().toISOString(),
    };

    return Response.json(response, {
      headers: { 'X-Request-ID': requestId },
    });
  } catch (error) {
    console.error('Render error:', error);

    if (error instanceof Error) {
      if (error.message.includes('429')) {
        return createErrorResponse(
          'Shotstack rate limit exceeded',
          'PROVIDER_RATE_LIMIT',
          requestId,
          429
        );
      }
      if (error.message.includes('401') || error.message.includes('403')) {
        return createErrorResponse(
          'Invalid Shotstack API key',
          'INVALID_API_KEY',
          requestId,
          401
        );
      }
    }

    return createErrorResponse(
      error instanceof Error ? error.message : 'Render failed',
      'RENDER_ERROR',
      requestId,
      500
    );
  }
}

async function handleGetStatus(
  renderId: string,
  env: Env,
  requestId: string
): Promise<Response> {
  try {
    if (!renderId) {
      return createErrorResponse(
        'Render ID is required',
        'INVALID_REQUEST',
        requestId,
        400
      );
    }

    const apiKey = env.SHOTSTACK_API_KEY;
    if (!apiKey) {
      return createErrorResponse(
        'Shotstack API key not configured',
        'MISSING_API_KEY',
        requestId,
        500
      );
    }

    const shotstackEnv = env.SHOTSTACK_ENV || 'v1';
    const status = await getShotstackStatus(renderId, apiKey, shotstackEnv);

    const response: RenderStatusResponse = {
      success: true,
      render_id: renderId,
      status: mapShotstackStatus(status.status),
      progress: status.progress,
      url: status.url,
      error: status.error,
      request_id: requestId,
      timestamp: new Date().toISOString(),
    };

    return Response.json(response, {
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

function convertToShotstackFormat(timeline: Timeline): any {
  return {
    soundtrack: timeline.soundtrack,
    tracks: timeline.tracks.map(track => ({
      clips: track.clips.map(clip => ({
        asset: clip.asset,
        start: clip.start,
        length: clip.length,
        fit: clip.fit || 'crop',
        scale: clip.scale,
        position: clip.position || 'center',
        offset: clip.offset,
        transition: clip.transition,
        effect: clip.effect,
        filter: clip.filter,
        opacity: clip.opacity,
      })),
    })),
  };
}

async function submitShotstackRender(
  timeline: any,
  output: any,
  apiKey: string,
  shotstackEnv: string
): Promise<{ id: string }> {
  const baseUrl = shotstackEnv === 'stage'
    ? 'https://api.shotstack.io/stage'
    : 'https://api.shotstack.io/v1';

  const response = await fetchWithRetry(
    `${baseUrl}/render`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        timeline,
        output: {
          format: output.format || 'mp4',
          resolution: output.resolution || 'hd',
          fps: output.fps || 25,
          quality: output.quality || 'high',
        },
      }),
    },
    { maxRetries: 2, initialDelayMs: 1000 }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Shotstack API error (${response.status}): ${error}`);
  }

  const data = await response.json() as any;
  return { id: data.response.id };
}

async function getShotstackStatus(
  renderId: string,
  apiKey: string,
  shotstackEnv: string
): Promise<{ status: string; progress?: number; url?: string; error?: string }> {
  const baseUrl = shotstackEnv === 'stage'
    ? 'https://api.shotstack.io/stage'
    : 'https://api.shotstack.io/v1';

  const response = await fetchWithRetry(
    `${baseUrl}/render/${renderId}`,
    { headers: { 'x-api-key': apiKey } },
    { maxRetries: 2, initialDelayMs: 1000 }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Shotstack API error (${response.status}): ${error}`);
  }

  const data = await response.json() as any;
  const render = data.response;

  return {
    status: render.status,
    progress: render.progress ? Math.round(render.progress * 100) : undefined,
    url: render.url,
    error: render.error,
  };
}

function mapShotstackStatus(status: string): RenderStatusResponse['status'] {
  const statusMap: Record<string, RenderStatusResponse['status']> = {
    queued: 'queued',
    fetching: 'fetching',
    rendering: 'rendering',
    saving: 'saving',
    done: 'done',
    failed: 'failed',
  };
  return statusMap[status] || 'queued';
}

// createErrorResponse imported from shared/http
