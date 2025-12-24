/**
 * Shared HTTP Utilities for Cloudflare Workers
 *
 * Provides CORS handling and standardized response helpers.
 * Use this module instead of duplicating these functions in each worker.
 */

/**
 * Standard error response format
 */
export interface ErrorResponseBody {
  error: string;
  error_code: string;
  request_id: string;
  details?: Record<string, unknown>;
}

/**
 * Add CORS headers to a response
 *
 * Enables cross-origin requests from any origin.
 * Used for all public API endpoints.
 */
export function addCorsHeaders(response: Response): Response {
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('Access-Control-Allow-Origin', '*');
  newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, X-Instance-ID, X-Request-ID, Authorization');
  return newResponse;
}

/**
 * Handle CORS preflight OPTIONS request
 *
 * Returns a 204 No Content response with CORS headers.
 */
export function handleCorsPrelight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Instance-ID, X-Request-ID, Authorization',
      'Access-Control-Max-Age': '86400', // 24 hours
    },
  });
}

/**
 * Create a standardized error response
 *
 * @param message - Human-readable error message
 * @param code - Machine-readable error code (e.g., 'INVALID_REQUEST')
 * @param requestId - Request tracking ID
 * @param status - HTTP status code (default: 500)
 * @param details - Optional additional details
 */
export function createErrorResponse(
  message: string,
  code: string,
  requestId: string,
  status: number = 500,
  details?: Record<string, unknown>
): Response {
  const body: ErrorResponseBody = {
    error: message,
    error_code: code,
    request_id: requestId,
  };

  if (details) {
    body.details = details;
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
    },
  });
}

/**
 * Create a standardized success response
 *
 * @param data - Response payload
 * @param requestId - Request tracking ID
 * @param status - HTTP status code (default: 200)
 */
export function createSuccessResponse(
  data: unknown,
  requestId: string,
  status: number = 200
): Response {
  const body = {
    ...((typeof data === 'object' && data !== null) ? data : { data }),
    request_id: requestId,
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
    },
  });
}

/**
 * Create a JSON response with custom headers
 */
export function createJsonResponse(
  data: unknown,
  status: number = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Extract request ID from headers or generate new one
 */
export function getRequestId(request: Request): string {
  return request.headers.get('X-Request-ID') || generateRequestId();
}
