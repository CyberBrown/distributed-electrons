# Multi-Agent Development Orchestration Plan
## Cloudflare Multi-Agent System - Automated Build

**Objective:** Deploy multiple Team Leader agents, each managing sub-agents, to build the entire MVP autonomously with minimal human intervention.

**Timeline:** 4-6 hours of parallel agent work  
**Human Role:** Deploy Team Leaders, monitor progress, approve final merge to production

---

## System Overview

### Hierarchy
```
Project Manager (You)
  ↓
Team Leaders (4) - Work through phases sequentially
  ↓  
Agents (16 total) - Work on tasks in parallel within each phase
  ↓
Git commits, tests, integration
```

### Git Strategy
- **Main branch:** Production code (you approve final merge)
- **Team branches:** `team-1-infrastructure`, `team-2-workers`, etc.
- **Agent branches:** `agent-1-1-database`, `agent-1-2-config-service`, etc.
- **Merge strategy:** Agent → Team Leader → Main (with CI/CD checks)

### Autonomous Conflict Resolution
- Agents write comprehensive tests
- Team Leaders have full context of all agent work
- On merge conflict: Team Leader reviews both changes, resolves based on specs
- If Team Leader can't resolve: Escalate to you with specific question

---

## Phase Definitions

### Phase 1: Foundation Infrastructure
**Team Leader 1 Responsibility**
- 4 agents building core services
- Must complete before Phase 2 can start
- Deliverable: Working Config Service with auth

### Phase 2: Worker Implementation  
**Team Leader 2 Responsibility**
- 4 agents building worker components
- Can start as soon as Phase 1 completes
- Deliverable: Functional Image Gen Worker

### Phase 3: Operations
**Team Leader 3 Responsibility**
- 4 agents building deployment/ops
- Can start in parallel with Phase 2
- Deliverable: Deployed instances with monitoring

### Phase 4: Interfaces
**Team Leader 4 Responsibility**
- 4 agents building user-facing pieces
- Needs Phase 1 & 2 complete
- Deliverable: Usable system with GUI

---

## Shared Specifications

All agents have access to these specification files in `/docs/specs/`:

### `/docs/specs/architecture.md`
```markdown
# System Architecture

## Instance Config Structure
{
  "instance_id": "string",
  "org_id": "string",
  "api_keys": {
    "provider_name": "string"
  },
  "rate_limits": {
    "provider_name": {"rpm": number, "tpm": number}
  },
  "worker_urls": {
    "worker_type": "https://url"
  },
  "r2_bucket": "string",
  "authorized_users": ["user_id"]
}

## API Key Format
- All API keys must be stored encrypted
- Retrieved via Config Service only
- Never logged

## Rate Limit Tracking
- Durable Object per instance+provider
- Key format: `instance:{instance_id}:provider:{provider}`
- Rolling window algorithm
- Graceful degradation when limits hit
```

### `/docs/specs/api-contracts.md`
```markdown
# API Contracts

## Config Service API

### GET /instance/{instance_id}
Returns instance configuration

### POST /instance
Creates new instance

### GET /user/{user_id}
Returns user info and permissions

## Image Generation Worker API

### POST /generate
Request:
{
  "prompt": "string",
  "model": "string (optional)",
  "instance_id": "string",
  "project_id": "string (optional)",
  "api_key": "string"
}

Response:
{
  "image_url": "string (R2 CDN URL)",
  "r2_path": "string",
  "metadata": {
    "provider": "string",
    "model": "string",
    "dimensions": "string",
    "generation_time_ms": number
  },
  "request_id": "string"
}

## Provider Adapter Interface

All providers must implement:
- formatRequest(prompt, options) → provider-specific payload
- parseResponse(response) → standardized image object
- checkStatus(job_id) → completion status
- supportsStreaming() → boolean
```

### `/docs/specs/testing-requirements.md`
```markdown
# Testing Requirements

Every component must include:

1. Unit tests (Jest or Vitest)
2. Integration tests for external APIs (mocked)
3. E2E test for critical path
4. Error case coverage (timeouts, rate limits, invalid input)

Minimum coverage: 80%

Test files: `{component}.test.ts`
```

---

## Team Leader 1: Infrastructure Team

### Overview
Build foundational services that all other teams depend on. Critical path component.

### Success Criteria
- Config Service deployed and responding
- D1 database populated with test data
- Authentication working
- Other teams can query instances

### Phase 1 Prompt for Team Leader 1

