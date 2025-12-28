/**
 * QA Wrapper for LLM Responses
 * Validates JSON output and retries with repair prompts if needed
 */

import {
  validateJson,
  buildRepairPrompt,
  attemptJsonRepair,
} from './json-validator';

export interface QAOptions {
  /** Whether to validate and ensure JSON output */
  expectJson?: boolean;
  /** Maximum number of retry attempts (default: 2) */
  maxRetries?: number;
  /** Whether to attempt automatic repair before retry (default: true) */
  attemptRepair?: boolean;
}

export interface QAResult {
  /** The validated/processed response */
  response: string;
  /** Number of attempts made */
  attempts: number;
  /** Whether validation was required and passed */
  validated: boolean;
  /** If automatic repair was applied */
  repaired: boolean;
}

/**
 * Type for the generation function that will be wrapped
 */
export type GenerateFn = (prompt: string) => Promise<string>;

/**
 * Wraps an LLM generation function with JSON validation and retry logic
 *
 * @param generateFn - The function that generates LLM responses
 * @param prompt - The original prompt to send
 * @param options - QA options
 * @returns The validated response or throws on failure
 */
export async function withJsonQA(
  generateFn: GenerateFn,
  prompt: string,
  options: QAOptions = {}
): Promise<QAResult> {
  const { expectJson = false, maxRetries = 2, attemptRepair = true } = options;

  // If not expecting JSON, just pass through
  if (!expectJson) {
    const response = await generateFn(prompt);
    return {
      response,
      attempts: 1,
      validated: false,
      repaired: false,
    };
  }

  let lastResponse = '';
  let lastError = '';
  let attempts = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts++;

    // Build the prompt - use repair prompt on retries
    const currentPrompt =
      attempt === 0
        ? prompt
        : buildRepairPrompt(prompt, lastResponse, lastError);

    // Generate response
    lastResponse = await generateFn(currentPrompt);

    // Validate the JSON
    const validation = validateJson(lastResponse);

    if (validation.valid) {
      console.log(
        `[JSON QA] Validated successfully on attempt ${attempt + 1}/${maxRetries + 1}`
      );
      return {
        response: validation.extracted!,
        attempts,
        validated: true,
        repaired: false,
      };
    }

    // Try automatic repair before asking LLM to retry
    if (attemptRepair && attempt < maxRetries) {
      const repaired = attemptJsonRepair(lastResponse);
      if (repaired) {
        console.log(
          `[JSON QA] Auto-repaired JSON on attempt ${attempt + 1}/${maxRetries + 1}`
        );
        return {
          response: repaired,
          attempts,
          validated: true,
          repaired: true,
        };
      }
    }

    // Store error for next retry prompt
    lastError = validation.error || 'Unknown JSON parsing error';
    console.warn(
      `[JSON QA] Validation failed (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError}`
    );
  }

  // All retries exhausted - throw with detailed error
  throw new JsonValidationError(
    `JSON validation failed after ${attempts} attempts. Last error: ${lastError}`,
    lastResponse,
    lastError,
    attempts
  );
}

/**
 * Custom error class for JSON validation failures
 */
export class JsonValidationError extends Error {
  constructor(
    message: string,
    public readonly lastResponse: string,
    public readonly lastParseError: string,
    public readonly attempts: number
  ) {
    super(message);
    this.name = 'JsonValidationError';
  }

  /**
   * Get a truncated version of the invalid response for logging
   */
  getTruncatedResponse(maxLength: number = 500): string {
    if (this.lastResponse.length <= maxLength) {
      return this.lastResponse;
    }
    return this.lastResponse.slice(0, maxLength) + '... [truncated]';
  }

  /**
   * Convert to a structured error object for API responses
   */
  toErrorObject(): Record<string, unknown> {
    return {
      error: 'JSON_VALIDATION_FAILED',
      message: this.message,
      details: {
        attempts: this.attempts,
        last_parse_error: this.lastParseError,
        last_response_preview: this.getTruncatedResponse(200),
      },
    };
  }
}

/**
 * Helper to check if an error is a JsonValidationError
 */
export function isJsonValidationError(
  error: unknown
): error is JsonValidationError {
  return error instanceof JsonValidationError;
}
