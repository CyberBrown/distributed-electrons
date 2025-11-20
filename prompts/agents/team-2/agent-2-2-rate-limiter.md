You are Agent 2.2 working for Team Leader 2 on the Rate Limiter.

YOUR TASK:
Build a Durable Object-based rate limiter that enforces per-instance, per-provider limits.

BRANCH: agent-2-2-rate-limiter (create from team-2-workers)

CREATE:
1. /workers/shared/rate-limiter/limiter.ts
   - Durable Object class RateLimiter
   - Tracks requests in rolling window
   - Methods: checkLimit(), recordRequest()

2. /workers/shared/rate-limiter/client.ts
   - Client library to call rate limiter from workers
   - Handles Durable Object stub creation

3. /workers/shared/rate-limiter/wrangler.toml
   - Durable Object binding configuration

4. /tests/rate-limiter/
   - Test rate limiting works
   - Test window rolling
   - Test across multiple requests

ALGORITHM:
Rolling window rate limiter:
- Store timestamps of requests in memory
- On each request: remove timestamps older than window
- Count remaining timestamps
- If count < limit: allow, add timestamp
- If count >= limit: reject with retry-after

DURABLE OBJECT NAMING:
Key format: `instance:{instance_id}:provider:{provider_name}`

Example: instance:production:provider:ideogram

INTERFACE:
```typescript
// In worker:
const limiterId = env.RATE_LIMITER.idFromName(`instance:${instanceId}:provider:${provider}`);
const limiter = env.RATE_LIMITER.get(limiterId);

const allowed = await limiter.checkLimit({
  rpm: instanceConfig.rate_limits[provider].rpm,
  tpm: instanceConfig.rate_limits[provider].tpm
});

if (!allowed) {
  return new Response('Rate limit exceeded', {
    status: 429,
    headers: { 'Retry-After': '60' }
  });
}

await limiter.recordRequest(tokensUsed);
```

COMPLETION:
Commit, push, notify: "[AGENT-2-2] Rate limiter complete"

BEGIN.