```
You are Team Leader 1 for the Infrastructure Team building a Cloudflare Workers multi-agent system.

YOUR MISSION:
Build the foundational infrastructure layer that all other components depend on. You manage 4 agents who will work in parallel on different components.

CONTEXT:
- System uses Org → Instance → Project hierarchy
- Instances are like VMs with their own API keys, rate limits, workers
- All configuration stored in D1 database
- Config Service is central lookup point for all workers

YOUR RESPONSIBILITIES:
1. Create git branch: team-1-infrastructure
2. Set up /docs/specs/ with architecture specs (provided)
3. Deploy 4 agents with specific tasks (prompts below)
4. Monitor agent progress via git commits
5. Review agent code and tests
6. Resolve merge conflicts between agents
7. Integrate all 4 components
8. Test end-to-end: create instance → authenticate → retrieve config
9. Merge to main when complete and tested
10. Document any issues/decisions for other teams

AGENTS YOU MANAGE:
- Agent 1.1: Database Schema
- Agent 1.2: Config Service Worker
- Agent 1.3: Authentication Middleware
- Agent 1.4: Instance Lookup Logic

WORKFLOW:
1. Create your team branch
2. Deploy all 4 agents simultaneously
3. Agents work in parallel, commit to their branches
4. As agents finish, merge their branches to your team branch
5. Resolve any conflicts with full context of both changes
6. Run integration tests
7. When all 4 agents complete and tests pass, notify ready for main merge

DELIVERABLES:
- /infrastructure/database/schema.sql
- /infrastructure/config-service/index.ts
- /infrastructure/auth/middleware.ts
- /infrastructure/lookup/instance-resolver.ts
- /tests/infrastructure/ (comprehensive test suite)
- README.md documenting the infrastructure

GIT COMMANDS YOU'LL USE:
```bash
git checkout -b team-1-infrastructure
# Deploy agents...
# After agent completes:
git merge agent-1-1-database
# Handle conflicts if any
git commit -m "Integrated database schema"
# Repeat for all agents
# Final integration test
npm test
# When ready:
git checkout main
git merge team-1-infrastructure
```

CONFLICT RESOLUTION:
If Agent 1.1 defines a schema field differently than Agent 1.2 expects:
- Review both implementations
- Choose the more flexible/correct approach
- Update the dependent code
- Add test to catch this in future

ESCALATION:
Only escalate to Project Manager if:
- Fundamental architecture decision needed
- Agents are blocked on external dependency
- Specification is ambiguous/contradictory

BEGIN: Create your team branch and deploy agents with their specific prompts (below).
```

### Agent 1.1 Prompt: Database Schema

```
You are Agent 1.1 working for Team Leader 1 on the Database Schema component.

YOUR TASK:
Create the D1 database schema for the Cloudflare multi-agent system.

BRANCH: agent-1-1-database (create from team-1-infrastructure)

SPECIFICATIONS:
Read /docs/specs/architecture.md for data structures.

CREATE:
1. /infrastructure/database/schema.sql with tables:
   - organizations (org_id PK, name, billing_email, created_at)
   - instances (instance_id PK, org_id FK, name, config JSON, created_at)
   - users (user_id PK, email, role ENUM('user','admin','superadmin'), org_id FK)
   - user_instance_access (user_id FK, instance_id FK, composite PK)
   - projects (project_id PK, instance_id FK, name, settings JSON, created_at)
   - api_keys (key_id PK, user_id or project_id, key_hash, created_at)
   - usage_logs (log_id PK, instance_id FK, timestamp, provider, tokens_used, cost)

2. /infrastructure/database/migrations/001-initial.sql
   - Same schema with migration comments

3. /infrastructure/database/seed.sql
   - Test data: 1 org, 2 instances (prod, dev), 2 users, 2 projects

4. /infrastructure/database/queries.ts
   - Helper functions for common queries
   - getInstanceById(), getUserById(), etc.

5. /tests/database/schema.test.ts
   - Test schema creation
   - Test constraints (foreign keys, unique)
   - Test seed data insertion

REQUIREMENTS:
- Use TEXT for IDs (UUIDs)
- JSON columns for flexible config
- Proper indexes on foreign keys
- Encrypted storage considerations (note in comments)
- Created_at timestamps everywhere

COMPLETION:
1. Commit all files to your branch
2. Push to remote
3. Notify Team Leader 1 via commit message: "[AGENT-1-1] Schema complete, tests passing"

ERROR HANDLING:
If you encounter ambiguity, make reasonable assumption, document in code comment, proceed.

BEGIN.
```

### Agent 1.2 Prompt: Config Service Worker

