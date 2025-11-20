# Team 2 - Workers Implementation Team TODO List

**Branch**: `team-2-workers`
**Team Leader**: Team Lead 2
**Current Status**: 100% Code Complete - Grade A+
**Blocking Issues**: 4 failing tests + integration gaps

---

## 🚨 PRIORITY 1 - Critical Fixes (Must Complete Before Merge)

### Task 2.1: Fix R2 Storage Filename Sanitization Tests
**Status**: ❌ 3 TESTS FAILING
**File**: `/workspace/tests/r2-manager/storage.test.ts`
**Issue**: Sanitization logic replacing characters with `_` instead of removing them

**Failing Tests**:
1. "should sanitize special characters from filename"
2. "should prevent path traversal attacks"
3. "should handle unicode characters correctly"

**What's Wrong**:
Current implementation: `../../../etc/passwd` → `_._._etc_passwd`
Test expects: `../../../etc/passwd` → `etcpasswd`

**Action Required**:
1. Open `/workspace/workers/shared/r2-manager/storage.ts`
2. Find the `sanitizeFilename()` function
3. Change logic from:
```typescript
// Current (wrong)
filename.replace(/[^a-zA-Z0-9.-]/g, '_')

// To (correct)
filename.replace(/[^a-zA-Z0-9.-]/g, '')
```
4. OR update tests to match current implementation (discuss with team first)
5. Run: `npm test tests/r2-manager/storage.test.ts`

**Files to Fix**:
- `/workspace/workers/shared/r2-manager/storage.ts` (line ~45)

**Acceptance Criteria**:
- ✅ All 3 R2 storage tests pass
- ✅ Path traversal attacks blocked
- ✅ Filenames properly sanitized
- ✅ Security maintained

---

### Task 2.2: Fix Rate Limiter Response Format
**Status**: ❌ 1 TEST FAILING
**File**: `/workspace/tests/rate-limiter/limiter.test.ts`
**Issue**: `recordRequest()` returning undefined instead of success response

**What's Wrong**:
```typescript
// Current
async recordRequest(tokensUsed: number): Promise<void>

// Should be
async recordRequest(tokensUsed: number): Promise<{ success: boolean }>
```

**Action Required**:
1. Open `/workspace/workers/shared/rate-limiter/limiter.ts`
2. Find the `RateLimiter` Durable Object class
3. Update `recordRequest()` method to return success response:
```typescript
async recordRequest(tokensUsed: number): Promise<{ success: boolean }> {
  // ... existing logic ...
  return { success: true };
}
```
4. Update the Durable Object fetch handler to return this response
5. Run: `npm test tests/rate-limiter/limiter.test.ts`

**Files to Fix**:
- `/workspace/workers/shared/rate-limiter/limiter.ts` (DurableObject class)

**Acceptance Criteria**:
- ✅ Rate limiter test passes
- ✅ `recordRequest` returns `{success: true}`
- ✅ API contract matches specification

---

## 🔌 PRIORITY 2 - Integration & Configuration

### Task 2.3: Integrate Image Gen Worker with Real Config Service
**Status**: ⚠️ CRITICAL - Using Mock Config
**File**: `/workspace/workers/image-gen/index.ts`
**Issue**: Worker has hardcoded mock config instead of calling Team 1's Config Service

**What's Wrong**:
```typescript
// Current (MOCK - BAD)
const mockConfig = {
  instance_id: 'test',
  api_keys: { ideogram: 'mock_key' }
};

// Should be (REAL - GOOD)
const config = await resolveInstance(authContext, env);
```

**Action Required**:
1. Open `/workspace/workers/image-gen/index.ts`
2. Remove ALL mock configuration code
3. Import Team 1's instance lookup:
```typescript
import { resolveInstance } from '@/infrastructure/lookup/instance-resolver';
```
4. Add Config Service URL to environment:
```typescript
interface Env {
  // ... existing bindings ...
  CONFIG_SERVICE_URL: string;
}
```
5. Update wrangler.toml with Team 1's Config Service URL:
```toml
[vars]
CONFIG_SERVICE_URL = "https://config-service.YOUR_ACCOUNT.workers.dev"
```
6. Call real Config Service in worker:
```typescript
const instanceConfig = await resolveInstance({
  user: authContext.user,
  instanceId: request.headers.get('X-Instance-ID'),
  env
});
```
7. Test end-to-end with real Config Service

**Files to Update**:
- `/workspace/workers/image-gen/index.ts`
- `/workspace/workers/image-gen/wrangler.toml`

**Acceptance Criteria**:
- ✅ No mock configs in production code
- ✅ Calls Team 1's Config Service successfully
- ✅ Handles Config Service errors gracefully
- ✅ End-to-end test passes with real services

---

