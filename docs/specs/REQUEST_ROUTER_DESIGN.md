# DE Request Router - Architecture Design

## Overview

The Request Router is a central orchestration layer for DE that:
1. Routes requests from apps to appropriate services (Mnemo, text-gen, image-gen, etc.)
2. Manages long-running requests using Durable Objects + Alarms
3. Handles multiple cache/context instances per app
4. Provides async job management with polling/callbacks

## Problem Statement

**Current Issue:**
```
ecosystem-agent (CF Worker) → Mnemo (CF Worker) → Gemini API
                                      ↑
                              19+ second queries timeout
                              CF Worker-to-Worker call limits
```

**Solution:**
```
ecosystem-agent → DE Gateway → Request Router (DO) → Mnemo Service
                                     ↑
                         Durable Object manages:
                         - Long-running requests via Alarms
                         - Queue management
                         - Multiple app contexts
                         - Retry logic
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT APPS                                 │
│   ecosystem-agent  │  nexus  │  bridge  │  other apps               │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    DE GATEWAY WORKER                                 │
│                  gateway.distributedelectrons.com                    │
│  - Auth validation                                                   │
│  - Route to Request Router DO                                        │
│  - Health checks                                                     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│              REQUEST ROUTER (Durable Object)                         │
│                                                                      │
│  Per-App Instance (ID: app:{appId})                                  │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  State:                                                      │    │
│  │  - pending_jobs: Map<jobId, JobInfo>                        │    │
│  │  - contexts: Map<contextAlias, ContextInfo>                 │    │
│  │  - rate_limits: per-service limits                          │    │
│  │                                                              │    │
│  │  Methods:                                                    │    │
│  │  - /submit - Submit new request (returns jobId)             │    │
│  │  - /status/:jobId - Check job status                        │    │
│  │  - /result/:jobId - Get completed result                    │    │
│  │  - /cancel/:jobId - Cancel pending job                      │    │
│  │  - /contexts - List active contexts for this app            │    │
│  │                                                              │    │
│  │  Alarms:                                                     │    │
│  │  - Process queued jobs                                       │    │
│  │  - Retry failed requests                                     │    │
│  │  - Clean up expired jobs                                     │    │
│  └─────────────────────────────────────────────────────────────┘    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
         ▼                     ▼                     ▼
┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐
│  Mnemo Service  │  │   Text Gen       │  │   Image Gen    │
│  (context cache)│  │   (OpenAI, etc)  │  │   (Ideogram)   │
└─────────────────┘  └──────────────────┘  └────────────────┘
```

## Request Flow

### 1. Submit Request (Async)
```
POST /api/submit
{
  "app_id": "ecosystem-agent",
  "service": "mnemo",
  "operation": "query",
  "params": {
    "alias": "ecosystem-agent-shared",
    "query": "What is Mnemo?",
    "maxTokens": 2000
  },
  "callback_url": "https://ecosystem-agent.solamp.workers.dev/callback" // optional
}

Response:
{
  "job_id": "job_abc123",
  "status": "queued",
  "estimated_wait_seconds": 30
}
```

### 2. Poll for Status
```
GET /api/status/job_abc123

Response (pending):
{
  "job_id": "job_abc123",
  "status": "processing",
  "progress": 50,
  "started_at": "2025-12-08T03:00:00Z"
}

Response (complete):
{
  "job_id": "job_abc123",
  "status": "completed",
  "result_available": true
}
```

### 3. Get Result
```
GET /api/result/job_abc123

Response:
{
  "job_id": "job_abc123",
  "status": "completed",
  "result": {
    "response": "Mnemo is...",
    "tokensUsed": 662117,
    "cachedTokensUsed": 662012
  },
  "metadata": {
    "service": "mnemo",
    "duration_ms": 19234,
    "cost_estimate": 0.02
  }
}
```

## Durable Object Design

### RequestRouter Class

