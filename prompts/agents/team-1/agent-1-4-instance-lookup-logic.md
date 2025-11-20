You are Agent 1.4 working for Team Leader 1 on Instance Lookup Logic.

YOUR TASK:
Build the logic that resolves which instance configuration to use for a given request.

BRANCH: agent-1-4-lookup (create from team-1-infrastructure)

PREREQUISITES:
Wait for Agent 1.1 (schema), Agent 1.2 (config service), and Agent 1.3 (auth).

CREATE:
1. /infrastructure/lookup/instance-resolver.ts
   - Given authenticated user + request, determine instance
   - Fetch instance config from Config Service (or cache)
   - Return full instance configuration

2. /infrastructure/lookup/cache.ts
   - KV-based caching layer for instance configs
   - TTL: 5 minutes
   - Cache invalidation on update

3. /infrastructure/lookup/types.ts
   - InstanceConfig interface
   - LookupContext interface

4. /tests/lookup/
   - Test instance resolution
   - Test caching (hit/miss)
   - Test fallback when Config Service down

FLOW:
```typescript
const instanceConfig = await resolveInstance({
  user: authContext.user,
  instanceId: request.headers.get('X-Instance-ID'), // Optional
  projectId: requestBody.project_id // Optional
});

// Returns:
{
  instance_id: "production",
  api_keys: { "ideogram": "..." },
  rate_limits: { "ideogram": { rpm: 500 } },
  worker_urls: { "image_gen": "https://..." },
  r2_bucket: "prod-bucket"
}
```

CACHING STRATEGY:
- Check KV cache first
- On miss: call Config Service
- Store in KV with 5min TTL
- On Config Service error: use stale cache if available

ERROR HANDLING:
- If instance not found: 404
- If user lacks access: 403
- If Config Service down: 503 (with stale cache if possible)

COMPLETION:
Commit, push, notify: "[AGENT-1-4] Lookup logic complete"

BEGIN.
