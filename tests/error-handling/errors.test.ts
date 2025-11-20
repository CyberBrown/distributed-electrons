import { describe, it, expect } from 'vitest';
import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  RateLimitError,
  ValidationError,
  ProviderError,
  ProviderTimeoutError,
  InternalError,
  DatabaseError,
  ServiceUnavailableError,
  ErrorCodes,
  isOperationalError,
  serializeError,
} from '../../workers/shared/error-handling/errors.js';

describe('AppError', () => {
  it('should create an error with all properties', () => {
    const error = new AppError(
      'Test error',
      ErrorCodes.INTERNAL_ERROR,
      500,
      { foo: 'bar' }
    );

    expect(error.message).toBe('Test error');
    expect(error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    expect(error.statusCode).toBe(500);
    expect(error.details).toEqual({ foo: 'bar' });
    expect(error.isOperational).toBe(true);
  });

  it('should serialize to JSON without stack trace', () => {
    const error = new AppError('Test error', ErrorCodes.INTERNAL_ERROR, 500);
    const json = error.toJSON();

    expect(json).toHaveProperty('name');
    expect(json).toHaveProperty('message');
    expect(json).toHaveProperty('code');
    expect(json).toHaveProperty('statusCode');
    expect(json).not.toHaveProperty('stack');
  });

  it('should format for API response', () => {
    const error = new AppError(
      'Test error',
      ErrorCodes.INTERNAL_ERROR,
      500,
      { foo: 'bar' }
    );
    const response = error.toResponse('req-123');

    expect(response).toEqual({
      error: 'Test error',
      error_code: ErrorCodes.INTERNAL_ERROR,
      details: { foo: 'bar' },
      request_id: 'req-123',
    });
  });
});

describe('AuthenticationError', () => {
  it('should create 401 error', () => {
    const error = new AuthenticationError('Invalid credentials');

    expect(error.statusCode).toBe(401);
    expect(error.code).toBe(ErrorCodes.AUTH_FAILED);
    expect(error.message).toBe('Invalid credentials');
  });

  it('should use default message', () => {
    const error = new AuthenticationError();

    expect(error.message).toBe('Authentication failed');
  });
});

describe('AuthorizationError', () => {
  it('should create 403 error', () => {
    const error = new AuthorizationError('No permission');

    expect(error.statusCode).toBe(403);
    expect(error.code).toBe(ErrorCodes.FORBIDDEN);
  });
});

describe('NotFoundError', () => {
  it('should create 404 error', () => {
    const error = new NotFoundError('User not found');

    expect(error.statusCode).toBe(404);
    expect(error.code).toBe(ErrorCodes.NOT_FOUND);
  });
});

describe('RateLimitError', () => {
  it('should create 429 error with retry_after', () => {
    const error = new RateLimitError('Too many requests', 60);

    expect(error.statusCode).toBe(429);
    expect(error.code).toBe(ErrorCodes.RATE_LIMITED);
    expect(error.retryAfter).toBe(60);
  });

  it('should include retry_after in response', () => {
    const error = new RateLimitError('Too many requests', 120);
    const response = error.toResponse('req-123');

    expect(response.retry_after).toBe(120);
  });

  it('should include retry_after in details', () => {
    const error = new RateLimitError('Too many requests', 60, { provider: 'ideogram' });

    expect(error.details?.retry_after).toBe(60);
    expect(error.details?.provider).toBe('ideogram');
  });
});

describe('ValidationError', () => {
  it('should create 400 error', () => {
    const error = new ValidationError('Missing field', { field: 'email' });

    expect(error.statusCode).toBe(400);
    expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(error.details).toEqual({ field: 'email' });
  });
});

describe('ProviderError', () => {
  it('should create 502 error', () => {
    const error = new ProviderError('API failed', 'ideogram');

    expect(error.statusCode).toBe(502);
    expect(error.code).toBe(ErrorCodes.PROVIDER_ERROR);
    expect(error.details?.provider).toBe('ideogram');
  });
});

describe('ProviderTimeoutError', () => {
  it('should create 504 error', () => {
    const error = new ProviderTimeoutError('Request timed out', 'ideogram');

    expect(error.statusCode).toBe(504);
    expect(error.code).toBe(ErrorCodes.PROVIDER_TIMEOUT);
    expect(error.details?.provider).toBe('ideogram');
  });
});

describe('InternalError', () => {
  it('should create 500 error and be non-operational', () => {
    const error = new InternalError('Unexpected error');

    expect(error.statusCode).toBe(500);
    expect(error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    expect(error.isOperational).toBe(false);
  });
});

describe('DatabaseError', () => {
  it('should create 500 error and be non-operational', () => {
    const error = new DatabaseError('Connection failed');

    expect(error.statusCode).toBe(500);
    expect(error.code).toBe(ErrorCodes.DATABASE_ERROR);
    expect(error.isOperational).toBe(false);
  });
});

describe('ServiceUnavailableError', () => {
  it('should create 503 error', () => {
    const error = new ServiceUnavailableError('Maintenance mode');

    expect(error.statusCode).toBe(503);
    expect(error.code).toBe(ErrorCodes.SERVICE_UNAVAILABLE);
  });
});

describe('isOperationalError', () => {
  it('should return true for operational errors', () => {
    expect(isOperationalError(new AuthenticationError())).toBe(true);
    expect(isOperationalError(new ValidationError())).toBe(true);
    expect(isOperationalError(new NotFoundError())).toBe(true);
  });

  it('should return false for non-operational errors', () => {
    expect(isOperationalError(new InternalError())).toBe(false);
    expect(isOperationalError(new DatabaseError())).toBe(false);
  });

  it('should return false for standard Error', () => {
    expect(isOperationalError(new Error('test'))).toBe(false);
  });
});

describe('serializeError', () => {
  it('should serialize AppError', () => {
    const error = new ValidationError('Invalid input');
    const serialized = serializeError(error);

    expect(serialized).toHaveProperty('name');
    expect(serialized).toHaveProperty('message');
    expect(serialized).toHaveProperty('code');
    expect(serialized.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('should serialize standard Error', () => {
    const error = new Error('Standard error');
    const serialized = serializeError(error);

    expect(serialized.name).toBe('Error');
    expect(serialized.message).toBe('Standard error');
    expect(serialized).toHaveProperty('stack');
  });

  it('should serialize non-Error values', () => {
    const serialized = serializeError('string error');

    expect(serialized.message).toBe('string error');
  });

  it('should serialize null/undefined', () => {
    expect(serializeError(null).message).toBe('null');
    expect(serializeError(undefined).message).toBe('undefined');
  });
});

describe('ErrorCodes', () => {
  it('should have all required error codes', () => {
    expect(ErrorCodes.AUTH_FAILED).toBe('AUTH_FAILED');
    expect(ErrorCodes.RATE_LIMITED).toBe('RATE_LIMITED');
    expect(ErrorCodes.PROVIDER_ERROR).toBe('PROVIDER_ERROR');
    expect(ErrorCodes.PROVIDER_TIMEOUT).toBe('PROVIDER_TIMEOUT');
    expect(ErrorCodes.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
    expect(ErrorCodes.NOT_FOUND).toBe('NOT_FOUND');
    expect(ErrorCodes.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
  });
});
