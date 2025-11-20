/**
 * Instance Lookup Types
 *
 * Defines interfaces for instance configuration and lookup context.
 */

/**
 * Rate limit configuration for a specific provider
 */
export interface RateLimitConfig {
  rpm: number; // Requests per minute
  rpm_burst?: number; // Burst capacity
  daily?: number; // Daily request limit
}

/**
 * Complete instance configuration
 * Returned by the Config Service and cached in KV
 */
export interface InstanceConfig {
  instance_id: string;

  // API credentials for external providers
  api_keys: Record<string, string>; // { "ideogram": "key_123", "openai": "sk-..." }

  // Rate limits per provider
  rate_limits: Record<string, RateLimitConfig>; // { "ideogram": { rpm: 500, daily: 10000 } }

  // Worker URLs for routing
  worker_urls: Record<string, string>; // { "image_gen": "https://...", "text_gen": "https://..." }

  // R2 storage bucket name
  r2_bucket: string;

  // Optional metadata
  metadata?: {
    name?: string;
    description?: string;
    created_at?: string;
    updated_at?: string;
    owner?: string;
  };

  // Feature flags
  features?: Record<string, boolean>; // { "beta_features": true, "advanced_image_gen": false }
}

/**
 * Context provided for instance lookup
 * Contains all information needed to resolve an instance
 */
export interface LookupContext {
  // Authenticated user information
  user: {
    user_id: string;
    email?: string;
    roles?: string[];
    default_instance_id?: string;
  };

  // Optional instance identifier from request
  instance_id?: string; // From X-Instance-ID header

  // Optional project identifier from request body
  project_id?: string;

  // Optional tenant identifier
  tenant_id?: string;

  // Request metadata for logging/debugging
  request_metadata?: {
    ip?: string;
    user_agent?: string;
    request_id?: string;
  };
}

/**
 * Result of instance resolution
 * Includes the config and metadata about the lookup
 */
export interface LookupResult {
  config: InstanceConfig;
  source: 'cache' | 'service' | 'stale_cache'; // Where the config came from
  cached_at?: number; // Timestamp when cached
  ttl_remaining?: number; // Seconds until cache expires
}

/**
 * Cache entry stored in KV
 */
export interface CacheEntry {
  config: InstanceConfig;
  cached_at: number; // Unix timestamp in milliseconds
  ttl: number; // Time-to-live in seconds
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  hits: number;
  misses: number;
  stale_hits: number;
  evictions: number;
}

/**
 * Error types for instance lookup
 */
export enum LookupErrorType {
  INSTANCE_NOT_FOUND = 'INSTANCE_NOT_FOUND',
  ACCESS_DENIED = 'ACCESS_DENIED',
  CONFIG_SERVICE_UNAVAILABLE = 'CONFIG_SERVICE_UNAVAILABLE',
  INVALID_CONTEXT = 'INVALID_CONTEXT',
  CACHE_ERROR = 'CACHE_ERROR',
}

/**
 * Custom error class for lookup operations
 */
export class LookupError extends Error {
  constructor(
    public type: LookupErrorType,
    message: string,
    public statusCode: number,
    public details?: any
  ) {
    super(message);
    this.name = 'LookupError';
  }
}

/**
 * Configuration options for the instance resolver
 */
export interface ResolverOptions {
  cache_ttl?: number; // Cache TTL in seconds (default: 300 = 5 minutes)
  use_stale_on_error?: boolean; // Use stale cache if Config Service fails (default: true)
  config_service_url?: string; // URL of the Config Service
  config_service_timeout?: number; // Timeout in milliseconds (default: 5000)
}
