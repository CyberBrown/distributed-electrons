/**
 * Custom Error Classes and Error Codes for Cloudflare Multi-Agent System
 * Provides standardized error handling across all workers
 */

// Error code constants
export const ErrorCodes = {
  // Authentication errors (401)
  AUTH_FAILED: 'AUTH_FAILED',
  INVALID_API_KEY: 'INVALID_API_KEY',
  MISSING_AUTH: 'MISSING_AUTH',

  // Authorization errors (403)
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  INSTANCE_ACCESS_DENIED: 'INSTANCE_ACCESS_DENIED',

  // Not found errors (404)
  NOT_FOUND: 'NOT_FOUND',
  INSTANCE_NOT_FOUND: 'INSTANCE_NOT_FOUND',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',

  // Rate limiting (429)
  RATE_LIMITED: 'RATE_LIMITED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',

  // Client errors (400)
  BAD_REQUEST: 'BAD_REQUEST',
  INVALID_INPUT: 'INVALID_INPUT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',

  // Provider errors (502, 504)
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',

  // Internal errors (500, 503)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  DATABASE_ERROR: 'DATABASE_ERROR',
  STORAGE_ERROR: 'STORAGE_ERROR',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

/**
 * Base application error class
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, any>;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    code: ErrorCode,
    statusCode: number,
    details?: Record<string, any>,
    isOperational = true
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = isOperational;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Serialize error for logging (excludes stack trace)
   */
  toJSON(): Record<string, any> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      details: this.details,
      isOperational: this.isOperational,
    };
  }

  /**
   * Format error for API response
   */
  toResponse(requestId?: string): { error: string; error_code: string; details?: Record<string, any>; request_id?: string } {
    return {
      error: this.message,
      error_code: this.code,
      ...(this.details && { details: this.details }),
      ...(requestId && { request_id: requestId }),
    };
  }
}

/**
 * Authentication error (401)
 */
export class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed', details?: Record<string, any>) {
    super(message, ErrorCodes.AUTH_FAILED, 401, details);
  }
}

/**
 * Authorization error (403)
 */
export class AuthorizationError extends AppError {
  constructor(message = 'Access forbidden', details?: Record<string, any>) {
    super(message, ErrorCodes.FORBIDDEN, 403, details);
  }
}

/**
 * Not found error (404)
 */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details?: Record<string, any>) {
    super(message, ErrorCodes.NOT_FOUND, 404, details);
  }
}

/**
 * Rate limit error (429)
 */
export class RateLimitError extends AppError {
  public readonly retryAfter: number;

  constructor(
    message = 'Rate limit exceeded',
    retryAfter: number,
    details?: Record<string, any>
  ) {
    super(message, ErrorCodes.RATE_LIMITED, 429, {
      ...details,
      retry_after: retryAfter,
    });
    this.retryAfter = retryAfter;
  }

  toResponse(requestId?: string): { error: string; error_code: string; details?: Record<string, any>; request_id?: string; retry_after: number } {
    return {
      ...super.toResponse(requestId),
      retry_after: this.retryAfter,
    };
  }
}

/**
 * Validation error (400)
 */
export class ValidationError extends AppError {
  constructor(message = 'Invalid input', details?: Record<string, any>) {
    super(message, ErrorCodes.VALIDATION_ERROR, 400, details);
  }
}

/**
 * Provider error (502)
 */
export class ProviderError extends AppError {
  constructor(
    message = 'External provider error',
    provider?: string,
    details?: Record<string, any>
  ) {
    super(message, ErrorCodes.PROVIDER_ERROR, 502, {
      ...details,
      ...(provider && { provider }),
    });
  }
}

/**
 * Provider timeout error (504)
 */
export class ProviderTimeoutError extends AppError {
  constructor(
    message = 'Provider request timed out',
    provider?: string,
    details?: Record<string, any>
  ) {
    super(message, ErrorCodes.PROVIDER_TIMEOUT, 504, {
      ...details,
      ...(provider && { provider }),
    });
  }
}

/**
 * Internal server error (500)
 */
export class InternalError extends AppError {
  constructor(message = 'Internal server error', details?: Record<string, any>) {
    super(message, ErrorCodes.INTERNAL_ERROR, 500, details, false);
  }
}

/**
 * Database error (500)
 */
export class DatabaseError extends AppError {
  constructor(message = 'Database error', details?: Record<string, any>) {
    super(message, ErrorCodes.DATABASE_ERROR, 500, details, false);
  }
}

/**
 * Service unavailable error (503)
 */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable', details?: Record<string, any>) {
    super(message, ErrorCodes.SERVICE_UNAVAILABLE, 503, details);
  }
}

/**
 * Check if error is an operational error (expected, should not crash the service)
 */
export function isOperationalError(error: Error): boolean {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  return false;
}

/**
 * Serialize any error for logging
 */
export function serializeError(error: unknown): Record<string, any> {
  if (error instanceof AppError) {
    return error.toJSON();
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}