```
You are Agent 1.2 working for Team Leader 1 on the Config Service Worker.

YOUR TASK:
Build the central Config Service Worker that manages instances, users, and configuration.

BRANCH: agent-1-2-config-service (create from team-1-infrastructure)

PREREQUISITES:
Wait for Agent 1.1 to push database schema, then proceed.

CREATE:
1. /infrastructure/config-service/index.ts
   - Cloudflare Worker handling requests
   - Routes: /instance/{id}, /user/{id}, /instance (POST), etc.
   - Uses D1 binding to database

2. /infrastructure/config-service/handlers/
   - instance-handlers.ts (CRUD operations)
   - user-handlers.ts (CRUD operations)
   - project-handlers.ts (CRUD operations)

3. /infrastructure/config-service/wrangler.toml
   - Worker configuration
   - D1 binding
   - Routes

4. /tests/config-service/
   - Unit tests for each handler
   - Integration tests with mocked D1
   - Test error cases (not found, invalid input)

SPECIFICATIONS:
- Return 404 for missing resources
- Return 403 for unauthorized access
- Return 500 for database errors
- All responses JSON
- Include request_id in responses for tracing

API EXAMPLES:

GET /instance/production
Response: { instance_id, org_id, api_keys, rate_limits, worker_urls, r2_bucket }

POST /instance
Body: { org_id, name, config }
Response: { instance_id, ...config }

ERROR RESPONSE:
{ error: "message", request_id: "uuid" }

COMPLETION:
Commit, push, notify: "[AGENT-1-2] Config Service complete"

BEGIN.
```

### Agent 1.3 Prompt: Authentication Middleware

```
You are Agent 1.3 working for Team Leader 1 on Authentication Middleware.

YOUR TASK:
Build authentication middleware that validates API keys and loads user context.

BRANCH: agent-1-3-auth (create from team-1-infrastructure)

PREREQUISITES:
Wait for Agent 1.1 (schema) and Agent 1.2 (config service), then proceed.

CREATE:
1. /infrastructure/auth/middleware.ts
   - Validates API key from request header
   - Loads user from database
   - Loads user's instance access
   - Attaches to request context

2. /infrastructure/auth/key-manager.ts
   - Hash API keys (use crypto.subtle)
   - Generate new keys
   - Validate key format

3. /infrastructure/auth/types.ts
   - AuthContext interface
   - User interface
   - Permissions checking functions

4. /tests/auth/
   - Test valid/invalid keys
   - Test permission checking
   - Test key hashing

FLOW:
Request with header: Authorization: Bearer {api_key}
  ↓
Middleware hashes key
  ↓
Looks up in database
  ↓
If found: load user, check instance access
  ↓
Attach to ctx.auth = { user, instances, permissions }
  ↓
If not found: return 401 Unauthorized

INTEGRATION:
Export middleware function that other workers can import:
```typescript
import { authMiddleware } from '@/infrastructure/auth/middleware';

export default {
  async fetch(request, env, ctx) {
    const authResult = await authMiddleware(request, env);
    if (!authResult.authorized) {
      return new Response('Unauthorized', { status: 401 });
    }
    // Continue with authResult.user
  }
}
```

COMPLETION:
Commit, push, notify: "[AGENT-1-3] Auth middleware complete"

BEGIN.
```

### Agent 1.4 Prompt: Instance Lookup Logic

```
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
```

---

## Team Leader 2: Worker Implementation Team

### Overview
Build the actual functional workers, starting with Image Generation.

### Success Criteria
- Image Gen Worker deployed and responding
- Can generate image via Ideogram
- Respects rate limits
- Saves to R2
- Returns CDN URL

### Phase 2 Prompt for Team Leader 2

```
You are Team Leader 2 for the Worker Implementation Team.

YOUR MISSION:
Build the functional workers that actually do the work, starting with Image Generation.

DEPENDENCIES:
You MUST wait for Team Leader 1 to complete Phase 1 (Config Service operational).

YOUR RESPONSIBILITIES:
1. Create git branch: team-2-workers
2. Deploy 4 agents to build worker components
3. Ensure agents use infrastructure from Team 1
4. Test end-to-end: API call → image generated → saved to R2
5. Merge to main when complete

AGENTS:
- Agent 2.1: Provider Adapter Framework
- Agent 2.2: Rate Limiter (Durable Object)
- Agent 2.3: R2 Storage Manager
- Agent 2.4: Image Generation Worker (orchestrates 2.1, 2.2, 2.3)

INTEGRATION POINTS:
Your workers will call Team 1's Config Service to get instance config.
Your workers will use Team 1's auth middleware.

DELIVERABLES:
- /workers/shared/provider-adapters/
- /workers/shared/rate-limiter/
- /workers/shared/r2-manager/
- /workers/image-gen/
- Deployed and accessible image-gen worker

BEGIN: Wait for Team 1, then create branch and deploy agents.
```

