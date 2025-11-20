/**
 * Rate Limiter Client
 * Client library for workers to interact with Rate Limiter Durable Object
 */

import type { RateLimitConfig, RateLimitResult } from './types';

export interface RateLimiterEnv {
  RATE_LIMITER: DurableObjectNamespace;
}

/**
 * Generate a Durable Object ID for an instance+provider combination
 */
export function getRateLimiterId(
  instanceId: string,
  provider: string
): string {
  return `instance:${instanceId}:provider:${provider}`;
}

/**
 * Rate Limiter Client Class
 */
export class RateLimiterClient {
  private env: RateLimiterEnv;

  constructor(env: RateLimiterEnv) {
    this.env = env;
  }

  /**
   * Get Durable Object stub for a specific instance+provider
   */
  private getStub(instanceId: string, provider: string): DurableObjectStub {
    const id = this.env.RATE_LIMITER.idFromName(
      getRateLimiterId(instanceId, provider)
    );
    return this.env.RATE_LIMITER.get(id);
  }

  /**
   * Check if a request is allowed under the rate limit
   */
  async checkLimit(
    instanceId: string,
    provider: string,
    config: RateLimitConfig
  ): Promise<RateLimitResult> {
    const stub = this.getStub(instanceId, provider);
    const response = await stub.fetch('http://limiter/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    });

    if (!response.ok) {
      throw new Error(`Rate limiter error: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Record a request in the rate limiter
   */
  async recordRequest(
    instanceId: string,
    provider: string,
    tokens: number = 0
  ): Promise<void> {
    const stub = this.getStub(instanceId, provider);
    const response = await stub.fetch('http://limiter/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokens }),
    });

    if (!response.ok) {
      throw new Error(`Failed to record request: ${response.statusText}`);
    }
  }

  /**
   * Reset rate limit tracking for an instance+provider
   */
  async reset(instanceId: string, provider: string): Promise<void> {
    const stub = this.getStub(instanceId, provider);
    const response = await stub.fetch('http://limiter/reset', {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`Failed to reset rate limiter: ${response.statusText}`);
    }
  }

  /**
   * Get rate limit statistics
   */
  async getStats(instanceId: string, provider: string): Promise<any> {
    const stub = this.getStub(instanceId, provider);
    const response = await stub.fetch('http://limiter/stats', {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`Failed to get stats: ${response.statusText}`);
    }

    return await response.json();
  }
}

/**
 * Helper function to check and record in one call
 */
export async function checkAndRecordRequest(
  env: RateLimiterEnv,
  instanceId: string,
  provider: string,
  config: RateLimitConfig,
  tokens: number = 0
): Promise<RateLimitResult> {
  const client = new RateLimiterClient(env);

  // Check if allowed
  const result = await client.checkLimit(instanceId, provider, config);

  // If allowed, record the request
  if (result.allowed) {
    await client.recordRequest(instanceId, provider, tokens);
  }

  return result;
}
