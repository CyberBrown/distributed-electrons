/**
 * Config Cache - Shared caching layer for config service lookups
 *
 * Uses a two-tier caching strategy:
 * 1. In-memory cache (per-isolate, fastest)
 * 2. Cloudflare Cache API (cross-isolate, HTTP response caching)
 *
 * This eliminates per-request config service calls.
 */

export interface ModelConfig {
  model_id: string;
  display_name: string;
  provider_id: string;
  capabilities: {
    text?: boolean;
    image?: boolean;
    audio?: boolean;
    video?: boolean;
  };
  payload_mapping?: Record<string, unknown>;
  rate_limits?: {
    rpm: number;
    tpm: number;
  };
  [key: string]: unknown;
}

export interface InstanceConfig {
  instance_id: string;
  org_id: string;
  api_keys: Record<string, string>;
  rate_limits: Record<string, { rpm: number; tpm: number }>;
  r2_bucket?: string;
  [key: string]: unknown;
}

interface CacheEntry<T> {
  data: T;
  expires_at: number;
}

// In-memory cache - persists across requests in hot worker isolates
const memoryCache = new Map<string, CacheEntry<unknown>>();

// Default TTL: 5 minutes
const DEFAULT_TTL_SECONDS = 300;

// Cache key prefixes
const MODEL_CONFIG_PREFIX = 'model-config:';
const INSTANCE_CONFIG_PREFIX = 'instance-config:';

/**
 * Get from in-memory cache
 */
function getFromMemory<T>(key: string): T | null {
  const entry = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;

  if (Date.now() > entry.expires_at) {
    memoryCache.delete(key);
    return null;
  }

  return entry.data;
}

/**
 * Set in-memory cache
 */
function setInMemory<T>(key: string, data: T, ttlSeconds: number = DEFAULT_TTL_SECONDS): void {
  memoryCache.set(key, {
    data,
    expires_at: Date.now() + (ttlSeconds * 1000),
  });
}

/**
 * Get from Cloudflare Cache API
 */
async function getFromCFCache<T>(cacheKey: string): Promise<T | null> {
  try {
    const cache = caches.default;
    const cacheUrl = new URL(`https://config-cache.internal/${cacheKey}`);
    const response = await cache.match(cacheUrl);

    if (!response) return null;

    return await response.json() as T;
  } catch (error) {
    console.error('CF Cache get error:', error);
    return null;
  }
}

/**
 * Set in Cloudflare Cache API
 */
async function setInCFCache<T>(cacheKey: string, data: T, ttlSeconds: number = DEFAULT_TTL_SECONDS): Promise<void> {
  try {
    const cache = caches.default;
    const cacheUrl = new URL(`https://config-cache.internal/${cacheKey}`);

    const response = new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${ttlSeconds}`,
      },
    });

    await cache.put(cacheUrl, response);
  } catch (error) {
    console.error('CF Cache set error:', error);
  }
}

/**
 * Fetch model config with caching
 *
 * Checks in-memory cache first, then CF Cache, then fetches from config service.
 * Populates both caches on miss.
 */
export async function fetchModelConfigCached(
  modelId: string,
  configServiceUrl: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<ModelConfig | null> {
  const cacheKey = `${MODEL_CONFIG_PREFIX}${modelId}`;

  // 1. Check in-memory cache (fastest)
  const memoryResult = getFromMemory<ModelConfig>(cacheKey);
  if (memoryResult) {
    console.log(`[ConfigCache] Model config HIT (memory): ${modelId}`);
    return memoryResult;
  }

  // 2. Check CF Cache (cross-isolate)
  const cfResult = await getFromCFCache<ModelConfig>(cacheKey);
  if (cfResult) {
    console.log(`[ConfigCache] Model config HIT (CF cache): ${modelId}`);
    // Populate memory cache for subsequent requests in this isolate
    setInMemory(cacheKey, cfResult, ttlSeconds);
    return cfResult;
  }

  // 3. Fetch from config service
  console.log(`[ConfigCache] Model config MISS, fetching: ${modelId}`);
  const url = `${configServiceUrl}/model-config/${modelId}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`[ConfigCache] Failed to fetch model config: ${response.status}`);
      return null;
    }

    const result = await response.json() as { data?: ModelConfig };

    if (!result.data) {
      console.error('[ConfigCache] Model config response missing data field');
      return null;
    }

    const config = result.data;

    // Populate both caches
    setInMemory(cacheKey, config, ttlSeconds);
    await setInCFCache(cacheKey, config, ttlSeconds);

    console.log(`[ConfigCache] Model config cached: ${modelId}`);
    return config;
  } catch (error) {
    console.error(`[ConfigCache] Error fetching model config for ${modelId}:`, error);
    return null;
  }
}

