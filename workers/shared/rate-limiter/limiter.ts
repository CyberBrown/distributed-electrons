/**
 * Rate Limiter Durable Object
 * Enforces per-instance, per-provider rate limits using rolling window algorithm
 */

import type { RateLimitConfig, RateLimitResult, RequestRecord } from './types';

export class RateLimiter implements DurableObject {
  private state: DurableObjectState;
  private requests: RequestRecord[] = [];

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  /**
   * Initialize the Durable Object
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/check' && request.method === 'POST') {
        const body = await request.json();
        const result = await this.checkLimit(body.config);
        return Response.json(result);
      }

      if (path === '/record' && request.method === 'POST') {
        const body = await request.json();
        await this.recordRequest(body.tokens || 0);
        return Response.json({ success: true });
      }

      if (path === '/reset' && request.method === 'POST') {
        await this.reset();
        return Response.json({ success: true });
      }

      if (path === '/stats' && request.method === 'GET') {
        const stats = await this.getStats();
        return Response.json(stats);
      }

      return new Response('Not Found', { status: 404 });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        { status: 500 }
      );
    }
  }

  /**
   * Check if request should be allowed based on rate limits
   */
  async checkLimit(config: RateLimitConfig): Promise<RateLimitResult> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Load requests from storage if not in memory
    if (this.requests.length === 0) {
      const stored = await this.state.storage.get<RequestRecord[]>('requests');
      this.requests = stored || [];
    }

    // Remove requests older than 1 minute (rolling window)
    this.requests = this.requests.filter((req) => req.timestamp > oneMinuteAgo);

    // Count requests and tokens in current window
    const requestCount = this.requests.length;
    const tokenCount = this.requests.reduce(
      (sum, req) => sum + (req.tokens || 0),
      0
    );

    // Check RPM (Requests Per Minute)
    if (requestCount >= config.rpm) {
      const oldestRequest = this.requests[0];
      const retryAfter = Math.ceil((oldestRequest.timestamp + 60000 - now) / 1000);

      return {
        allowed: false,
        retry_after: Math.max(retryAfter, 1),
        remaining: 0,
        reset: Math.floor((oldestRequest.timestamp + 60000) / 1000),
      };
    }

    // Check TPM (Tokens Per Minute) if configured
    if (config.tpm && tokenCount >= config.tpm) {
      const oldestRequest = this.requests[0];
      const retryAfter = Math.ceil((oldestRequest.timestamp + 60000 - now) / 1000);

      return {
        allowed: false,
        retry_after: Math.max(retryAfter, 1),
        remaining: 0,
        reset: Math.floor((oldestRequest.timestamp + 60000) / 1000),
      };
    }

    // Calculate reset time (when oldest request expires)
    const resetTime = this.requests.length > 0
      ? Math.floor((this.requests[0].timestamp + 60000) / 1000)
      : Math.floor((now + 60000) / 1000);

    return {
      allowed: true,
      remaining: config.rpm - requestCount,
      reset: resetTime,
    };
  }

  /**
   * Record a request in the rate limiter
   */
  async recordRequest(tokens: number = 0): Promise<{success: boolean}> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Add new request
    this.requests.push({
      timestamp: now,
      tokens,
    });

    // Clean old requests
    this.requests = this.requests.filter((req) => req.timestamp > oneMinuteAgo);

    // Persist to durable storage
    await this.state.storage.put('requests', this.requests);

    return { success: true };
  }

  /**
   * Reset all rate limit tracking
   */
  async reset(): Promise<void> {
    this.requests = [];
    await this.state.storage.delete('requests');
  }

  /**
   * Get current rate limit statistics
   */
  async getStats(): Promise<{
    total_requests: number;
    total_tokens: number;
    oldest_request: number | null;
    newest_request: number | null;
  }> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Clean old requests
    this.requests = this.requests.filter((req) => req.timestamp > oneMinuteAgo);

    return {
      total_requests: this.requests.length,
      total_tokens: this.requests.reduce((sum, req) => sum + (req.tokens || 0), 0),
      oldest_request: this.requests.length > 0 ? this.requests[0].timestamp : null,
      newest_request: this.requests.length > 0
        ? this.requests[this.requests.length - 1].timestamp
        : null,
    };
  }
}

// Export as module worker
export default {
  async fetch(request: Request, env: any): Promise<Response> {
    return new Response('Rate Limiter Worker - Use Durable Object bindings', { status: 200 });
  },
};
