import { describe, it, expect, vi } from 'vitest';
import {
  withRetry,
  withTimeout,
  CircuitBreaker,
  CircuitState,
  CircuitBreakerRegistry,
} from '../../workers/shared/error-handling/retry.js';
import { ProviderError, ProviderTimeoutError } from '../../workers/shared/error-handling/errors.js';

describe('withRetry', () => {
  it('should succeed on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const result = await withRetry(fn, {
      maxAttempts: 3,
      initialDelay: 10,
      maxDelay: 100,
    });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and eventually succeed', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('Fail 1'))
      .mockRejectedValueOnce(new ProviderError('Fail 2'))
      .mockResolvedValue('success');

    const result = await withRetry(fn, {
      maxAttempts: 3,
      initialDelay: 10,
      maxDelay: 100,
    });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should throw error after max attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new ProviderError('Always fails'));

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        initialDelay: 10,
        maxDelay: 100,
      })
    ).rejects.toThrow('Always fails');

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should use exponential backoff', async () => {
    const fn = vi.fn().mockRejectedValue(new ProviderError('Fail'));
    const retryAttempts: number[] = [];

    await expect(
      withRetry(fn, {
        maxAttempts: 4,
        initialDelay: 5,
        maxDelay: 100,
        backoffMultiplier: 2,
        onRetry: (_error, attempt) => {
          retryAttempts.push(attempt);
        },
      })
    ).rejects.toThrow('Fail');

    // Should have retried 3 times (attempts 1, 2, 3)
    expect(retryAttempts).toEqual([1, 2, 3]);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('should respect max delay', async () => {
    const fn = vi.fn().mockRejectedValue(new ProviderError('Fail'));

    await expect(
      withRetry(fn, {
        maxAttempts: 5,
        initialDelay: 10,
        maxDelay: 20,
        backoffMultiplier: 2,
      })
    ).rejects.toThrow('Fail');

    expect(fn).toHaveBeenCalledTimes(5);
  });

  it('should call onRetry callback', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('Fail'))
      .mockResolvedValue('success');
    const onRetry = vi.fn();

    await withRetry(fn, {
      maxAttempts: 3,
      initialDelay: 10,
      maxDelay: 100,
      onRetry,
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1);
  });

  it('should not retry on 4xx errors except 429', async () => {
    const error = new Error('Client error');
    (error as any).statusCode = 400;

    const fn = vi.fn().mockRejectedValue(error);

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        initialDelay: 10,
        maxDelay: 100,
      })
    ).rejects.toThrow('Client error');

    expect(fn).toHaveBeenCalledTimes(1); // No retry
  });

  it('should retry on 429 rate limit', async () => {
    const error = new Error('Rate limited');
    (error as any).statusCode = 429;

    const fn = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue('success');

    const result = await withRetry(fn, {
      maxAttempts: 3,
      initialDelay: 10,
      maxDelay: 100,
    });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should retry on provider errors', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('Provider failed'))
      .mockResolvedValue('success');

    const result = await withRetry(fn, {
      maxAttempts: 3,
      initialDelay: 10,
      maxDelay: 100,
    });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should use custom shouldRetry function', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Custom error'));
    const shouldRetry = vi.fn().mockReturnValue(false);

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        initialDelay: 10,
        maxDelay: 100,
        shouldRetry,
      })
    ).rejects.toThrow('Custom error');

    expect(fn).toHaveBeenCalledTimes(1); // No retry
    expect(shouldRetry).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('withTimeout', () => {
  it('should succeed before timeout', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const result = await withTimeout(fn, 1000);

    expect(result).toBe('success');
  });

  it('should timeout if function takes too long', async () => {
    const fn = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );

    await expect(withTimeout(fn, 50)).rejects.toThrow('Operation timed out after 50ms');
  });

  it('should use custom timeout error', async () => {
    const fn = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );
    const timeoutError = new ProviderTimeoutError('Custom timeout');

    await expect(withTimeout(fn, 50, timeoutError)).rejects.toThrow('Custom timeout');
  });
});

