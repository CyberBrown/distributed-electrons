import { describe, it, expect, vi } from 'vitest';
import {
  withErrorHandler,
  createErrorResponse,
  catchAsync,
  wrapAsync,
  shouldTerminate,
  formatErrorForClient,
  addRateLimitHeaders,
  createSuccessResponse,
} from '../../workers/shared/error-handling/middleware.js';
import {
  AuthenticationError,
  RateLimitError,
  InternalError,
  ValidationError,
  ErrorCodes,
} from '../../workers/shared/error-handling/errors.js';

describe('withErrorHandler', () => {
  it('should pass through successful responses', async () => {
    const handler = vi.fn().mockResolvedValue(new Response('Success', { status: 200 }));
    const wrapped = withErrorHandler(handler);

    const request = new Request('https://example.com');
    const ctx = {} as ExecutionContext;
    const response = await wrapped(request, {}, ctx);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Success');
  });

  it('should catch and format AppError', async () => {
    const handler = vi.fn().mockRejectedValue(
      new AuthenticationError('Invalid credentials')
    );
    const wrapped = withErrorHandler(handler);

    const request = new Request('https://example.com');
    const ctx = {} as ExecutionContext;
    const response = await wrapped(request, {}, ctx);

    expect(response.status).toBe(401);
    const body = await response.json() as Record<string, any>;
    expect(body.error).toBe('Invalid credentials');
    expect(body.error_code).toBe(ErrorCodes.AUTH_FAILED);
    expect(body.request_id).toBeDefined();
  });

  it('should catch and format standard Error', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('Unexpected error'));
    const wrapped = withErrorHandler(handler);

    const request = new Request('https://example.com');
    const ctx = {} as ExecutionContext;
    const response = await wrapped(request, {}, ctx);

    expect(response.status).toBe(500);
    const body = await response.json() as Record<string, any>;
    expect(body.error).toBe('Unexpected error');
    expect(body.error_code).toBe('INTERNAL_ERROR');
  });

  it('should use request X-Request-ID if provided', async () => {
    const handler = vi.fn().mockRejectedValue(new ValidationError('Bad input'));
    const wrapped = withErrorHandler(handler);

    const request = new Request('https://example.com', {
      headers: { 'X-Request-ID': 'custom-req-123' },
    });
    const ctx = {} as ExecutionContext;
    const response = await wrapped(request, {}, ctx);

    const body = await response.json() as Record<string, any>;
    expect(body.request_id).toBe('custom-req-123');
    expect(response.headers.get('X-Request-ID')).toBe('custom-req-123');
  });

  it('should log errors with logger if available', async () => {
    const logger = {
      error: vi.fn(),
    };
    const handler = vi.fn().mockRejectedValue(new Error('Test error'));
    const wrapped = withErrorHandler(handler);

    const request = new Request('https://example.com');
    const ctx = {} as ExecutionContext;
    await wrapped(request, { logger }, ctx);

    expect(logger.error).toHaveBeenCalledWith(
      'Request failed',
      expect.objectContaining({
        url: 'https://example.com/',
        method: 'GET',
        error: expect.any(Object),
      })
    );
  });

  it('should call onError callback if provided', async () => {
    const onError = vi.fn();
    const error = new Error('Test error');
    const handler = vi.fn().mockRejectedValue(error);
    const wrapped = withErrorHandler(handler, { onError });

    const request = new Request('https://example.com');
    const ctx = {} as ExecutionContext;
    await wrapped(request, {}, ctx);

    expect(onError).toHaveBeenCalledWith(error, request);
  });

  it('should include stack trace when includeStack is true', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('Test error'));
    const wrapped = withErrorHandler(handler, { includeStack: true });

    const request = new Request('https://example.com');
    const ctx = {} as ExecutionContext;
    const response = await wrapped(request, {}, ctx);

    const body = await response.json() as Record<string, any>;
    expect(body.details).toBeDefined();
    expect(body.details.stack).toBeDefined();
  });
});

describe('createErrorResponse', () => {
  it('should create response for AppError', () => {
    const error = new ValidationError('Invalid email', { field: 'email' });
    const response = createErrorResponse(error, 'req-123');

    expect(response.status).toBe(400);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('X-Request-ID')).toBe('req-123');
  });

  it('should create response for standard Error', () => {
    const error = new Error('Something broke');
    const response = createErrorResponse(error, 'req-456');

    expect(response.status).toBe(500);
    const body = response.json();
    expect(body).resolves.toHaveProperty('error');
    expect(body).resolves.toHaveProperty('error_code', 'INTERNAL_ERROR');
  });

  it('should add Retry-After header for rate limit errors', () => {
    const error = new RateLimitError('Too many requests', 120);
    const response = createErrorResponse(error, 'req-789');

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('120');
  });

  it('should handle non-Error values', () => {
    const response = createErrorResponse('string error');

    expect(response.status).toBe(500);
    const body = response.json();
    expect(body).resolves.toHaveProperty('error_code', 'UNKNOWN_ERROR');
  });

  it('should include stack trace when requested', () => {
    const error = new Error('Test error');
    const response = createErrorResponse(error, undefined, true);

    const body = response.json();
    expect(body).resolves.toHaveProperty('details');
  });
});

