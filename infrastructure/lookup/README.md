# Instance Lookup Module

Resolves instance configurations for incoming requests with intelligent caching and fallback strategies.

## Overview

The Instance Lookup module determines which instance configuration to use for a given request based on:
- Explicit instance ID (from `X-Instance-ID` header)
- User's default instance
- Project ID mapping (future)

## Architecture

```
Request → Lookup Context → Instance Resolver → Instance Config
                                ↓
                              Cache (KV)
                                ↓
                          Config Service
```

## Components

### 1. Types (`types.ts`)

Defines all interfaces and types:

- `InstanceConfig` - Complete instance configuration
- `LookupContext` - Input context for resolution
- `LookupResult` - Resolution result with metadata
- `CacheEntry` - KV cache entry structure
- `LookupError` - Custom error class

### 2. Cache (`cache.ts`)

KV-based caching layer with:

- **TTL**: 5 minutes (300 seconds) default
- **Stale Grace Period**: 1 hour after TTL
- **Operations**: get, set, invalidate, invalidateAll, warmCache

```typescript
const cache = new InstanceCache(kv, 300);

// Get from cache
const result = await cache.get('production', allowStale);

// Set cache
await cache.set('production', config);

// Invalidate
await cache.invalidate('production');
```

### 3. Instance Resolver (`instance-resolver.ts`)

Main resolution logic:

```typescript
const resolver = createInstanceResolver(kv, {
  config_service_url: 'https://config.example.com',
  cache_ttl: 300,
  use_stale_on_error: true,
});

const result = await resolver.resolve(context);
```

## Usage

### Basic Resolution

```typescript
import { resolveInstance } from './infrastructure/lookup';

const config = await resolveInstance(env.KV, {
  user: {
    user_id: 'user_123',
    email: 'user@example.com',
    roles: ['user'],
  },
  instance_id: request.headers.get('X-Instance-ID'),
});

// Use config for worker routing
const workerUrl = config.worker_urls['image_gen'];
const apiKey = config.api_keys['ideogram'];
const rateLimit = config.rate_limits['ideogram'].rpm;
```

### With Request Context

```typescript
const context: LookupContext = {
  user: authContext.user,
  instance_id: request.headers.get('X-Instance-ID'),
  project_id: requestBody.project_id,
  request_metadata: {
    ip: request.headers.get('CF-Connecting-IP'),
    user_agent: request.headers.get('User-Agent'),
    request_id: crypto.randomUUID(),
  },
};

const config = await resolveInstance(env.KV, context, {
  config_service_url: env.CONFIG_SERVICE_URL,
  use_stale_on_error: true,
});
```

## Resolution Flow

1. **Determine Instance ID**
   - Check `context.instance_id` (from X-Instance-ID header)
   - Fallback to `context.project_id` mapping (future)
   - Fallback to `context.user.default_instance_id`
   - Error if no ID found

2. **Check Cache**
   - Lookup in KV with key `instance_config:{instanceId}`
   - If found and fresh (within TTL): return immediately
   - If expired: proceed to step 3

3. **Fetch from Config Service**
   - Call `GET /instances/{instanceId}`
   - Include `X-User-ID` and `X-Request-ID` headers
   - Verify user access
   - Cache result with TTL

4. **Error Handling**
   - If Config Service down: try stale cache (if enabled)
   - If instance not found: throw 404
   - If access denied: throw 403
   - If no fallback available: throw 503

## Error Handling

```typescript
try {
  const config = await resolveInstance(kv, context);
} catch (error) {
  if (error instanceof LookupError) {
    switch (error.type) {
      case LookupErrorType.INSTANCE_NOT_FOUND:
        return new Response('Instance not found', { status: 404 });

      case LookupErrorType.ACCESS_DENIED:
        return new Response('Access denied', { status: 403 });

      case LookupErrorType.CONFIG_SERVICE_UNAVAILABLE:
        return new Response('Service temporarily unavailable', { status: 503 });

      case LookupErrorType.INVALID_CONTEXT:
        return new Response('Invalid request context', { status: 400 });
    }
  }
  throw error;
}
```

## Caching Strategy

### Cache Key Format
```
instance_config:{instanceId}
```

### Cache Entry
```json
{
  "config": { /* InstanceConfig */ },
  "cached_at": 1234567890,
  "ttl": 300
}
```

### TTL Behavior
- **Fresh**: 0-300 seconds (5 minutes)
- **Expired**: 300+ seconds
- **Stale Grace**: 300-3600 seconds (up to 1 hour)
- **Purged**: 3600+ seconds

### Stale Cache Fallback
When `use_stale_on_error: true`:
- Config Service error triggers stale cache lookup
- Returns stale data if within grace period
- Marks result with `source: 'stale_cache'`

## Access Control

Built-in access verification:
- Instance owner can access
- Users with 'admin' role can access any instance
- Others get 403 Access Denied

Can be extended with:
- Tenant-based access
- Role-based permissions
- Feature flag checks

## Configuration Options

```typescript
interface ResolverOptions {
  cache_ttl?: number;              // Default: 300 (5 minutes)
  use_stale_on_error?: boolean;    // Default: true
  config_service_url?: string;     // Required
  config_service_timeout?: number; // Default: 5000ms
}
```

## Performance

### Cache Hit Ratio
Monitor with `resolver.getCacheStats()`:
```typescript
{
  hits: 1250,
  misses: 15,
  stale_hits: 3,
  evictions: 5
}
```

### Optimization Tips
- Warm cache on worker startup with frequently accessed instances
- Use longer TTL for stable environments
- Enable stale cache fallback for resilience
- Monitor cache stats to tune TTL

## Testing

Run tests:
```bash
npm test tests/lookup
```

Test coverage:
- Cache hit/miss behavior
- TTL and expiration
- Stale cache fallback
- Config Service integration
- Error handling (404, 403, 503)
- Access control
- Multi-instance scenarios

## Examples

### Worker Integration

```typescript
export default {
  async fetch(request: Request, env: Env) {
    // Extract auth context (from Agent 1.3)
    const authContext = await authenticateRequest(request, env);

    // Resolve instance
    const instanceConfig = await resolveInstance(env.KV, {
      user: authContext.user,
      instance_id: request.headers.get('X-Instance-ID'),
    }, {
      config_service_url: env.CONFIG_SERVICE_URL,
    });

    // Route to worker
    const workerUrl = instanceConfig.worker_urls['image_gen'];
    const response = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${instanceConfig.api_keys['ideogram']}`,
      },
      body: request.body,
    });

    return response;
  },
};
```

### Cache Warming

```typescript
// On worker startup or scheduled task
const popularInstances = [
  { instance_id: 'production', /* ... */ },
  { instance_id: 'staging', /* ... */ },
];

await resolver.warmCache(popularInstances);
```

### Manual Cache Invalidation

```typescript
// When instance config changes
await resolver.invalidateCache('production');

// Nuclear option - invalidate all
await resolver.invalidateAllCaches();
```

## Dependencies

- Cloudflare Workers KV (for caching)
- Config Service API (for instance configs)
- Auth Service (for user context)

## Future Enhancements

- [ ] Project ID → Instance ID mapping
- [ ] Multi-tenant support
- [ ] Advanced ACL rules
- [ ] Cache warming strategies
- [ ] Metrics and monitoring
- [ ] Cache compression for large configs
- [ ] Distributed cache coordination
