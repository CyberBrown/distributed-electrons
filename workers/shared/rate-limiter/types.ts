/**
 * Rate Limiter Types
 */

export interface RateLimitConfig {
  rpm: number; // Requests per minute
  tpm?: number; // Tokens per minute (optional)
}

export interface RateLimitResult {
  allowed: boolean;
  retry_after?: number; // Seconds until next available slot
  remaining?: number; // Requests remaining in window
  reset?: number; // Unix timestamp when limit resets
}

export interface RequestRecord {
  timestamp: number;
  tokens?: number;
}