### Task 2.4: Complete Image Gen Worker Wrangler Configuration
**Status**: ⚠️ INCOMPLETE
**File**: `/workspace/workers/image-gen/wrangler.toml`

**What's Missing**:
All bindings commented out:
- D1 database binding
- KV cache binding
- R2 storage binding
- Durable Object binding for rate limiter

**Action Required**:
1. Get binding IDs from Team 1 (they should create these in Task 1.4)
2. Uncomment and update all bindings:

```toml
# D1 Database (from Team 1)
[[d1_databases]]
binding = "DB"
database_name = "multiagent_system"
database_id = "REPLACE_WITH_REAL_ID"

# KV Cache (from Team 1)
[[kv_namespaces]]
binding = "CACHE"
id = "REPLACE_WITH_REAL_ID"

# R2 Storage
[[r2_buckets]]
binding = "STORAGE"
bucket_name = "multiagent-images"

# Durable Objects - Rate Limiter
[[durable_objects.bindings]]
name = "RATE_LIMITER"
class_name = "RateLimiter"
script_name = "rate-limiter-worker"

# Environment Variables
[vars]
CONFIG_SERVICE_URL = "https://config-service.YOUR_ACCOUNT.workers.dev"
IDEOGRAM_API_KEY = "use_from_env"  # Will be in .env
```

3. Create R2 bucket: `wrangler r2 bucket create multiagent-images`
4. Deploy rate limiter as separate worker first
5. Test deployment: `wrangler deploy`

**Dependencies**:
- ⚠️ Blocked until Team 1 completes Task 1.4 (provides D1 and KV IDs)

**Acceptance Criteria**:
- ✅ All bindings configured with real IDs
- ✅ R2 bucket created
- ✅ Durable Object binding works
- ✅ Worker deploys successfully
- ✅ All env vars configured

---

### Task 2.5: Deploy Rate Limiter as Separate Worker
**Status**: ⏳ NOT STARTED
**File**: `/workspace/workers/shared/rate-limiter/`

**Why Needed**:
Durable Objects must be deployed in their own worker, then bound to other workers

**Action Required**:
1. Create `/workspace/workers/shared/rate-limiter/wrangler.toml`:
```toml
name = "rate-limiter-worker"
main = "limiter.ts"
compatibility_date = "2024-11-20"

[[durable_objects.bindings]]
name = "RATE_LIMITER"
class_name = "RateLimiter"
script_name = "rate-limiter-worker"

[durable_objects]
bindings = [
  { name = "RATE_LIMITER", class_name = "RateLimiter" }
]
```

2. Deploy: `wrangler deploy --config workers/shared/rate-limiter/wrangler.toml`
3. Note the worker name for use in Task 2.4
4. Test Durable Object creation:
```bash
curl -X POST https://rate-limiter-worker.YOUR_ACCOUNT.workers.dev/test
```

**Acceptance Criteria**:
- ✅ Rate limiter deployed as standalone worker
- ✅ Durable Object accessible
- ✅ Can be bound by Image Gen Worker
- ✅ Health check passes

---

## 📚 PRIORITY 3 - Documentation & Enhancement

### Task 2.6: Add Provider Adapter for Second Provider
**Status**: ⏳ OPTIONAL ENHANCEMENT
**Current**: Only Ideogram implemented
**Goal**: Validate multi-provider architecture

**Action Required**:
1. Choose second provider: DALL-E 3, Stability AI, or Replicate
2. Create new adapter: `/workspace/workers/shared/provider-adapters/dalle-adapter.ts`
3. Follow same pattern as Ideogram:
```typescript
export class DalleAdapter extends ProviderAdapter {
  constructor() {
    super('dalle');
  }

  formatRequest(prompt, options): ProviderRequest { /* ... */ }
  async submitJob(request, apiKey): Promise<string> { /* ... */ }
  async checkStatus(jobId): Promise<JobStatus> { /* ... */ }
  async fetchResult(jobId): Promise<ImageResult> { /* ... */ }
  supportsStreaming(): boolean { return false; }
}
```
4. Register in `/workspace/workers/shared/provider-adapters/registry.ts`
5. Add tests
6. Update documentation

**Nice to Have**: Not blocking for MVP

**Acceptance Criteria**:
- ✅ Second provider adapter implemented
- ✅ Registered in provider registry
- ✅ Tests pass
- ✅ Can switch providers via config

---

### Task 2.7: Add Circuit Breaker to Provider Adapters
**Status**: ⏳ ENHANCEMENT
**File**: `/workspace/workers/shared/provider-adapters/base-adapter.ts`

**Why**: Prevent cascading failures when provider API is down

