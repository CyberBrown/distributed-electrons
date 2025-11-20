/**
 * Retry Logic with Exponential Backoff and Circuit Breaker
 * Handles transient failures and prevents cascading failures
 */

import { ProviderError, ProviderTimeoutError } from './errors.js';

export interface RetryOptions {
  maxAttempts: number;
  initialDelay: number; // milliseconds
  maxDelay: number; // milliseconds
  backoffMultiplier?: number; // default 2
  shouldRetry?: (error: Error) => boolean;
  onRetry?: (error: Error, attempt: number) => void;
}

/**
 * Execute a function with exponential backoff retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const {
    maxAttempts,
    initialDelay,
    maxDelay,
    backoffMultiplier = 2,
    shouldRetry = defaultShouldRetry,
    onRetry,
  } = options;

  let lastError: Error;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if this is the last attempt
      if (attempt === maxAttempts) {
        break;
      }

      // Check if we should retry this error
      if (!shouldRetry(lastError)) {
        throw lastError;
      }

      // Call retry callback if provided
      if (onRetry) {
        onRetry(lastError, attempt);
      }

      // Wait before retrying
      await sleep(delay);

      // Increase delay for next attempt (exponential backoff)
      delay = Math.min(delay * backoffMultiplier, maxDelay);
    }
  }

  throw lastError!;
}

/**
 * Execute a function with timeout
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  timeoutError?: Error
): Promise<T> {
  return Promise.race([
    fn(),
    sleep(timeoutMs).then(() => {
      throw timeoutError || new ProviderTimeoutError(`Operation timed out after ${timeoutMs}ms`);
    }),
  ]);
}

/**
 * Default retry logic: retry on network errors and 5xx errors, not on 4xx errors
 */
function defaultShouldRetry(error: Error): boolean {
  // Don't retry client errors (4xx)
  if ('statusCode' in error) {
    const statusCode = (error as any).statusCode;
    if (statusCode >= 400 && statusCode < 500) {
      // Exception: retry on 429 (rate limit)
      return statusCode === 429;
    }
  }

  // Retry on network errors
  if (error.message.includes('fetch') || error.message.includes('network')) {
    return true;
  }

  // Retry on timeout errors
  if (error instanceof ProviderTimeoutError) {
    return true;
  }

  // Retry on 5xx errors
  if (error instanceof ProviderError) {
    return true;
  }

  return false;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Circuit Breaker Implementation

export interface CircuitBreakerOptions {
  failureThreshold: number; // Number of failures before opening circuit
  resetTimeout: number; // Milliseconds to wait before trying again
  monitoringPeriod: number; // Milliseconds to track failures
}

export enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation
  OPEN = 'OPEN', // Circuit is open, rejecting requests
  HALF_OPEN = 'HALF_OPEN', // Testing if service recovered
}

/**
 * Circuit Breaker to prevent cascading failures
 * Tracks failures per provider and opens circuit when threshold is exceeded
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number[] = []; // Timestamps of failures
  private nextAttemptTime = 0;
  private successCount = 0;

  constructor(private options: CircuitBreakerOptions) {}

  /**
   * Execute function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check circuit state
    if (this.state === CircuitState.OPEN) {
      // Check if we should try again
      if (Date.now() < this.nextAttemptTime) {
        throw new ProviderError('Circuit breaker is open', undefined, {
          state: this.state,
          retry_after: Math.ceil((this.nextAttemptTime - Date.now()) / 1000),
        });
      }
      // Move to half-open to test
      this.state = CircuitState.HALF_OPEN;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      // Require 2 successes to close circuit
      if (this.successCount >= 2) {
        this.state = CircuitState.CLOSED;
        this.failures = [];
        this.successCount = 0;
      }
    } else {
      this.failures = [];
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(): void {
    const now = Date.now();
    this.failures.push(now);

    // Remove old failures outside monitoring period
    const cutoff = now - this.options.monitoringPeriod;
    this.failures = this.failures.filter((t) => t > cutoff);

    // Check if we should open circuit
    if (this.failures.length >= this.options.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = now + this.options.resetTimeout;
      this.successCount = 0;
    } else if (this.state === CircuitState.HALF_OPEN) {
      // Failed while half-open, go back to open
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = now + this.options.resetTimeout;
      this.successCount = 0;
    }
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit statistics
   */
  getStats(): {
    state: CircuitState;
    failures: number;
    nextAttemptTime: number;
  } {
    return {
      state: this.state,
      failures: this.failures.length,
      nextAttemptTime: this.nextAttemptTime,
    };
  }

  /**
   * Manually reset circuit
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = [];
    this.nextAttemptTime = 0;
    this.successCount = 0;
  }
}

/**
 * Circuit Breaker Registry - manages circuit breakers per provider
 */
export class CircuitBreakerRegistry {
  private breakers = new Map<string, CircuitBreaker>();
  private defaultOptions: CircuitBreakerOptions = {
    failureThreshold: 5,
    resetTimeout: 60000, // 1 minute
    monitoringPeriod: 120000, // 2 minutes
  };

  /**
   * Get or create circuit breaker for a provider
   */
  getBreaker(provider: string, options?: CircuitBreakerOptions): CircuitBreaker {
    if (!this.breakers.has(provider)) {
      this.breakers.set(
        provider,
        new CircuitBreaker(options || this.defaultOptions)
      );
    }
    return this.breakers.get(provider)!;
  }

  /**
   * Execute with circuit breaker for specific provider
   */
  async executeWithBreaker<T>(
    provider: string,
    fn: () => Promise<T>,
    options?: CircuitBreakerOptions
  ): Promise<T> {
    const breaker = this.getBreaker(provider, options);
    return breaker.execute(fn);
  }

  /**
   * Get all circuit breaker states
   */
  getAllStates(): Record<string, { state: CircuitState; failures: number }> {
    const states: Record<string, { state: CircuitState; failures: number }> = {};
    for (const [provider, breaker] of this.breakers.entries()) {
      const stats = breaker.getStats();
      states[provider] = {
        state: stats.state,
        failures: stats.failures,
      };
    }
    return states;
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }
}

// Global circuit breaker registry
export const globalCircuitBreakers = new CircuitBreakerRegistry();
