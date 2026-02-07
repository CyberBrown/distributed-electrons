# DE E2E Audit Report — 2026-02-07

## Summary Health Score: YELLOW

The core DE workflow pipeline (worker → PrimeWorkflow → sub-workflows) is **fully functional**. Graceful reroute is deployed and working. On-prem runner tunnels are **down**, so code execution falls back to sandbox-executor (which is healthy). The system is operational but degraded for on-prem execution paths.

---

## Infrastructure Status

| Component | URL | Status | Notes |
|-----------|-----|--------|-------|
| de-workflows worker | de-workflows.solamp.workers.dev | **GREEN** (200) | Healthy, all 7 workflows bound |
| sandbox-executor | sandbox-executor.solamp.workers.dev | **GREEN** (200) | Healthy |
| claude-runner tunnel | claude-runner.shiftaltcreate.com | **RED** (502) | Tunnel down — container likely stopped |
| gemini-runner tunnel | gemini.spark.shiftaltcreate.com | **RED** (000) | DNS resolved but connection refused |
| vLLM/Nemotron tunnel | vllm.shiftaltcreate.com | **RED** (502) | Tunnel down — container likely stopped |

---

## Workflow Smoke Test Results (12/12 PASS)

| # | Test | Method | Expected | Actual | Status |
|---|------|--------|----------|--------|--------|
| 1 | Health check | GET /health | 200 + healthy | 200 + healthy | PASS |
| 2 | Test routing | GET /test-routing | 200 + all tests pass | 200 + 4/4 pass | PASS |
| 3 | Direct /execute | POST /execute | 200 + accepted | 200 + `execution_id` returned | PASS |
| 4 | Code execution reroute | POST /workflows/code-execution | 200 + `redirected: true` | 200 + redirected + deprecation_notice | PASS |
| 5 | Text generation reroute | POST /workflows/text-generation | 200 + `redirected: true` | 200 + redirected + deprecation_notice | PASS |
| 6 | Image generation reroute | POST /workflows/image-generation | 200 + `redirected: true` | 200 + redirected + deprecation_notice | PASS |
| 7 | Audio generation reroute | POST /workflows/audio-generation | 200 + `redirected: true` | 200 + redirected + deprecation_notice | PASS |
| 8 | Auth rejection (no passphrase) | POST /workflows/code-execution | 401 | 401 `Invalid passphrase` | PASS |
| 9 | Bad JSON body | POST /workflows/code-execution | 400 | 400 `Invalid JSON body` | PASS |
| 10 | Missing required field | POST /workflows/code-execution | 400 | 400 `Missing required field: prompt` | PASS |
| 11 | Status polling | GET /status/:id | 200 + status object | 200 + `status: complete` with full output | PASS |
| 12 | product-shipping-research 403 | POST /workflows/product-shipping-research | 403 | 403 `USE_EXECUTE_ENDPOINT` | PASS |

---

## Reroute Confirmation

All 4 legacy POST endpoints now gracefully reroute through PrimeWorkflow:

- **`redirected: true`** — present in all rerouted responses
- **`deprecation_notice`** — present, includes route name and migration target
- **`migration_guide`** — present, includes PrimeWorkflowParams schema reference
- **`[DEPRECATION]` log** — emitted via `console.warn` with IP + User-Agent

### Reroute Mapping Verified

| Legacy Route | task_id format | title prefix | hints.workflow | Extra mappings |
|-------------|---------------|-------------|----------------|----------------|
| /workflows/code-execution | `code-reroute-{ts}` | `[implement]` | `code-execution` | context.repo, hints.provider, model_waterfall |
| /workflows/text-generation | `request_id` or `text-reroute-{ts}` | `[research]` | `text-generation` | context.system_prompt |
| /workflows/image-generation | `request_id` or `image-reroute-{ts}` | `[image]` | `image-generation` | hints.model ← model_id |
| /workflows/audio-generation | `request_id` or `audio-reroute-{ts}` | `[audio]` | `audio-generation` | hints.model ← voice_id or model_id |
| /workflows/product-shipping-research | N/A | N/A | N/A | Still 403 (requires structured product data) |

---

## Pipeline Flow Verified (Test 11)

Request → PrimeWorkflow → Classification → Sub-workflow → Result → Status Pollable

