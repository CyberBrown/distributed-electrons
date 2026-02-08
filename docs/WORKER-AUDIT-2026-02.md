# DE Worker Audit — February 2026 (Prometheus Phase 1)

## Summary

| Worker | Name | Deployed | Domain | Called By | Verdict | Notes |
|--------|------|----------|--------|-----------|---------|-------|
| workflows | `de-workflows` | YES | de-workflows.solamp.workers.dev | intake (reroute), direct | **KEEP** | Core orchestration hub, 7 Workflows |
| intake | `intake` | YES | intake.distributedelectrons.com | external apps | **KEEP** (simplify later) | Now a proxy to /execute via intake-reroute.ts |
| text-gen | `de-text-gen` | YES | text.distributedelectrons.com | **No internal callers** | **RETIRE** | Redundant with TextGenerationWorkflow |
| delivery | `delivery` | **NO** | delivery.distributedelectrons.com | de-workflows (VideoRenderWorkflow) | **RETIRE** | Never deployed, placeholder DB ID |
| sandbox-executor | `sandbox-executor` | YES | sandbox-executor.solamp.workers.dev | de-workflows (CodeExecutionWorkflow) | **KEEP** | Code execution pipeline |
| request-router | `request-router` | YES | N/A (DO only) | intake (BYPASSED) | **RETIRE** | Broken, bypassed by intake-reroute.ts |
| rate-limiter | `rate-limiter` | YES | N/A (DO only) | 6 workers | **KEEP** | Critical shared dependency |
| image-gen | `image-gen` | YES | images.distributedelectrons.com | de-workflows (ImageGenerationWorkflow) | **KEEP** | Image generation |
| audio-gen | `audio-gen` | YES | audio.distributedelectrons.com | de-workflows (AudioGenerationWorkflow) | **KEEP** | Audio generation |
| render-service | `render-service` | YES | render.distributedelectrons.com | external clients | **KEEP** | Shotstack video rendering |
| stock-media | `stock-media` | YES | media.distributedelectrons.com | external clients | **KEEP** | Pexels stock media search |

## Databases

| Database | ID | Used By |
|----------|----|---------|
| `de-database` | `7cff30a0-c974-4ede-b96a-c91dd2f0c870` | de-workflows, intake, delivery (not deployed) |
| `de-router` | `8ade17f3-6b9f-4690-a86d-39a3a73ec8c5` | de-text-gen only |

## R2 Buckets

| Bucket | Worker |
|--------|--------|
| `production-images` | image-gen |
| `de-audio-storage` | audio-gen |
| `de-render-storage` | render-service |
| `de-deliverables-storage` | delivery (not deployed) |

## Dependency Graph

```
External Clients
    |
    v
[intake] -----> [de-workflows] (HTTP fetch + cross-worker Workflow bindings)
                     |
                     +--> [sandbox-executor] --> claude-runner / gemini-runner (on-prem)
                     +--> [image-gen] --> Ideogram / Replicate / DALL-E
                     +--> [audio-gen] --> ElevenLabs / OpenAI TTS
                     +--> [delivery] (NOT DEPLOYED - broken link)
                     +--> AI Gateway --> z.ai, Anthropic, OpenAI, Google, Workers AI
                     +--> Spark vLLM (local Nemotron)
                     +--> Nexus MCP

[intake] ---> [rate-limiter] (DO)
[de-text-gen] ---> [rate-limiter] (DO), AI Gateway
[image-gen] ---> [rate-limiter] (DO)
[audio-gen] ---> [rate-limiter] (DO)
[render-service] ---> [rate-limiter] (DO), Shotstack API
[stock-media] ---> [rate-limiter] (DO), Pexels API
```

## Key Findings

### 1. `delivery` worker is NOT DEPLOYED
Referenced by `de-workflows` (`VideoRenderWorkflow` fetches `DELIVERY_URL`). Its D1 database ID is still `placeholder-replace-with-actual-id`. Any video render workflow attempting delivery will fail silently.

### 2. `request-router` DO is dead code
Intake explicitly bypasses it via `intake-reroute.ts`. The binding was removed in Prometheus Phase 1. The DO worker itself is still deployed but receives no traffic.

### 3. `de-text-gen` is redundant
No other workers call `text.distributedelectrons.com`. The `TextGenerationWorkflow` in `de-workflows` supersedes its functionality with better provider waterfall logic and AI Gateway integration.

### 4. `rate-limiter` is critical infrastructure
Consumed by 6 workers. Last deployed 2025-11-22 (oldest deployment). Should not be modified without careful testing.

### 5. Two separate D1 databases
`de-database` is the main shared database. `de-router` is used only by `de-text-gen` — another signal that text-gen is isolated and can be retired.

## Phase 1 Actions Taken

- [x] Removed `REQUEST_ROUTER` DO binding from intake/wrangler.toml
- [x] Removed `REQUEST_ROUTER` DO binding from delivery/wrangler.toml
- [x] Removed `REQUEST_ROUTER` usage from intake/index.ts (handleStatus, handleCancel)
- [x] Made `notifyRouterCompletion` a no-op in delivery/index.ts
- [x] Added `@deprecated` header to shared/request-router-do/router.ts
- [x] Deployed intake — verified reroute still works without REQUEST_ROUTER binding
- [ ] de-text-gen: to be retired (Task 4)
- [ ] delivery: needs assessment — either deploy or remove reference from VideoRenderWorkflow

## Phase 2 Candidates

1. Delete `request-router` DO code entirely
2. Delete `delivery` worker code (or deploy it if video delivery is needed)
3. Delete `de-text-gen` worker code and `de-router` D1 database
4. Consolidate `de-database` schema (remove delivery-related tables if unused)
