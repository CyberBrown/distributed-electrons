# DE Routing Architecture Audit

**Date:** 2025-12-27
**Status:** Issue identified, fix pending

## Problem Statement

DE should have a SINGLE entry point for external apps. Currently, `de-workflows` exposes multiple endpoints that allow bypassing `PrimeWorkflow`:

- `POST /execute` → PrimeWorkflow ✅ (correct - single entry point)
- `POST /workflows/code-execution` → CodeExecutionWorkflow directly ❌ (bypass!)
- `POST /workflows/text-generation` → TextGenerationWorkflow directly ❌ (bypass!)
- `POST /workflows/image-generation` → ImageGenerationWorkflow directly ❌ (bypass!)
- `POST /workflows/audio-generation` → AudioGenerationWorkflow directly ❌ (bypass!)

---

## 1. All Routes Exposed in `index.ts`

| Route | Method | Target | Status |
|-------|--------|--------|--------|
| `/health` | GET | Health check | ✅ OK |
| `/execute` | POST | PrimeWorkflow | ✅ Single entry point |
| `/status/:id` | GET | PrimeWorkflow status | ✅ OK |
| `/workflows/code-execution` | POST | CodeExecutionWorkflow | ❌ **BYPASS** |
| `/workflows/code-execution/:id` | GET | Status | ⚠️ Needed for polling |
| `/workflows/text-generation` | POST | TextGenerationWorkflow | ❌ **BYPASS** |
| `/workflows/text-generation/:id` | GET | Status | ⚠️ Needed for polling |
| `/workflows/image-generation` | POST | ImageGenerationWorkflow | ❌ **BYPASS** |
| `/workflows/image-generation/:id` | GET | Status | ⚠️ Needed for polling |
| `/workflows/audio-generation` | POST | AudioGenerationWorkflow | ❌ **BYPASS** |
| `/workflows/audio-generation/:id` | GET | Status | ⚠️ Needed for polling |

**4 bypass POST routes** allow external apps to skip PrimeWorkflow entirely.

---

## 2. How PrimeWorkflow Routes to Sub-Workflows

### Current Implementation (Problem)

PrimeWorkflow uses **HTTP fetch** to trigger sub-workflows instead of workflow bindings.

**File:** `PrimeWorkflow.ts:307-395`

```typescript
// Line 311-312: Uses HTTP URL
const workflowUrl = this.env.DE_WORKFLOWS_URL || DEFAULT_DE_WORKFLOWS_URL;

// Line 388-395: Triggers via HTTP fetch
const response = await fetch(`${workflowUrl}${endpoint}`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Passphrase': this.env.NEXUS_PASSPHRASE || '',
  },
  body: JSON.stringify(subParams),
});
```

Then polls for completion via HTTP GET (lines 432-492).

### Target Implementation

Should use workflow bindings directly:

```typescript
const instance = await this.env.CODE_EXECUTION_WORKFLOW.create({
  id: workflowId,
  params: subParams,
});

// Poll using binding
const status = await instance.status();
```

---

## 3. Root Cause Analysis

PrimeWorkflow was designed to call itself via HTTP, which **requires** the bypass routes to exist. This creates a circular dependency:

1. PrimeWorkflow needs `/workflows/*` POST routes to trigger sub-workflows
2. Those routes are externally accessible (with passphrase auth)
3. External apps can bypass PrimeWorkflow by calling those routes directly

---

## 4. Summary

| Issue | Current State | Target State |
|-------|---------------|--------------|
| Entry point | `/execute` → PrimeWorkflow | ✅ Correct |
| Bypass routes | 4 POST routes exposed | Remove or return 403 |
| Sub-workflow routing | HTTP fetch to `/workflows/*` | Use `env.*_WORKFLOW.create()` bindings |
| Polling | HTTP GET to `/workflows/*/:id` | Use `instance.status()` on binding |

---

## 5. Proposed Fix

1. **Modify PrimeWorkflow** to use workflow bindings (`env.CODE_EXECUTION_WORKFLOW.create()`) instead of HTTP fetch
2. **Remove or lock down** the `POST /workflows/*` routes in `index.ts`
3. **Keep GET routes** for status polling (or internalize if using bindings)
4. **Update wrangler.toml** if needed to ensure workflow bindings are available to PrimeWorkflow

---

## 6. Target Architecture

```
External Apps
     │
     ▼
POST /execute (authenticated)
     │
     ▼
┌─────────────────┐
│  PrimeWorkflow  │
│  (orchestrator) │
└────────┬────────┘
         │ uses workflow bindings (not HTTP)
         ▼
┌────────────────────────────────────────────┐
│  Sub-Workflows (internal only)             │
│  - CodeExecutionWorkflow                   │
│  - TextGenerationWorkflow                  │
│  - ImageGenerationWorkflow                 │
│  - AudioGenerationWorkflow                 │
│  - VideoRenderWorkflow                     │
└────────────────────────────────────────────┘
```

No direct external access to sub-workflows.
