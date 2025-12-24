# Code Review Report

**Date**: 2025-12-23
**Scope**: Full Project Scan (Runners, Workers, Workflows, Infrastructure)
**Reviewer**: Gemini CLI

## 1. Security Critical: Shell Injection Vulnerability

### Component: `services/gemini-runner/src/server.ts`

**Issue**:
The `executeGemini` function uses `spawn('sh', ['-c', fullCommand])` to execute the Gemini CLI. While there is an attempt to escape the prompt (`prompt.replace(/'/g, "'\\''")`), this approach is brittle and potentially vulnerable to shell injection if other parameters or the prompt structure changes.

**Location**:
```typescript
// services/gemini-runner/src/server.ts:316
const proc: ChildProcess = spawn('sh', ['-c', fullCommand], { ... });
```

**Recommendation**:
Avoid using the shell (`sh -c`) entirely. Execute the `gemini` executable directly and pass arguments as an array. This leverages the OS's argument parsing rather than shell parsing.

## 2. Performance: Missing Configuration Caching

### Component: `workers/text-gen` and `workers/image-gen`

**Issue**:
Both workers call `fetchModelConfig` and `getInstanceConfig` on **every single request**.
- `getInstanceConfig`: Fetches from Config Service (mocked currently, but designed to fetch).
- `fetchModelConfig`: Fetches from Config Service.

This introduces unnecessary latency (HTTP RTT) and load on the Config Service.

**Location**:
- `workers/text-gen/index.ts`: `handleGenerate`
- `workers/image-gen/index.ts`: `handleGenerate`

**Recommendation**:
Implement a short-lived in-memory cache (LRU or simple Map with TTL) within the Worker global scope. Cloudflare Workers recycle isolates, but a global cache persists across requests handled by the same hot isolate.

## 3. Workflow Logic: Ambiguous Variable Reuse

### Component: `workers/workflows/CodeExecutionWorkflow.ts`

**Issue**:
The logic reuses `primaryResult` for both the primary and fallback execution results. This makes the flow harder to reason about and debug. If the primary fails, `primaryResult` is null, then it's assigned the result of the fallback.

**Location**:
```typescript
// workers/workflows/CodeExecutionWorkflow.ts
let primaryResult: ExecutionResult | null = null;
// ... later ...
primaryResult = await step.do('execute-fallback', ...)
```

**Recommendation**:
Use distinct variables or a clearer state object.

## 4. Performance: Rate Limiter I/O

### Component: `workers/shared/rate-limiter/limiter.ts`

**Issue**:
The `recordRequest` method performs a `storage.put` on every single request. Cloudflare Durable Objects storage operations have costs and latency. For high-throughput rate limiting, this can be a bottleneck.

**Location**:
```typescript
// workers/shared/rate-limiter/limiter.ts
await this.state.storage.put('requests', this.requests);
```

**Recommendation**:
Since strict persistence of every single token usage might not be critical if the isolate stays alive, consider:
1.  Batching writes.
2.  Or simply accepting that if the DO crashes, the last few seconds of rate limit data are lost (often acceptable).

## 5. Code Quality: Blocking I/O in Node.js Service

### Component: `services/gemini-runner/src/server.ts`

**Issue**:
The Express server uses synchronous file system operations (`fs.readdirSync`, `fs.rmSync`, `fs.existsSync`) in route handlers.

**Location**:
- `app.get('/repos', ...)` uses `fs.readdirSync`.
- `app.delete('/repos', ...)` uses `fs.rmSync`.

**Recommendation**:
Use `fs.promises` (or `fs/promises`) for asynchronous operations to ensure the Node.js event loop remains non-blocking, especially under load.

## 6. Architecture: Code Duplication in Workers

### Component: `workers/*` (image-gen, text-gen, audio-gen, render-service)

**Issue**:
There is significant boilerplate duplication across all service workers:
- **CORS Handling**: `addCorsHeaders` is redefined in every worker.
- **Error Handling**: `createErrorResponse` is redefined in every worker.
- **Auth/Config**: Similar logic for fetching instance config and API keys.

**Locations**:
- `workers/image-gen/index.ts`
- `workers/text-gen/index.ts`
- `workers/audio-gen/index.ts`
- `workers/render-service/index.ts`
- `workers/intake/index.ts`

**Recommendation**:
Refactor these common utilities into `workers/shared/utils` or `workers/shared/middleware`. The `addCorsHeaders` and `createErrorResponse` functions are identical across all files and should be imported from a shared library.

## 7. Security: Hardcoded Credentials/Defaults

### Component: `workers/audio-gen/index.ts` and `workers/image-gen/index.ts`

**Issue**:
Fallback/Default API keys or IDs are hardcoded or insecurely accessed.
- `workers/audio-gen/index.ts`: Hardcoded default voice ID `'21m00Tcm4TlvDq8ikWAM'`.
- `workers/image-gen/index.ts`: Mock config with `'ide_mock_key'`.

**Recommendation**:
Ensure all credentials, even defaults, are strictly managed via environment variables or the Config Service, never hardcoded in source.

## 8. Reliability: Missing Retry Logic for External APIs

### Component: `workers/audio-gen/index.ts`, `workers/render-service/index.ts`

**Issue**:
Calls to ElevenLabs and Shotstack API do not appear to have robust retry logic for transient 5xx errors or network blips, unlike the `CodeExecutionWorkflow` which uses `step.do` with retries.

**Recommendation**:
Implement a shared `fetchWithRetry` utility or use a library to handle transient failures gracefully across all workers.

## 9. Intake Worker: JSON Parsing Vulnerability

### Component: `workers/intake/index.ts`

**Issue**:
The `handleIntake` function parses JSON (`await request.json()`) inside a try-catch, but a large payload could potentially cause memory issues or DoS if not limited. While Cloudflare has limits, explicit validation is better.

**Recommendation**:
Ensure request body size validation before parsing, or rely on Cloudflare's built-in limits explicitly. The current implementation catches `SyntaxError` which is good, but structure validation (zod/valibot) would be safer than manual checks.