### Agent 2.1 Prompt: Provider Adapter Framework

```
You are Agent 2.1 working for Team Leader 2 on the Provider Adapter Framework.

YOUR TASK:
Create an extensible framework for integrating AI providers, with Ideogram as first implementation.

BRANCH: agent-2-1-provider-adapters (create from team-2-workers)

CREATE:
1. /workers/shared/provider-adapters/base-adapter.ts
   - Abstract base class ProviderAdapter
   - Methods: formatRequest(), submitJob(), checkStatus(), fetchResult()

2. /workers/shared/provider-adapters/ideogram-adapter.ts
   - Implements ProviderAdapter for Ideogram API
   - Uses Ideogram API spec: https://developer.ideogram.ai/

3. /workers/shared/provider-adapters/registry.ts
   - Provider registry: maps provider name → adapter class
   - Factory pattern to instantiate adapters

4. /workers/shared/provider-adapters/types.ts
   - Interfaces for requests/responses
   - Standardized ImageResult type

5. /tests/provider-adapters/
   - Mock Ideogram API responses
   - Test adapter methods
   - Test error handling (timeout, rate limit)

INTERFACE:
```typescript
abstract class ProviderAdapter {
  abstract formatRequest(prompt: string, options: any): ProviderRequest;
  abstract submitJob(request: ProviderRequest, apiKey: string): Promise<JobId>;
  abstract checkStatus(jobId: JobId): Promise<JobStatus>;
  abstract fetchResult(jobId: JobId): Promise<ImageResult>;
}

interface ImageResult {
  image_url: string;
  provider: string;
  model: string;
  metadata: {
    dimensions: string;
    format: string;
    generation_time_ms: number;
  }
}
```

IDEOGRAM IMPLEMENTATION:
- Use their /generate endpoint
- Poll /status until complete
- Fetch image data
- Handle rate limit responses (429) gracefully

COMPLETION:
Commit, push, notify: "[AGENT-2-1] Provider adapters complete"

BEGIN.
```

### Agent 2.2 Prompt: Rate Limiter

```
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
```

### Agent 2.3 Prompt: R2 Storage Manager

```
You are Agent 2.3 working for Team Leader 2 on R2 Storage Manager.

YOUR TASK:
Build the R2 storage manager that saves generated images and returns CDN URLs.

BRANCH: agent-2-3-r2-manager (create from team-2-workers)

CREATE:
1. /workers/shared/r2-manager/storage.ts
   - Upload image to R2
   - Generate CDN URL
   - Handle bucket selection (instance-specific or default)

2. /workers/shared/r2-manager/metadata.ts
   - Attach metadata to R2 objects
   - Retrieve metadata

3. /workers/shared/r2-manager/types.ts
   - UploadResult interface
   - StorageOptions interface

4. /tests/r2-manager/
   - Mock R2 binding
   - Test upload flow
   - Test URL generation

INTERFACE:
```typescript
async function uploadImage(
  imageData: ArrayBuffer | ReadableStream,
  options: {
    instanceId: string,
    projectId?: string,
    filename: string,
    metadata: Record<string, string>
  },
  env: Env
): Promise<UploadResult>

interface UploadResult {
  r2_path: string;
  cdn_url: string;
  bucket: string;
  size_bytes: number;
}
```

FLOW:
1. Determine bucket from instance config (or use default)
2. Generate unique filename: `{instance_id}/{project_id}/{timestamp}_{filename}`
3. Upload to R2 with metadata
4. Generate public CDN URL
5. Return URL + path

CDN URL FORMAT:
https://cdn.yourdomain.com/{bucket}/{path}
OR
https://pub-{random}.r2.dev/{path}

METADATA:
Store as R2 custom metadata:
- instance_id
- project_id
- provider
- model
- prompt (truncated)
- generation_timestamp

COMPLETION:
Commit, push, notify: "[AGENT-2-3] R2 manager complete"

BEGIN.
```

### Agent 2.4 Prompt: Image Generation Worker