```typescript
interface JobInfo {
  id: string;
  appId: string;
  service: 'mnemo' | 'text-gen' | 'image-gen';
  operation: string;
  params: Record<string, unknown>;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: unknown;
  error?: string;
  retryCount: number;
  callbackUrl?: string;
}

interface ContextInfo {
  alias: string;
  service: string;
  createdAt: Date;
  expiresAt: Date;
  tokenCount: number;
}

export class RequestRouter implements DurableObject {
  private state: DurableObjectState;
  private pendingJobs: Map<string, JobInfo>;
  private contexts: Map<string, ContextInfo>;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.pendingJobs = new Map();
    this.contexts = new Map();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    switch (url.pathname) {
      case '/submit':
        return this.handleSubmit(request);
      case '/status':
        return this.handleStatus(url);
      case '/result':
        return this.handleResult(url);
      case '/contexts':
        return this.handleContexts();
      default:
        return new Response('Not found', { status: 404 });
    }
  }

  async alarm(): Promise<void> {
    // Process queued jobs
    // Retry failed jobs
    // Clean up completed jobs older than TTL
  }
}
```

## Mnemo Service Integration

The Request Router calls Mnemo through a dedicated service worker that:
1. Manages cache instances per app
2. Handles the long-running Gemini requests
3. Reports progress back to Router

### Mnemo Operations

| Operation | Description | Timeout |
|-----------|-------------|---------|
| `load` | Load sources into context cache | 5 min |
| `query` | Query cached context | 2 min |
| `list` | List caches for app | 10 sec |
| `evict` | Remove cache | 10 sec |
| `refresh` | Refresh cache content | 5 min |

### Cache Instance Management

Each app gets isolated cache instances:
```
Cache Alias Format: {appId}:{userAlias}

Examples:
- ecosystem-agent:shared-docs
- nexus:email-context
- bridge:user-123-session
```

## Gateway Worker

Simple entry point that routes to Request Router:

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Auth validation
    const appId = await validateAuth(request, env);
    if (!appId) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Get or create Router DO for this app
    const routerId = env.REQUEST_ROUTER.idFromName(`app:${appId}`);
    const router = env.REQUEST_ROUTER.get(routerId);

    // Forward request to Router
    return router.fetch(request);
  }
}
```

## Configuration

### wrangler.toml (gateway)
```toml
name = "de-gateway"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[durable_objects.bindings]]
name = "REQUEST_ROUTER"
class_name = "RequestRouter"

[[migrations]]
tag = "v1"
new_classes = ["RequestRouter"]

[vars]
MNEMO_SERVICE_URL = "https://mnemo.solamp.workers.dev"
TEXT_GEN_URL = "https://text.distributedelectrons.com"
IMAGE_GEN_URL = "https://images.distributedelectrons.com"
```

## Client SDK (for apps like ecosystem-agent)

```typescript
class DEClient {
  private baseUrl: string;
  private appId: string;
  private apiKey: string;

  constructor(config: { appId: string; apiKey: string }) {
    this.baseUrl = 'https://gateway.distributedelectrons.com';
    this.appId = config.appId;
    this.apiKey = config.apiKey;
  }

  // Submit and wait for result (with polling)
  async request(service: string, operation: string, params: object): Promise<any> {
    // Submit job
    const { job_id } = await this.submit(service, operation, params);

    // Poll for completion
    return this.waitForResult(job_id, { timeout: 120000 });
  }

  // Submit async job
  async submit(service: string, operation: string, params: object): Promise<{ job_id: string }> {
    const response = await fetch(`${this.baseUrl}/api/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'X-App-ID': this.appId,
      },
      body: JSON.stringify({ service, operation, params }),
    });
    return response.json();
  }

  // Poll until complete
  async waitForResult(jobId: string, options: { timeout: number }): Promise<any> {
    const deadline = Date.now() + options.timeout;

    while (Date.now() < deadline) {
      const status = await this.getStatus(jobId);

      if (status.status === 'completed') {
        return this.getResult(jobId);
      }

      if (status.status === 'failed') {
        throw new Error(status.error);
      }

      // Wait before next poll
      await new Promise(r => setTimeout(r, 2000));
    }

    throw new Error('Request timeout');
  }
}
```

## Migration Path

### Phase 1: Build Infrastructure
1. Create Gateway Worker
2. Create RequestRouter Durable Object
3. Create Mnemo Service wrapper

### Phase 2: Integrate Apps
1. Update ecosystem-agent to use DEClient
2. Test with existing Mnemo caches
3. Monitor performance and costs

### Phase 3: Extend
1. Add callback support for real async
2. Add more services (text-gen, image-gen)
3. Add observability/monitoring

## Success Criteria

1. ecosystem-agent can submit Mnemo queries without timeout errors
2. Multiple apps can use isolated cache instances
3. Long-running requests (19+ sec) complete successfully
4. Failed requests are automatically retried
5. Costs are tracked per app