describe('CircuitBreaker', () => {
  it('should start in CLOSED state', () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 100,
      monitoringPeriod: 200,
    });

    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it('should open circuit after threshold failures', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 100,
      monitoringPeriod: 200,
    });

    const fn = vi.fn().mockRejectedValue(new Error('Fail'));

    // Fail 3 times
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(fn);
      } catch (e) {
        // Expected
      }
    }

    expect(breaker.getState()).toBe(CircuitState.OPEN);
  });

  it('should reject immediately when circuit is open', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeout: 100,
      monitoringPeriod: 200,
    });

    const fn = vi.fn().mockRejectedValue(new Error('Fail'));

    // Fail 2 times to open circuit
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(fn);
      } catch (e) {
        // Expected
      }
    }

    expect(breaker.getState()).toBe(CircuitState.OPEN);

    // Next call should be rejected immediately
    await expect(breaker.execute(fn)).rejects.toThrow('Circuit breaker is open');
    expect(fn).toHaveBeenCalledTimes(2); // Not called again
  });

  it('should transition to HALF_OPEN after reset timeout', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeout: 50,
      monitoringPeriod: 100,
    });

    const fn = vi.fn().mockRejectedValue(new Error('Fail'));

    // Open circuit
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(fn);
      } catch (e) {
        // Expected
      }
    }

    expect(breaker.getState()).toBe(CircuitState.OPEN);

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Next call should transition to HALF_OPEN
    const successFn = vi.fn().mockResolvedValue('success');
    await breaker.execute(successFn);

    // Should be HALF_OPEN (requires 2 successes to close)
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
  });

  it('should close circuit after 2 successes in HALF_OPEN', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeout: 50,
      monitoringPeriod: 100,
    });

    // Open circuit
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(() => Promise.reject(new Error('Fail')));
      } catch (e) {
        // Expected
      }
    }

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 60));

    // First success -> HALF_OPEN
    await breaker.execute(() => Promise.resolve('success'));
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

    // Second success -> CLOSED
    await breaker.execute(() => Promise.resolve('success'));
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it('should reopen circuit if failure occurs in HALF_OPEN', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeout: 50,
      monitoringPeriod: 100,
    });

    // Open circuit
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(() => Promise.reject(new Error('Fail')));
      } catch (e) {
        // Expected
      }
    }

    // Wait and transition to HALF_OPEN
    await new Promise((resolve) => setTimeout(resolve, 60));
    await breaker.execute(() => Promise.resolve('success'));
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

    // Fail in HALF_OPEN
    try {
      await breaker.execute(() => Promise.reject(new Error('Fail again')));
    } catch (e) {
      // Expected
    }

    // Should be OPEN again
    expect(breaker.getState()).toBe(CircuitState.OPEN);
  });

  it('should provide circuit stats', () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 100,
      monitoringPeriod: 200,
    });

    const stats = breaker.getStats();

    expect(stats).toHaveProperty('state');
    expect(stats).toHaveProperty('failures');
    expect(stats).toHaveProperty('nextAttemptTime');
    expect(stats.state).toBe(CircuitState.CLOSED);
    expect(stats.failures).toBe(0);
  });

  it('should reset circuit manually', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeout: 100,
      monitoringPeriod: 200,
    });

    // Open circuit
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(() => Promise.reject(new Error('Fail')));
      } catch (e) {
        // Expected
      }
    }

    expect(breaker.getState()).toBe(CircuitState.OPEN);

    // Manual reset
    breaker.reset();

    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    expect(breaker.getStats().failures).toBe(0);
  });
});

describe('CircuitBreakerRegistry', () => {
  it('should create and retrieve circuit breakers per provider', () => {
    const registry = new CircuitBreakerRegistry();

    const breaker1 = registry.getBreaker('ideogram');
    const breaker2 = registry.getBreaker('ideogram');
    const breaker3 = registry.getBreaker('openai');

    expect(breaker1).toBe(breaker2); // Same instance
    expect(breaker1).not.toBe(breaker3); // Different provider
  });

  it('should execute with circuit breaker', async () => {
    const registry = new CircuitBreakerRegistry();
    const fn = vi.fn().mockResolvedValue('success');

    const result = await registry.executeWithBreaker('ideogram', fn);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should get all circuit states', async () => {
    const registry = new CircuitBreakerRegistry();

    // Create some breakers by accessing them
    registry.getBreaker('ideogram');
    registry.getBreaker('openai');

    const states = registry.getAllStates();

    expect(states).toHaveProperty('ideogram');
    expect(states).toHaveProperty('openai');
    expect(states.ideogram.state).toBe(CircuitState.CLOSED);
    expect(states.openai.state).toBe(CircuitState.CLOSED);
  });

  it('should reset all circuit breakers', async () => {
    const registry = new CircuitBreakerRegistry();

    // Open some circuits
    const breaker1 = registry.getBreaker('ideogram', {
      failureThreshold: 1,
      resetTimeout: 5000,
      monitoringPeriod: 10000,
    });

    try {
      await breaker1.execute(() => Promise.reject(new Error('Fail')));
    } catch (e) {
      // Expected
    }

    expect(breaker1.getState()).toBe(CircuitState.OPEN);

    // Reset all
    registry.resetAll();

    expect(breaker1.getState()).toBe(CircuitState.CLOSED);
  });
});