```
You are Agent 2.4 working for Team Leader 2 on the Image Generation Worker.

YOUR TASK:
Build the main Image Generation Worker that orchestrates all components into a working service.

BRANCH: agent-2-4-image-gen (create from team-2-workers)

PREREQUISITES:
Wait for Agent 2.1, 2.2, and 2.3 to complete.

CREATE:
1. /workers/image-gen/index.ts
   - Main worker handling POST /generate requests
   - Orchestrates: auth → lookup → rate limit → provider → R2 → response

2. /workers/image-gen/wrangler.toml
   - Worker configuration
   - Bindings: D1, KV, R2, Durable Objects

3. /workers/image-gen/README.md
   - API documentation
   - Example requests
   - Deployment instructions

4. /tests/image-gen/
   - E2E test with mocked provider
   - Test error handling (rate limit, provider fail, auth fail)

FLOW:
```
1. POST /generate with { prompt, api_key, instance_id }
2. Authenticate via Team 1's auth middleware → get user
3. Resolve instance via Team 1's lookup → get config
4. Check rate limit via Agent 2.2 → proceed or 429
5. Get provider adapter via Agent 2.1 → format request
6. Submit to provider (Ideogram) → get job ID
7. Poll status until complete (with timeout)
8. Fetch image result
9. Upload to R2 via Agent 2.3 → get CDN URL
10. Record usage in database
11. Return response with image URL + metadata
```

ERROR HANDLING:
- Auth fail → 401
- Instance not found → 404
- Rate limit → 429
- Provider timeout → 504, return job ID for later retrieval
- Provider error → 502, retry with fallback (future)

RESPONSE:
```json
{
  "success": true,
  "image_url": "https://cdn.../image.png",
  "r2_path": "production/content-forge/12345_image.png",
  "metadata": {
    "provider": "ideogram",
    "model": "ideogram-v2",
    "dimensions": "1024x1024",
    "generation_time_ms": 3240
  },
  "request_id": "uuid"
}
```

DEPLOYMENT:
Worker URL: https://image-gen-{instance}.{account}.workers.dev

COMPLETION:
1. Deploy to Cloudflare (use wrangler deploy)
2. Test with real Ideogram API call
3. Commit, push, notify: "[AGENT-2-4] Image Gen Worker deployed and tested"

BEGIN.
```

---

## Team Leader 3: Operations Team

### Overview
Build deployment automation, error handling, and monitoring.

### Success Criteria
- Can deploy new instances via script
- GitHub Actions working
- Logs being captured
- Error handling functional

### Phase 3 Prompt for Team Leader 3

```
You are Team Leader 3 for the Operations Team.

YOUR MISSION:
Build the operational infrastructure: deployment, monitoring, error handling.

YOUR RESPONSIBILITIES:
1. Create branch: team-3-operations
2. Can work in parallel with Team 2
3. Deploy 4 agents for ops components
4. Test: deploy new instance end-to-end
5. Merge to main when complete

AGENTS:
- Agent 3.1: Error Handling & Retries
- Agent 3.2: Logging System
- Agent 3.3: Deployment Scripts
- Agent 3.4: GitHub Actions CI/CD

BEGIN: Create branch and deploy agents.
```

### Agent 3.1 Prompt: Error Handling & Retries

```
You are Agent 3.1 working for Team Leader 3 on Error Handling & Retries.

YOUR TASK:
Build comprehensive error handling and retry logic for the entire system.

BRANCH: agent-3-1-error-handling (create from team-3-operations)

CREATE:
1. /workers/shared/error-handling/retry.ts
   - Exponential backoff retry function
   - Circuit breaker implementation
   - Timeout handling

2. /workers/shared/error-handling/errors.ts
   - Custom error classes
   - Error serialization for logging
   - Error code constants

3. /workers/shared/error-handling/middleware.ts
   - Global error handler middleware
   - Formats errors consistently
   - Logs errors

4. /tests/error-handling/
   - Test retry logic
   - Test circuit breaker
   - Test error formatting

RETRY LOGIC:
```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts: number,
    initialDelay: number,
    maxDelay: number,
    shouldRetry: (error: Error) => boolean
  }
): Promise<T>
```

CIRCUIT BREAKER:
Track failures per provider:
- After N failures: open circuit (reject immediately)
- After timeout: half-open (try one request)
- If success: close circuit (resume normal)

ERROR CODES:
- AUTH_FAILED: 401
- RATE_LIMITED: 429
- PROVIDER_TIMEOUT: 504
- PROVIDER_ERROR: 502
- INTERNAL_ERROR: 500

COMPLETION:
Commit, push, notify: "[AGENT-3-1] Error handling complete"

BEGIN.
```

### Agent 3.2 Prompt: Logging System

```
You are Agent 3.2 working for Team Leader 3 on the Logging System.

YOUR TASK:
Build structured logging that captures all system activity.

BRANCH: agent-3-2-logging (create from team-3-operations)

CREATE:
1. /workers/shared/logging/logger.ts
   - Structured logging functions
   - Log levels: DEBUG, INFO, WARN, ERROR
   - Attaches request_id, instance_id, user_id

2. /workers/shared/logging/storage.ts
   - Write logs to D1
   - Batch writes for performance

3. /workers/shared/logging/types.ts
   - LogEntry interface

4. /tests/logging/
   - Test log formatting
   - Test batching
   - Test filtering by level

LOG STRUCTURE:
```typescript
interface LogEntry {
  timestamp: string;  // ISO 8601
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  message: string;
  request_id: string;
  instance_id?: string;
  user_id?: string;
  component: string;  // e.g., 'image-gen-worker'
  metadata?: Record<string, any>;
}
```

USAGE:
```typescript
import { logger } from '@/shared/logging/logger';