/**
 * Get instance config with caching
 *
 * For MVP, this returns a mock config but caches it to avoid repeated work.
 * In production, this would fetch from the Config Service.
 */
export function getInstanceConfigCached(
  instanceId: string,
  env: {
    OPENAI_API_KEY?: string;
    ANTHROPIC_API_KEY?: string;
    IDEOGRAM_API_KEY?: string;
    GEMINI_API_KEY?: string;
    GOOGLE_API_KEY?: string;
    REPLICATE_API_TOKEN?: string;
    ELEVENLABS_API_KEY?: string;
    [key: string]: unknown;
  },
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): InstanceConfig {
  const cacheKey = `${INSTANCE_CONFIG_PREFIX}${instanceId}`;

  // Check in-memory cache
  const cached = getFromMemory<InstanceConfig>(cacheKey);
  if (cached) {
    return cached;
  }

  // Build mock config (MVP - in production this would fetch from Config Service)
  const config: InstanceConfig = {
    instance_id: instanceId,
    org_id: 'solamp',
    api_keys: {
      openai: (env.OPENAI_API_KEY as string) || '',
      anthropic: (env.ANTHROPIC_API_KEY as string) || '',
      ideogram: (env.IDEOGRAM_API_KEY as string) || '',
      gemini: (env.GEMINI_API_KEY as string) || '',
      google: (env.GOOGLE_API_KEY as string) || '',
      replicate: (env.REPLICATE_API_TOKEN as string) || '',
      elevenlabs: (env.ELEVENLABS_API_KEY as string) || '',
    },
    rate_limits: {
      openai: { rpm: 100, tpm: 50000 },
      anthropic: { rpm: 50, tpm: 50000 },
      ideogram: { rpm: 100, tpm: 50000 },
      gemini: { rpm: 100, tpm: 50000 },
    },
  };

  // Cache the config
  setInMemory(cacheKey, config, ttlSeconds);

  return config;
}

/**
 * Invalidate model config cache
 */
export async function invalidateModelConfig(modelId: string): Promise<void> {
  const cacheKey = `${MODEL_CONFIG_PREFIX}${modelId}`;

  // Remove from memory cache
  memoryCache.delete(cacheKey);

  // Remove from CF Cache
  try {
    const cache = caches.default;
    const cacheUrl = new URL(`https://config-cache.internal/${cacheKey}`);
    await cache.delete(cacheUrl);
  } catch (error) {
    console.error('Failed to invalidate CF cache:', error);
  }
}

/**
 * Invalidate instance config cache
 */
export function invalidateInstanceConfig(instanceId: string): void {
  const cacheKey = `${INSTANCE_CONFIG_PREFIX}${instanceId}`;
  memoryCache.delete(cacheKey);
}

/**
 * Clear all caches (useful for testing)
 */
export function clearAllCaches(): void {
  memoryCache.clear();
}

/**
 * Get cache stats (for debugging)
 */
export function getCacheStats(): { size: number; keys: string[] } {
  return {
    size: memoryCache.size,
    keys: Array.from(memoryCache.keys()),
  };
}