describe('catchAsync', () => {
  it('should return result on success', async () => {
    const promise = Promise.resolve('success');
    const [error, result] = await catchAsync(promise);

    expect(error).toBeNull();
    expect(result).toBe('success');
  });

  it('should return error on failure', async () => {
    const promise = Promise.reject(new Error('Failed'));
    const [error, result] = await catchAsync(promise);

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('Failed');
    expect(result).toBeNull();
  });

  it('should call error handler on failure', async () => {
    const errorHandler = vi.fn();
    const promise = Promise.reject(new Error('Failed'));
    await catchAsync(promise, errorHandler);

    expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
  });

  it('should convert non-Error rejections to Error', async () => {
    const promise = Promise.reject('string error');
    const [error, _result] = await catchAsync(promise);

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('string error');
  });
});

describe('wrapAsync', () => {
  it('should return result on success', async () => {
    const fn = wrapAsync(async () => 'success');
    const result = await fn();

    expect(result).toBe('success');
  });

  it('should throw error on failure', async () => {
    const fn = wrapAsync(async () => {
      throw new Error('Failed');
    });

    await expect(fn()).rejects.toThrow('Failed');
  });

  it('should call error handler on failure', async () => {
    const errorHandler = vi.fn();
    const fn = wrapAsync(async () => {
      throw new Error('Failed');
    }, errorHandler);

    try {
      await fn();
    } catch (e) {
      // Expected
    }

    expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
  });

  it('should preserve function arguments', async () => {
    const fn = wrapAsync(async (a: number, b: number) => a + b);
    const result = await fn(2, 3);

    expect(result).toBe(5);
  });
});

describe('shouldTerminate', () => {
  it('should return false for operational errors', () => {
    expect(shouldTerminate(new AuthenticationError())).toBe(false);
    expect(shouldTerminate(new ValidationError())).toBe(false);
    expect(shouldTerminate(new RateLimitError('', 60))).toBe(false);
  });

  it('should return true for non-operational errors', () => {
    expect(shouldTerminate(new InternalError())).toBe(true);
    expect(shouldTerminate(new Error('Unknown'))).toBe(true);
  });
});

describe('formatErrorForClient', () => {
  it('should format AppError for client', () => {
    const error = new ValidationError('Invalid input');
    const formatted = formatErrorForClient(error);

    expect(formatted.message).toBe('Invalid input');
    expect(formatted.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('should hide internal error details', () => {
    const error = new Error('Internal database connection failed');
    const formatted = formatErrorForClient(error);

    expect(formatted.message).toBe('An unexpected error occurred');
    expect(formatted.code).toBe('INTERNAL_ERROR');
  });

  it('should handle non-Error values', () => {
    const formatted = formatErrorForClient('some error');

    expect(formatted.message).toBe('An unexpected error occurred');
    expect(formatted.code).toBe('INTERNAL_ERROR');
  });
});

describe('addRateLimitHeaders', () => {
  it('should add rate limit headers to response', () => {
    const response = new Response('OK');
    const resetTime = Math.floor(Date.now() / 1000) + 60;
    const modifiedResponse = addRateLimitHeaders(response, 100, resetTime);

    expect(modifiedResponse.headers.get('X-RateLimit-Remaining')).toBe('100');
    expect(modifiedResponse.headers.get('X-RateLimit-Reset')).toBe(String(resetTime));
  });

  it('should preserve existing headers', () => {
    const response = new Response('OK', {
      headers: { 'Content-Type': 'text/plain' },
    });
    const resetTime = Math.floor(Date.now() / 1000) + 60;
    const modifiedResponse = addRateLimitHeaders(response, 50, resetTime);

    expect(modifiedResponse.headers.get('Content-Type')).toBe('text/plain');
    expect(modifiedResponse.headers.get('X-RateLimit-Remaining')).toBe('50');
  });
});

describe('createSuccessResponse', () => {
  it('should create JSON response with data', async () => {
    const data = { message: 'Success', value: 42 };
    const response = createSuccessResponse(data);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(await response.json() as Record<string, any>).toEqual(data);
  });

  it('should include request ID if provided', () => {
    const response = createSuccessResponse({ ok: true }, 'req-123');

    expect(response.headers.get('X-Request-ID')).toBe('req-123');
  });

  it('should use custom status code', () => {
    const response = createSuccessResponse({ created: true }, undefined, 201);

    expect(response.status).toBe(201);
  });

  it('should handle arrays and nested objects', async () => {
    const data = {
      items: [{ id: 1 }, { id: 2 }],
      meta: { total: 2 },
    };
    const response = createSuccessResponse(data);

    expect(await response.json() as Record<string, any>).toEqual(data);
  });
});
