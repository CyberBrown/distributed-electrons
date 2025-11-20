import { ErrorResponse, SuccessResponse } from './types';

/**
 * Generate a unique request ID for tracing
 */
export function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Create a standardized JSON response
 */
export function jsonResponse<T>(
  data: T | ErrorResponse,
  status: number = 200,
  requestId?: string
): Response {
  const body = 'error' in data
    ? data
    : { data, request_id: requestId || generateRequestId() };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Create an error response
 */
export function errorResponse(
  message: string,
  status: number = 500,
  requestId?: string
): Response {
  const error: ErrorResponse = {
    error: message,
    request_id: requestId || generateRequestId(),
    status,
  };
  return jsonResponse(error, status);
}

/**
 * Create a success response
 */
export function successResponse<T>(
  data: T,
  requestId?: string
): Response {
  return jsonResponse(data, 200, requestId);
}

/**
 * Parse JSON body safely
 */
export async function parseJsonBody<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch (error) {
    throw new Error('Invalid JSON body');
  }
}

/**
 * Validate required fields in an object
 */
export function validateRequiredFields(
  obj: any,
  fields: string[]
): { valid: boolean; missing?: string[] } {
  const missing = fields.filter(field => !obj[field]);

  if (missing.length > 0) {
    return { valid: false, missing };
  }

  return { valid: true };
}
