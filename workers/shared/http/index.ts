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

/**
 * Retry options for fetchWithRetry
 */
export interface FetchRetryOptions {
  maxRetries?: number;      // Default: 3
  initialDelayMs?: number;  // Default: 1000 (1 second)
  maxDelayMs?: number;      // Default: 10000 (10 seconds)
  backoffMultiplier?: number; // Default: 2
  retryOn5xx?: boolean;     // Default: true
  retryOnNetworkError?: boolean; // Default: true
}

/**
 * Fetch with automatic retry on transient failures
 *
 * Retries on:
 * - 5xx server errors (configurable)
 * - Network errors (configurable)
 * - 429 rate limit errors (with Retry-After header)
 *
 * Does NOT retry on:
 * - 4xx client errors (except 429)
 * - Successful responses
 */
export async function fetchWithRetry(
  url: string | URL,
  init?: RequestInit,
  options: FetchRetryOptions = {}
): Promise<Response> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    backoffMultiplier = 2,
    retryOn5xx = true,
    retryOnNetworkError = true,
  } = options;

  let lastError: Error | null = null;
  let delay = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, init);

      // Success - return immediately
      if (response.ok) {
        return response;
      }

      // Rate limited - retry with Retry-After if available
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        if (retryAfter && attempt < maxRetries) {
          const retryDelayMs = parseInt(retryAfter, 10) * 1000 || delay;
          console.log(`[fetchWithRetry] Rate limited, retrying after ${retryDelayMs}ms`);
          await sleep(Math.min(retryDelayMs, maxDelayMs));
          delay = Math.min(delay * backoffMultiplier, maxDelayMs);
          continue;
        }
      }

      // 5xx server error - retry if configured
      if (retryOn5xx && response.status >= 500 && attempt < maxRetries) {
        console.log(`[fetchWithRetry] Server error ${response.status}, attempt ${attempt + 1}/${maxRetries + 1}`);
        await sleep(delay);
        delay = Math.min(delay * backoffMultiplier, maxDelayMs);
        continue;
      }

      // 4xx client error or non-retryable - return as-is
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Network error - retry if configured
      if (retryOnNetworkError && attempt < maxRetries) {
        console.log(`[fetchWithRetry] Network error, attempt ${attempt + 1}/${maxRetries + 1}: ${lastError.message}`);
        await sleep(delay);
        delay = Math.min(delay * backoffMultiplier, maxDelayMs);
        continue;
      }

      throw lastError;
    }
  }

  // Should not reach here, but just in case
  throw lastError || new Error('fetchWithRetry exhausted all retries');
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