**Action Required**:
1. Import Team 3's circuit breaker:
```typescript
import { CircuitBreaker } from '@/workers/shared/error-handling/retry';
```
2. Add circuit breaker state to BaseAdapter:
```typescript
abstract class ProviderAdapter {
  protected circuitBreaker: CircuitBreaker;

  constructor(providerName: string) {
    this.providerName = providerName;
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeout: 60000  // 1 minute
    });
  }
}
```
3. Wrap all API calls:
```typescript
async submitJob(request, apiKey) {
  return await this.circuitBreaker.execute(async () => {
    // ... actual API call ...
  });
}
```
4. Handle circuit open state gracefully
5. Add monitoring for circuit state

**Dependencies**:
- ⚠️ Needs Team 3's circuit breaker implementation

**Acceptance Criteria**:
- ✅ Circuit breaker integrated
- ✅ Opens after 5 consecutive failures
- ✅ Auto-recovers after timeout
- ✅ Returns friendly error when circuit open

---

### Task 2.8: Add Image Generation Queue System
**Status**: ⏳ FUTURE ENHANCEMENT
**Why**: Handle rate limits gracefully by queueing requests

**Action Required**:
1. Use Cloudflare Queues or Durable Objects queue
2. When rate limited (429), add to queue
3. Process queue when capacity available
4. Return job ID immediately, allow polling for result
5. Add webhook callback option

**Out of Scope for MVP**: Can be added later

---

## 🧪 PRIORITY 4 - Testing

### Task 2.9: Add End-to-End Integration Test
**Status**: ⏳ NOT STARTED
**Goal**: Test complete image generation flow with real services

**Action Required**:
1. Create `/workspace/tests/e2e/image-generation-flow.test.ts`
2. Test flow:
   - Authenticate with API key
   - Request image generation
   - Poll for completion
   - Verify image in R2
   - Check usage logged
3. Use test Ideogram API key
4. Clean up test data after run

**Test Scenario**:
```typescript
describe('Complete Image Generation Flow', () => {
  it('should generate image end-to-end', async () => {
    // 1. Auth
    const apiKey = process.env.TEST_API_KEY;

    // 2. Generate
    const response = await fetch('https://image-gen.../generate', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ prompt: 'test image' })
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    // 3. Verify R2
    expect(data.image_url).toMatch(/^https:/);

    // 4. Check image accessible
    const imageRes = await fetch(data.image_url);
    expect(imageRes.status).toBe(200);
  });
});
```

**Acceptance Criteria**:
- ✅ E2E test passes with real services
- ✅ Image successfully generated
- ✅ Stored in R2
- ✅ All services integrated correctly

---

### Task 2.10: Add Performance Tests
**Status**: ⏳ NOT STARTED
**Goal**: Validate system meets performance targets

**Performance Targets** (from specs):
- Image Generation: < 15s end-to-end
- Rate Limiter: < 5ms overhead
- R2 Upload: < 2s for typical images

**Action Required**:
1. Create `/workspace/tests/performance/benchmarks.test.ts`
2. Add timing instrumentation
3. Test with various image sizes
4. Test concurrent requests
5. Document results

**Acceptance Criteria**:
- ✅ All performance targets met
- ✅ Benchmark results documented
- ✅ No memory leaks under load

---

## 📊 Progress Tracking

**Total Tasks**: 10
**Critical (P1)**: 2
**Integration (P2)**: 3
**Enhancement (P3)**: 3
**Testing (P4)**: 2

### Estimated Time:
- **P1 Tasks**: 1-2 hours
- **P2 Tasks**: 3-4 hours
- **P3 Tasks**: 4-6 hours (optional)
- **P4 Tasks**: 2-3 hours
- **Total Critical**: 4-6 hours
- **Total with Enhancements**: 10-15 hours

---

## ✅ Checklist for Merge Readiness

Before requesting merge to main:
- [ ] All 4 failing tests fixed
- [ ] Mock configs removed, using real Config Service
- [ ] Wrangler configuration complete with real bindings
- [ ] Rate limiter deployed as Durable Object
- [ ] Image Gen Worker deployed and accessible
- [ ] R2 bucket created and accessible
- [ ] End-to-end test passes
- [ ] Integration with Team 1 verified
- [ ] Code reviewed by Team Lead

---

## 🆘 Need Help?

**Blocking Issues?** Escalate if:
- Waiting on Team 1's binding IDs for >4 hours
- Config Service integration failing after troubleshooting
- Ideogram API issues
- Durable Object deployment problems

**Coordination Needed**:
- With Team 1: Get D1/KV binding IDs
- With Team 3: Get circuit breaker implementation
- With Team 4: Provide worker URLs for testing GUI

**Resources**:
- API Contracts: `/workspace/docs/specs/api-contracts.md`
- Ideogram API Docs: https://developer.ideogram.ai/
- Review Report: `/workspace/TEAM_REVIEW_REPORT.md`
