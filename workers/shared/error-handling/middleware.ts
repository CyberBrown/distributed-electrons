/**
 * Error Handling Middleware for Cloudflare Workers
 * Provides global error handling and consistent error responses
 */

import { AppError, serializeError, isOperationalError } from './errors.js';

/**
 * Environment interface for error handling
 */
export interface ErrorHandlerEnv {
  // Optional logger for error logging
  logger?: {
    error: (message: string, metadata?: Record<string, any>) => void;
  };
}

/**
 * Error response format
 */
interface ErrorResponse {
  error: string;
  error_code: string;
  request_id?: string;
  details?: Record<string, any>;
}

/**
 * Global error handler middleware
 * Wraps worker handlers to catch and format errors consistently
 */
export function withErrorHandler(
  handler: (request: Request, env: any, ctx: ExecutionContext) => Promise<Response>,
  options?: {
    includeStack?: boolean;
    onError?: (error: Error, request: Request) => void;
  }
) {
  return async (
    request: Request,
    env: any,
    ctx: ExecutionContext
  ): Promise<Response> => {
    try {
      return await handler(request, env, ctx);
    } catch (error) {
      // Get request ID if available
      const requestId = request.headers.get('X-Request-ID') || crypto.randomUUID();

      // Log error
      const errorObj = error instanceof Error ? error : new Error(String(error));
      const serialized = serializeError(errorObj);

      if (env.logger) {
        env.logger.error('Request failed', {
          request_id: requestId,
          url: request.url,
          method: request.method,
          error: serialized,
        });
      } else {
        // Fallback to console.error if no logger
        console.error('Request failed:', {
          request_id: requestId,
          url: request.url,
          error: serialized,
        });
      }

      // Call custom error handler if provided
      if (options?.onError) {
        options.onError(errorObj, request);
      }

      // Return error response
      return createErrorResponse(errorObj, requestId, options?.includeStack);
    }
  };
}

/**
 * Create standardized error response
 */
export function createErrorResponse(
  error: unknown,
  requestId?: string,
  includeStack = false
): Response {
  let statusCode = 500;
  let errorResponse: ErrorResponse;

  if (error instanceof AppError) {
    statusCode = error.statusCode;
    errorResponse = error.toResponse(requestId);
  } else if (error instanceof Error) {
    errorResponse = {
      error: error.message || 'Internal server error',
      error_code: 'INTERNAL_ERROR',
      ...(requestId && { request_id: requestId }),
    };

    // Include stack trace in development
    if (includeStack && error.stack) {
      errorResponse.details = {
        stack: error.stack,
      };
    }
  } else {
    errorResponse = {
      error: 'Unknown error occurred',
      error_code: 'UNKNOWN_ERROR',
      ...(requestId && { request_id: requestId }),
    };
  }

  // Add special headers for certain error types
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (requestId) {
    headers['X-Request-ID'] = requestId;
  }

  // Add Retry-After header for rate limit errors
  if (error instanceof AppError && error.code === 'RATE_LIMITED' && error.details?.retry_after) {
    headers['Retry-After'] = String(error.details.retry_after);
  }

  return new Response(JSON.stringify(errorResponse), {
    status: statusCode,
    headers,
  });
}

/**
 * Async error handler for catching errors in promise chains
 */
export async function catchAsync<T>(
  promise: Promise<T>,
  errorHandler?: (error: Error) => void
): Promise<[Error | null, T | null]> {
  try {
    const result = await promise;
    return [null, result];
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (errorHandler) {
      errorHandler(err);
    }
    return [err, null];
  }
}

/**
 * Wrap async function to handle errors
 */
export function wrapAsync<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  errorHandler?: (error: Error) => void
): T {
  return (async (...args: any[]) => {
    try {
      return await fn(...args);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (errorHandler) {
        errorHandler(err);
      }
      throw err;
    }
  }) as T;
}

/**
 * Check if error should crash the service
 * Operational errors are expected and should not crash
 */
export function shouldTerminate(error: Error): boolean {
  return !isOperationalError(error);
}

/**
 * Format error for client response (safe, no sensitive info)
 */
export function formatErrorForClient(error: unknown): {
  message: string;
  code: string;
} {
  if (error instanceof AppError) {
    return {
      message: error.message,
      code: error.code,
    };
  }

  // Don't expose internal error details to clients
  return {
    message: 'An unexpected error occurred',
    code: 'INTERNAL_ERROR',
  };
}

/**
 * Add rate limit headers to response
 */
export function addRateLimitHeaders(
  response: Response,
  remaining: number,
  resetTime: number
): Response {
  const headers = new Headers(response.headers);
  headers.set('X-RateLimit-Remaining', String(remaining));
  headers.set('X-RateLimit-Reset', String(resetTime));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Create a successful JSON response with request ID
 */
export function createSuccessResponse(
  data: any,
  requestId?: string,
  status = 200
): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (requestId) {
    headers['X-Request-ID'] = requestId;
  }

  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}
