/**
 * Stock Media Worker
 * Searches for stock videos and images using Pexels API
 */

import type {
  Env,
  SearchRequest,
  SearchResponse,
  MediaItem,
  ErrorResponse,
} from './types';

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
      if (url.pathname === '/search' && request.method === 'POST') {
        const response = await handleSearch(request, env, requestId);
        return addCorsHeaders(response);
      }

      if (url.pathname === '/search/videos' && request.method === 'POST') {
        const response = await handleVideoSearch(request, env, requestId);
        return addCorsHeaders(response);
      }

      if (url.pathname === '/search/photos' && request.method === 'POST') {
        const response = await handlePhotoSearch(request, env, requestId);
        return addCorsHeaders(response);
      }

      if (url.pathname === '/health' && request.method === 'GET') {
        return addCorsHeaders(Response.json({
          status: 'healthy',
          service: 'stock-media',
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

function addCorsHeaders(response: Response): Response {
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('Access-Control-Allow-Origin', '*');
  newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');
  return newResponse;
}

async function handleSearch(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  const startTime = Date.now();

  try {
    const body: SearchRequest = await request.json();

    if (!body.keywords || body.keywords.length === 0) {
      return createErrorResponse(
        'Keywords are required',
        'INVALID_REQUEST',
        requestId,
        400
      );
    }

    const apiKey = env.PEXELS_API_KEY;
    if (!apiKey) {
      return createErrorResponse(
        'Pexels API key not configured',
        'MISSING_API_KEY',
        requestId,
        500
      );
    }

    const query = body.keywords.join(' ');
    const perPage = body.options?.per_page || 10;
    const page = body.options?.page || 1;

    // Search both videos and photos in parallel
    const [videosResult, photosResult] = await Promise.all([
      searchPexelsVideos(query, perPage, page, body, apiKey),
      searchPexelsPhotos(query, perPage, page, body, apiKey),
    ]);

    // Combine and sort by relevance (interleave videos and photos)
    const combinedMedia: MediaItem[] = [];
    const maxLen = Math.max(videosResult.length, photosResult.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < videosResult.length) combinedMedia.push(videosResult[i]);
      if (i < photosResult.length) combinedMedia.push(photosResult[i]);
    }

    const searchTime = Date.now() - startTime;

    const response: SearchResponse = {
      success: true,
      media: combinedMedia.slice(0, perPage * 2),
      total_results: combinedMedia.length,
      page,
      per_page: perPage * 2,
      metadata: {
        provider: 'pexels',
        query,
        search_time_ms: searchTime,
      },
      request_id: requestId,
      timestamp: new Date().toISOString(),
    };

    return Response.json(response, {
      headers: { 'X-Request-ID': requestId },
    });
  } catch (error) {
    console.error('Search error:', error);
    return createErrorResponse(
      error instanceof Error ? error.message : 'Search failed',
      'SEARCH_ERROR',
      requestId,
      500
    );
  }
}

async function handleVideoSearch(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  const startTime = Date.now();

  try {
    const body: SearchRequest = await request.json();

    if (!body.keywords || body.keywords.length === 0) {
      return createErrorResponse(
        'Keywords are required',
        'INVALID_REQUEST',
        requestId,
        400
      );
    }

    const apiKey = env.PEXELS_API_KEY;
    if (!apiKey) {
      return createErrorResponse(
        'Pexels API key not configured',
        'MISSING_API_KEY',
        requestId,
        500
      );
    }

    const query = body.keywords.join(' ');
    const perPage = body.options?.per_page || 15;
    const page = body.options?.page || 1;

    const media = await searchPexelsVideos(query, perPage, page, body, apiKey);
    const searchTime = Date.now() - startTime;

    const response: SearchResponse = {
      success: true,
      media,
      total_results: media.length,
      page,
      per_page: perPage,
      metadata: {
        provider: 'pexels',
        query,
        search_time_ms: searchTime,
      },
      request_id: requestId,
      timestamp: new Date().toISOString(),
    };

    return Response.json(response, {
      headers: { 'X-Request-ID': requestId },
    });
  } catch (error) {
    console.error('Video search error:', error);
    return createErrorResponse(
      error instanceof Error ? error.message : 'Video search failed',
      'SEARCH_ERROR',
      requestId,
      500
    );
  }
}

async function handlePhotoSearch(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  const startTime = Date.now();

  try {
    const body: SearchRequest = await request.json();

    if (!body.keywords || body.keywords.length === 0) {
      return createErrorResponse(
        'Keywords are required',
        'INVALID_REQUEST',
        requestId,
        400
      );
    }

    const apiKey = env.PEXELS_API_KEY;
    if (!apiKey) {
      return createErrorResponse(
        'Pexels API key not configured',
        'MISSING_API_KEY',
        requestId,
        500
      );
    }

    const query = body.keywords.join(' ');
    const perPage = body.options?.per_page || 15;
    const page = body.options?.page || 1;

    const media = await searchPexelsPhotos(query, perPage, page, body, apiKey);
    const searchTime = Date.now() - startTime;

    const response: SearchResponse = {
      success: true,
      media,
      total_results: media.length,
      page,
      per_page: perPage,
      metadata: {
        provider: 'pexels',
        query,
        search_time_ms: searchTime,
      },
      request_id: requestId,
      timestamp: new Date().toISOString(),
    };

    return Response.json(response, {
      headers: { 'X-Request-ID': requestId },
    });
  } catch (error) {
    console.error('Photo search error:', error);
    return createErrorResponse(
      error instanceof Error ? error.message : 'Photo search failed',
      'SEARCH_ERROR',
      requestId,
      500
    );
  }
}

async function searchPexelsVideos(
  query: string,
  perPage: number,
  page: number,
  options: SearchRequest,
  apiKey: string
): Promise<MediaItem[]> {
  const params = new URLSearchParams({
    query,
    per_page: String(perPage),
    page: String(page),
  });

  if (options.orientation) params.set('orientation', options.orientation);
  if (options.size) params.set('size', options.size);

  const response = await fetch(
    `https://api.pexels.com/videos/search?${params}`,
    {
      headers: { Authorization: apiKey },
    }
  );

  if (!response.ok) {
    throw new Error(`Pexels API error: ${response.status}`);
  }

  const data = await response.json() as any;

  return data.videos.map((video: any) => {
    // Find best quality video file
    const videoFile = video.video_files.find((f: any) => f.quality === 'hd') ||
                      video.video_files[0];

    return {
      id: String(video.id),
      type: 'video' as const,
      url: videoFile.link,
      preview_url: video.image,
      duration: video.duration,
      width: videoFile.width,
      height: videoFile.height,
      provider: 'pexels',
      photographer: video.user.name,
      photographer_url: video.user.url,
    };
  });
}

async function searchPexelsPhotos(
  query: string,
  perPage: number,
  page: number,
  options: SearchRequest,
  apiKey: string
): Promise<MediaItem[]> {
  const params = new URLSearchParams({
    query,
    per_page: String(perPage),
    page: String(page),
  });

  if (options.orientation) params.set('orientation', options.orientation);
  if (options.size) params.set('size', options.size);

  const response = await fetch(
    `https://api.pexels.com/v1/search?${params}`,
    {
      headers: { Authorization: apiKey },
    }
  );

  if (!response.ok) {
    throw new Error(`Pexels API error: ${response.status}`);
  }

  const data = await response.json() as any;

  return data.photos.map((photo: any) => ({
    id: String(photo.id),
    type: 'image' as const,
    url: photo.src.original,
    preview_url: photo.src.medium,
    width: photo.width,
    height: photo.height,
    provider: 'pexels',
    photographer: photo.photographer,
    photographer_url: photo.photographer_url,
  }));
}

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
    headers: { 'X-Request-ID': requestId },
  });
}