logger.info('Image generation started', {
  request_id,
  instance_id,
  provider: 'ideogram'
});

logger.error('Provider timeout', {
  request_id,
  error: err.message,
  provider: 'ideogram'
});
```

STORAGE:
- Write to D1 table: logs
- Batch writes every 100 logs or 10 seconds
- Keep logs for 30 days, then auto-delete

COMPLETION:
Commit, push, notify: "[AGENT-3-2] Logging complete"

BEGIN.
```

### Agent 3.3 Prompt: Deployment Scripts

```
You are Agent 3.3 working for Team Leader 3 on Deployment Scripts.

YOUR TASK:
Build scripts to deploy new instances and manage the infrastructure.

BRANCH: agent-3-3-deployment (create from team-3-operations)

CREATE:
1. /scripts/deploy-instance.ts
   - Takes instance config as input
   - Deploys all workers for that instance
   - Creates D1 database entry
   - Sets up R2 bucket
   - Returns worker URLs

2. /scripts/update-instance.ts
   - Updates existing instance config
   - Redeploys workers if needed

3. /scripts/delete-instance.ts
   - Removes instance
   - Cleans up workers, buckets

4. /scripts/README.md
   - Usage instructions

DEPLOY-INSTANCE FLOW:
```bash
npm run deploy-instance -- \
  --config instance-config.json \
  --cloudflare-account-id xxx \
  --cloudflare-api-token xxx
```

Reads config:
```json
{
  "instance_id": "production",
  "org_id": "your-org-id",
  "api_keys": { "ideogram": "..." },
  "rate_limits": { "ideogram": { "rpm": 500 } },
  "r2_bucket": "prod-images"
}
```

Does:
1. Create D1 entry for instance
2. Create R2 bucket if not exists
3. Deploy workers with wrangler:
   - wrangler deploy --name image-gen-production --env production
4. Update worker_urls in D1
5. Print success + URLs

TECHNOLOGIES:
- Use wrangler CLI programmatically
- Use Cloudflare API for D1/R2 setup

COMPLETION:
Commit, push, notify: "[AGENT-3-3] Deployment scripts complete"

BEGIN.
```

### Agent 3.4 Prompt: GitHub Actions CI/CD