```
POST /workflows/code-execution { prompt: "Fix the README typo", repo_url: "CyberBrown/distributed-electrons" }
  → handleGracefulReroute maps to PrimeWorkflowParams
  → PrimeWorkflow created: code-reroute-1770485771014
  → Classified as task_type: "code"
  → CodeExecutionWorkflow spawned: prime-code-reroute-1770485771014-*
  → Result: { success: false, error: "Invalid repo URL format" }  (expected — test repo_url format)
  → GET /status/code-reroute-1770485771014 → 200 { status: "complete", output: {...} }
```

Full pipeline round-trip works. The "Invalid repo URL format" error is expected — the test used a short-form repo identifier rather than a full URL.

---

## Known Gaps

| Gap | Status | Priority |
|-----|--------|----------|
| AI Gateway routing | Configured (`AI_GATEWAY_URL` set) but untested in this audit | Medium |
| Streaming responses | Not implemented — all workflows return final result | Low |
| D1 + Cron vs Workflows | Using Workflows (correct path) — D1 used for tracking only | N/A |
| OAuth token freshness | Gemini OAuth at `~/.gemini/oauth_creds.json` — not validated | Medium |
| On-prem runners DOWN | claude-runner (502), gemini-runner (conn refused), vLLM (502) | **High** |
| Sandbox fallback active | sandbox-executor is healthy and receiving code execution tasks | Info |

---

## Priority Fixes

1. **HIGH — Restart on-prem runners**: `docker restart claude-runner gemini-runner` and verify tunnels recover. vLLM may need `docker compose up -d` separately.
2. **MEDIUM — Validate Gemini OAuth**: Check if `~/.gemini/oauth_creds.json` tokens are still valid. Use reauth UI at reauth.shiftaltcreate.com if needed.
3. **MEDIUM — Test AI Gateway path**: Send a text-generation request and verify it routes through `gateway.ai.cloudflare.com`.
4. **LOW — Monitor deprecation logs**: Check worker logs for `[DEPRECATION]` entries to identify remaining legacy callers.

---

## Intake Worker Reroute

The intake worker (`intake.distributedelectrons.com`) was wired to bypass the broken RequestRouter DO and reroute all non-workflow requests through PrimeWorkflow via `/execute`.

### Changes Made

| File | Action |
|------|--------|
| `workers/intake/intake-reroute.ts` | Created: reroute handler with D1 tracking + callback polling |
| `workers/intake/index.ts` | Modified: replaced RequestRouter DO call with `handleIntakeReroute` |
| `workers/intake/types.ts` | Modified: added `DE_WORKFLOWS_URL`, `PASSPHRASE` to Env |
| `workers/intake/wrangler.toml` | Modified: added `DE_WORKFLOWS_URL` env var |
| D1 `intake_reroute_tracking` table | Created with indexes on `app_id` and `status` |

### Intake Smoke Tests (5/5 PASS)

| # | Test | Expected | Actual | Status |
|---|------|----------|--------|--------|
| 1 | Text via intake | 202 + `redirected: true` | 202 + redirected + deprecation | PASS |
| 2 | Image via intake | 202 + `redirected: true` | 202 + redirected + deprecation | PASS |
| 3 | Code via intake | 202 + direct CodeExecutionWorkflow | 202 + `workflow_name: code-execution-workflow` | PASS |
| 4 | Missing query | 400 | 400 `Query is required` | PASS |
| 5 | Invalid JSON | 400 | 400 `Invalid JSON body` | PASS |

### What's Preserved

- Video, code, and product-shipping requests still route directly to their respective workflows
- D1 `requests` table tracking still works for all paths
- CORS, status polling, and cancel endpoints unchanged
- RequestRouter DO binding kept in wrangler.toml (not called)

### D1 Tracking Verified

Both rerouted requests appear in `intake_reroute_tracking` with correct `app_id`, `task_type`, `execution_id`, and `status`.

---

## Deploy Details

### de-workflows
- **Version ID**: `408997bf-119d-437e-a49d-a4ead102a3f8`
- **Deployed**: 2026-02-07T17:35Z
- **Upload size**: 135.19 KiB (25.27 KiB gzipped)

### intake
- **Version ID**: `8a00317e-d7ae-480c-9533-0e1889dddb5c`
- **Deployed**: 2026-02-07T19:30Z
- **Upload size**: 26.05 KiB (5.99 KiB gzipped)
- **Custom domain**: intake.distributedelectrons.com