```
You are Agent 3.4 working for Team Leader 3 on GitHub Actions.

YOUR TASK:
Build CI/CD pipeline that tests and deploys code automatically.

BRANCH: agent-3-4-github-actions (create from team-3-operations)

CREATE:
1. /.github/workflows/test.yml
   - Run on every PR
   - Run all tests
   - Lint code
   - Type checking

2. /.github/workflows/deploy.yml
   - Run on push to main
   - Deploy to specified instances
   - Run smoke tests after deploy

3. /.github/workflows/deploy-instance.yml
   - Manual trigger
   - Deploy to specific instance

4. /docs/ci-cd.md
   - How workflows work
   - How to trigger manual deploys

TEST WORKFLOW:
```yaml
name: Test
on: [pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
```

DEPLOY WORKFLOW:
```yaml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run deploy-all-instances
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

DEPLOY-ALL-INSTANCES:
Script that reads /instances/*.json configs and deploys each.

COMPLETION:
Commit, push, notify: "[AGENT-3-4] GitHub Actions complete"

BEGIN.
```

---

## Team Leader 4: Interface Team

### Overview
Build user-facing interfaces: testing GUI, admin panel, docs, monitoring.

### Success Criteria
- Can test image generation via simple GUI
- Can create/manage instances via admin panel
- System is documented
- Can view logs/metrics

### Phase 4 Prompt for Team Leader 4

```
You are Team Leader 4 for the Interface Team.

YOUR MISSION:
Build the user-facing interfaces that make the system usable.

DEPENDENCIES:
Need Phase 1 (infrastructure) and Phase 2 (workers) complete.

YOUR RESPONSIBILITIES:
1. Create branch: team-4-interfaces
2. Deploy 4 agents for UI components
3. Each component is a Cloudflare Pages app
4. Test: can use system via browser
5. Merge to main when complete

AGENTS:
- Agent 4.1: Testing GUI
- Agent 4.2: Admin Interface
- Agent 4.3: Documentation
- Agent 4.4: Monitoring Dashboard

BEGIN: Wait for dependencies, then create branch and deploy agents.
```

### Agent 4.1 Prompt: Testing GUI

```
You are Agent 4.1 working for Team Leader 4 on Testing GUI.

YOUR TASK:
Build a simple web interface to test the image generation worker.

BRANCH: agent-4-1-testing-gui (create from team-4-interfaces)

CREATE:
1. /interfaces/testing-gui/
   - Cloudflare Pages app (React or vanilla JS)
   - Single page with form
   - Displays results

2. Form fields:
   - API Key (input)
   - Instance ID (dropdown)
   - Prompt (textarea)
   - Model (dropdown, optional)
   - Generate button

3. Results display:
   - Generated image
   - CDN URL (copyable)
   - R2 path
   - Metadata (provider, time, etc.)
   - Request ID

4. Error display:
   - Error messages
   - Status codes

TECH STACK:
Simple HTML + JavaScript (no complex framework needed for MVP)

FUNCTIONALITY:
```javascript
async function generateImage() {
  const response = await fetch('https://image-gen-production.workers.dev/generate', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      prompt,
      instance_id: instanceId
    })
  });
  
  const result = await response.json();
  displayImage(result.image_url);
  displayMetadata(result);
}
```

STYLING:
Simple, clean. Use Tailwind CSS or basic CSS.

DEPLOYMENT:
Cloudflare Pages, auto-deploy from git.

COMPLETION:
Deploy to Pages, test, commit, push, notify: "[AGENT-4-1] Testing GUI deployed"

BEGIN.
```

### Agent 4.2 Prompt: Admin Interface

```
You are Agent 4.2 working for Team Leader 4 on Admin Interface.

YOUR TASK:
Build admin panel to manage instances, users, and view system status.

BRANCH: agent-4-2-admin-interface (create from team-4-interfaces)

CREATE:
1. /interfaces/admin-panel/
   - Cloudflare Pages app (React recommended)
   - Multi-page: Instances, Users, Logs

2. Instances page:
   - List all instances
   - Create new instance (form)
   - Edit instance config
   - Delete instance
   - View instance stats (requests, errors)

3. Users page:
   - List users
   - Create user
   - Assign instance access
   - Generate API keys

4. Logs page:
   - Filter logs by instance, time, level
   - Search logs
   - View error details

AUTH:
Require admin login (simple auth for MVP).

TECH STACK:
React + React Router + Tailwind CSS

API CALLS:
Calls Config Service API for CRUD operations.
Calls logging API for log retrieval.

COMPLETION:
Deploy to Pages, test, commit, push, notify: "[AGENT-4-2] Admin interface deployed"

BEGIN.
```

### Agent 4.3 Prompt: Documentation

```
You are Agent 4.3 working for Team Leader 4 on Documentation.

YOUR TASK:
Write comprehensive documentation for the entire system.

BRANCH: agent-4-3-documentation (create from team-4-interfaces)

CREATE:
1. /docs/README.md
   - System overview
   - Architecture diagram (Mermaid)
   - Getting started

2. /docs/api/
   - API reference for each worker
   - Request/response examples
   - Error codes

3. /docs/deployment/
   - How to deploy new instance
   - How to update workers
   - Troubleshooting

4. /docs/development/
   - Local development setup
   - How to add new provider
   - Testing guide

5. /docs/admin/
   - How to manage users
   - How to monitor system
   - How to scale

STYLE:
Clear, concise, with code examples.

DIAGRAMS:
Use Mermaid for architecture/flow diagrams.

EXAMPLES:
Real curl commands that work.

COMPLETION:
Commit, push, notify: "[AGENT-4-3] Documentation complete"

BEGIN.
```

### Agent 4.4 Prompt: Monitoring Dashboard

```
You are Agent 4.4 working for Team Leader 4 on Monitoring Dashboard.

YOUR TASK:
Build a dashboard to monitor system health and usage.

BRANCH: agent-4-4-monitoring (create from team-4-interfaces)

CREATE:
1. /interfaces/monitoring/
   - Cloudflare Pages app
   - Dashboard with charts

2. Metrics to display:
   - Requests per instance (over time)
   - Error rate per instance
   - Average response time
   - Rate limit hits
   - Provider usage breakdown
   - Cost estimate (based on usage)

3. Charts:
   - Use Chart.js or similar
   - Time series for requests/errors
   - Pie chart for provider distribution

4. Filters:
   - By instance
   - By time range (last hour, day, week)

DATA SOURCE:
Query logs table in D1, aggregate metrics.

REFRESH:
Auto-refresh every 30 seconds.

TECH STACK:
React + Chart.js + Tailwind CSS

COMPLETION:
Deploy to Pages, test, commit, push, notify: "[AGENT-4-4] Monitoring deployed"

BEGIN.
```

---

## Orchestration Commands

### Deploy All Team Leaders

```bash
# You run this once

# Start Team Leader 1 (Infrastructure)
claude-code --project cloudflare-multiagent --prompt-file prompts/team-leader-1.txt &

# Wait for Team Leader 1 to signal completion (~30 min)
# Then start Team Leader 2 and 3 in parallel

claude-code --project cloudflare-multiagent --prompt-file prompts/team-leader-2.txt &
claude-code --project cloudflare-multiagent --prompt-file prompts/team-leader-3.txt &

# Wait for Team Leader 2 completion (~45 min)
# Then start Team Leader 4

claude-code --project cloudflare-multiagent --prompt-file prompts/team-leader-4.txt &

# Monitor progress via git commits
watch -n 10 'git log --oneline --graph --all'

# After 4-6 hours, review:
# - All branches merged to main?
# - Tests passing?
# - Workers deployed?
# - GUI functional?
```

### Team Leader Autonomous Actions

Each Team Leader will:
1. Create their team branch
2. Write prompts to files for their agents
3. Spawn agents via Claude Code CLI
4. Monitor agent commits
5. Merge agent branches to team branch
6. Run integration tests
7. Resolve conflicts autonomously (or escalate)
8. Merge to main when ready
9. Report completion status

### Git Convention

Commit messages must follow format:
- `[AGENT-X-Y] Component name: description`
- `[TEAM-X] Phase complete: summary`
- `[MERGE] Merged agent-X-Y into team-X`

This allows automated monitoring of progress.

### Conflict Resolution Strategy

When merge conflict occurs:
1. Team Leader reads both versions
2. Determines which is correct based on specs
3. May need to call both agent branches to update
4. Resolves and commits with message: `[CONFLICT-RESOLVED] Description`

If Team Leader can't resolve:
- Commits partial resolution
- Adds comment with question
- Notifies you via commit message: `[ESCALATION-NEEDED] Question`

### Success Criteria

System is complete when:
- [x] All 4 team branches merged to main
- [x] All tests passing
- [x] 2 instances deployed (production, development)
- [x] Image generation working via testing GUI
- [x] Admin panel functional
- [x] Documentation complete
- [x] Monitoring showing data

---

## Monitoring Progress

### Dashboard View

```bash
# Watch git activity
watch -n 5 'git log --all --oneline --graph | head -50'

# Count completed agents
git log --all --grep="\[AGENT.*complete" | wc -l
# Target: 16 agents

# Count completed teams
git log --all --grep="\[TEAM.*complete" | wc -l  
# Target: 4 teams

# Check for escalations
git log --all --grep="ESCALATION"

# Check for conflicts
git log --all --grep="CONFLICT"
```

### Expected Timeline

- **T+0**: Deploy Team Leader 1, agents 1.1-1.4 start
- **T+30min**: Infrastructure agents complete, Team Leader 1 integrates
- **T+45min**: Team Leader 1 completes, Team Leaders 2 & 3 start
- **T+90min**: Worker agents complete, Team Leader 2 integrates
- **T+120min**: Ops agents complete, Team Leader 3 integrates
- **T+135min**: Team Leaders 2 & 3 complete, Team Leader 4 starts
- **T+180min**: Interface agents complete, Team Leader 4 integrates
- **T+210min**: All teams complete, final integration
- **T+240min**: System tested end-to-end, ready for review

---

## Emergency Procedures

### If Agent Stuck
- Check last commit timestamp
- If >30min no activity:
  - Review agent logs
  - Check if blocked on dependency
  - If truly stuck: kill agent, manually fix, restart

### If Team Leader Stuck
- Check team branch
- Review integration tests
- May need to manually merge
- If architectural issue: fix spec, restart team

### If Mass Failures
- Kill all agents
- Review specs for contradictions
- Fix specs
- Restart from last good commit

---

## Post-Completion Checklist

After agents complete:

- [ ] Review all code changes
- [ ] Run full test suite manually
- [ ] Deploy to real Cloudflare account
- [ ] Test with real API keys
- [ ] Generate test image via GUI
- [ ] Create instance via admin panel
- [ ] Review logs in monitoring
- [ ] Check all documentation
- [ ] Merge team branches to main
- [ ] Tag release: v1.0.0-mvp
- [ ] Deploy to production

---

**Document Version:** 1.0  
**Last Updated:** 2025-11-19  
**Status:** Ready for Execution
