# Model Waterfall Implementation

This document describes the model waterfall enhancement to the Distributed Electrons workflow system, enabling configurable multi-model execution with time-based priority overrides.

## Overview

The model waterfall feature allows Nexus and other clients to specify:
- **Specific models** (e.g., "claude-opus-4.5", "gemini-2.0-flash-exp") instead of generic "claude"/"gemini"
- **Prioritized fallback order** - try models in sequence until one succeeds
- **Time-based overrides** - temporarily change model priority for testing or cost optimization

## Architecture Changes

### 1. Enhanced Type Definitions

**IntakePayload** (`workers/intake/types.ts:102-114`):
```typescript
interface IntakePayload {
  // ... existing fields ...

  // NEW: Model-specific routing
  model_waterfall?: string[];        // e.g., ["gemini-2.0-flash-exp", "claude-sonnet-4.5"]
  primary_model?: string;            // Shorthand for single model

  // NEW: Time-based overrides
  override_until?: string;           // ISO timestamp
  override_waterfall?: string[];     // Temporary waterfall order

  // DEPRECATED: Use model_waterfall or primary_model instead
  executor?: 'claude' | 'gemini';
}
```

**CodeExecutionParams** (`workers/workflows/types.ts:170-194`):
```typescript
interface CodeExecutionParams {
  task_id: string;
  prompt: string;
  repo_url?: string;

  // NEW: Waterfall support
  model_waterfall?: string[];

  // DEPRECATED
  preferred_executor?: 'claude' | 'gemini';

  // ... other fields ...
}
```

**ExecutionResult** (`workers/workflows/types.ts:210-223`):
```typescript
interface ExecutionResult {
  success: boolean;
  task_id: string;
  executor: string;              // Model name (e.g., "claude-sonnet-4.5")
  output?: string;
  error?: string;

  // NEW: Waterfall metadata
  waterfall_position?: number;   // Which position succeeded (0-indexed)
  attempted_models?: string[];   // All models that were tried

  // ... other fields ...
}
```

### 2. Model-to-Runner Mapping

**New file**: `workers/workflows/lib/model-mapping.ts`

Provides:
- **Model configurations** - Maps model names to runner endpoints
- **Waterfall selection logic** - Determines effective waterfall from request parameters
- **Legacy compatibility** - Converts old `executor: 'claude'` to modern waterfall

**Supported Models**:

| Model Name | Runner | API Model | Use Case |
|------------|--------|-----------|----------|
| `claude-opus-4.5` | claude-runner:8789 | `claude-opus-4-5-20251101` | Highest capability |
| `claude-sonnet-4.5` | claude-runner:8789 | `claude-sonnet-4-5-20250929` | Balanced (default) |
| `claude-haiku-4` | claude-runner:8789 | `claude-haiku-4-20250514` | Fast/cheap |
| `gemini-2.0-flash-exp` | gemini-runner:8790 | `gemini-2.0-flash-exp` | Latest experimental |
| `gemini-2.0-flash-thinking-exp` | gemini-runner:8790 | `gemini-2.0-flash-thinking-exp-01-21` | Reasoning tasks |
| `gemini-1.5-pro` | gemini-runner:8790 | `gemini-1.5-pro` | Stable production |
| `glm-4-7b` | vllm:8000 | `glm-4-7b` | Local inference |

**Default Waterfall** (configurable via `DEFAULT_MODEL_WATERFALL`):
1. `claude-sonnet-4.5` - Balanced capability/cost
2. `gemini-2.0-flash-exp` - Fast alternative
3. `claude-opus-4.5` - Powerful fallback
4. `glm-4-7b` - Local fallback

### 3. PrimeWorkflow Changes

**File**: `workers/workflows/PrimeWorkflow.ts:444-471`

**What changed**:
- Added waterfall selection logic before creating CodeExecutionWorkflow
- Uses `determineWaterfall()` to select effective waterfall based on:
  1. Time-based override (if not expired)
  2. `model_waterfall` parameter
  3. `primary_model` parameter
  4. Legacy `executor` parameter
  5. Default waterfall from environment

**Example**:
```typescript
// Determine effective waterfall for code execution
const defaultWaterfall = parseDefaultWaterfall(this.env.DEFAULT_MODEL_WATERFALL);
const waterfall = determineWaterfall({
  model_waterfall: params.model_waterfall,
  primary_model: params.primary_model,
  preferred_executor: params.hints?.provider === 'gemini' ? 'gemini' : 'claude',
  override_until: params.override_until,
  override_waterfall: params.override_waterfall,
  default_waterfall: defaultWaterfall,
});

console.log(`[PrimeWorkflow] Code execution waterfall: ${waterfall.join(' → ')}`);
```

### 4. CodeExecutionWorkflow Changes

**File**: `workers/workflows/CodeExecutionWorkflow.ts:173-274`

**What changed**:
- Replaced single executor execution with waterfall loop
- Each model tried in sequence with retries (2 attempts, 30s delay, exponential backoff)
- Tracks which models were attempted
- Returns waterfall position on success

**Execution Flow**:
```typescript
for (let i = 0; i < waterfall.length; i++) {
  const model = waterfall[i];

  try {
    // Try this model with retries
    result = await step.do(`execute-model-${i}`, { retries: 2 }, async () => {
      return await this.executeWithModel(task_id, prompt, repo_url, model, timeout_ms);
    });

    // Success! Record position and break
    waterfallPosition = i;
    break;
  } catch (error) {
    // Classify error
    const classification = classifyError(error);

    if (classification.action === 'quarantine') {
      // Stop immediately - don't try more models
      break;
    }

    // Otherwise continue to next model
  }
}
```

**Error Classification**:
- `quarantine` - Stop waterfall immediately (auth errors, invalid input, false positives)
- `retry` - Continue to next model (rate limits, transient errors)
- `try-fallback` - Continue to next model (runner unreachable, timeouts)

### 5. Enhanced Callback Response

**File**: `workers/workflows/CodeExecutionWorkflow.ts:541-552`

**Callback payload now includes**:
```typescript
{
  task_id: string;
  status: 'completed' | 'failed' | 'quarantined';
  executor: string;              // Specific model (e.g., "claude-sonnet-4.5")
  output?: string;
  error?: string;
  duration_ms: number;
  timestamp: string;

  // NEW: Waterfall metadata
  waterfall_position?: number;   // Which position succeeded (0-indexed)
  attempted_models?: string[];   // All models tried (e.g., ["gemini-2.0-flash-exp", "claude-sonnet-4.5"])
}
```

## Configuration

**wrangler.toml** (`workers/workflows/wrangler.toml:82-84`):
```toml
# Default model waterfall for code execution (comma-separated model names)
# Order: Claude Sonnet (balanced) → Gemini Flash (fast) → Claude Opus (powerful) → GLM-4 (local)
DEFAULT_MODEL_WATERFALL = "claude-sonnet-4.5,gemini-2.0-flash-exp,claude-opus-4.5,glm-4-7b"
```

**Environment Variable**:
```bash
# Override at deployment time
wrangler deploy --var DEFAULT_MODEL_WATERFALL:"gemini-2.0-flash-exp,claude-opus-4.5,glm-4-7b"
```

## Usage Examples

### Example 1: Custom Waterfall from Nexus

```typescript
// POST https://intake.distributedelectrons.com/intake
{
  query: "Implement user authentication with JWT",
  task_type: "code",
  task_id: "task-123",
  repo_url: "https://github.com/owner/repo",
  callback_url: "https://nexus-mcp.solamp.workers.dev/workflow-callback",

  // NEW: Custom waterfall (try Gemini first, then Claude)
  model_waterfall: [
    "gemini-2.0-flash-exp",
    "claude-sonnet-4.5",
    "claude-opus-4.5"
  ]
}
```

**Result**:
1. Tries `gemini-2.0-flash-exp` with 2 retries
2. If fails → tries `claude-sonnet-4.5` with 2 retries
3. If fails → tries `claude-opus-4.5` with 2 retries
4. If all fail → quarantines with `executor: "ALL_RUNNERS_FAILED"`

### Example 2: Time-Based Override (Gemini Testing)

```typescript
// POST https://intake.distributedelectrons.com/intake
{
  query: "Fix bug in payment processing",
  task_type: "code",
  task_id: "task-456",
  repo_url: "https://github.com/owner/repo",
  callback_url: "https://nexus-mcp.solamp.workers.dev/workflow-callback",

  // NEW: Temporary override (use Gemini for 8 hours)
  override_until: "2025-12-31T08:00:00Z",
  override_waterfall: [
    "gemini-2.0-flash-exp",
    "claude-sonnet-4.5",
    "claude-opus-4.5",
    "glm-4-7b"
  ]
}
```

**Behavior**:
- Before `2025-12-31T08:00:00Z`: Uses override waterfall (Gemini first)
- After expiry: Reverts to default waterfall (Claude first)

### Example 3: Single Model Preference

```typescript
// POST https://intake.distributedelectrons.com/intake
{
  query: "Generate API documentation",
  task_type: "code",
  task_id: "task-789",
  repo_url: "https://github.com/owner/repo",

  // NEW: Only use Claude Opus (no fallback)
  primary_model: "claude-opus-4.5"
}
```

**Behavior**:
- Only tries `claude-opus-4.5` (no other models)
- If fails → quarantines immediately

### Example 4: Legacy Compatibility

```typescript
// POST https://intake.distributedelectrons.com/intake
{
  query: "Refactor database queries",
  task_type: "code",
  task_id: "task-000",
  repo_url: "https://github.com/owner/repo",

  // DEPRECATED: Still works, converted to waterfall internally
  executor: "gemini"
}
```

**Converted to**:
```typescript
model_waterfall: ["gemini-2.0-flash-exp", "claude-sonnet-4.5", "claude-opus-4.5"]
```

## Callback Response Examples

### Success (First Model)

```json
{
  "task_id": "task-123",
  "status": "completed",
  "executor": "gemini-2.0-flash-exp",
  "output": "✅ Implementation complete...",
  "duration_ms": 45000,
  "timestamp": "2025-12-30T12:00:00Z",
  "waterfall_position": 0,
  "attempted_models": ["gemini-2.0-flash-exp"]
}
```

### Success (Fallback Model)

```json
{
  "task_id": "task-456",
  "status": "completed",
  "executor": "claude-sonnet-4.5",
  "output": "✅ Bug fixed...",
  "duration_ms": 120000,
  "timestamp": "2025-12-30T12:05:00Z",
  "waterfall_position": 1,
  "attempted_models": ["gemini-2.0-flash-exp", "claude-sonnet-4.5"]
}
```

### Failure (All Models Exhausted)

```json
{
  "task_id": "task-789",
  "status": "quarantined",
  "executor": "ALL_RUNNERS_FAILED",
  "error": "All models in waterfall failed: gemini-2.0-flash-exp, claude-sonnet-4.5, claude-opus-4.5, glm-4-7b",
  "duration_ms": 0,
  "timestamp": "2025-12-30T12:10:00Z",
  "attempted_models": ["gemini-2.0-flash-exp", "claude-sonnet-4.5", "claude-opus-4.5", "glm-4-7b"]
}
```

## Retry Strategy

**Per-model retry**:
- Retries: 2 attempts
- Delay: 30 seconds
- Backoff: Exponential (30s, 60s)
- Timeout: Configurable (default: 300000ms = 5 minutes)

**Total attempts** (for 4-model waterfall):
- Gemini Flash: 3 attempts (1 initial + 2 retries)
- Claude Sonnet: 3 attempts
- Claude Opus: 3 attempts
- GLM-4: 3 attempts
- **Total**: Up to 12 execution attempts before giving up

## Error Handling

### Quarantine Errors (Stop Immediately)
- Invalid input
- Authentication failures
- False positives (AI claims success but output shows failure)
- Output too short (< 100 chars)

### Retry Errors (Continue to Next Model)
- Rate limits (429)
- Server overloaded (503)
- Timeouts
- Runner unreachable

### Example: False Positive Detection

If any model returns output containing failure indicators:
```
"couldn't find", "file not found", "failed to", etc.
```

The workflow:
1. Detects the false positive
2. Quarantines immediately (doesn't try more models)
3. Returns error: `"FALSE_POSITIVE: AI reported success but output contains failure indicator"`

## Testing

### Test 1: Basic Waterfall

**Request**:
```bash
curl -X POST https://intake.distributedelectrons.com/intake \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Add unit tests for user authentication",
    "task_type": "code",
    "task_id": "test-waterfall-1",
    "repo_url": "https://github.com/test/repo",
    "model_waterfall": ["gemini-2.0-flash-exp", "claude-sonnet-4.5"]
  }'
```

**Expected**:
- Tries Gemini first
- If fails → tries Claude Sonnet
- Returns `executor: "gemini-2.0-flash-exp"` or `"claude-sonnet-4.5"`
- Returns `waterfall_position: 0` or `1`

### Test 2: Time-Based Override

**Request** (override expires in 8 hours):
```bash
curl -X POST https://intake.distributedelectrons.com/intake \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Optimize database indexes",
    "task_type": "code",
    "task_id": "test-override-1",
    "repo_url": "https://github.com/test/repo",
    "override_until": "2025-12-31T20:00:00Z",
    "override_waterfall": ["gemini-2.0-flash-exp", "claude-opus-4.5"]
  }'
```

**Expected (before expiry)**:
- Uses override waterfall: Gemini → Claude Opus

**Expected (after expiry)**:
- Uses default waterfall: Claude Sonnet → Gemini → Claude Opus → GLM-4

### Test 3: Legacy Compatibility

**Request**:
```bash
curl -X POST https://intake.distributedelectrons.com/intake \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Deploy to production",
    "task_type": "code",
    "task_id": "test-legacy-1",
    "repo_url": "https://github.com/test/repo",
    "executor": "claude"
  }'
```

**Expected**:
- Converts to waterfall: `["claude-sonnet-4.5", "gemini-2.0-flash-exp", "claude-opus-4.5"]`
- Returns `executor: "claude-sonnet-4.5"` (or another model if fallback)

## Deployment

### 1. Deploy Workflows Worker

```bash
cd workers/workflows
bunx wrangler deploy
```

### 2. Verify Configuration

```bash
# Check environment variables
bunx wrangler tail de-workflows --format pretty

# Look for log:
# [PrimeWorkflow] Code execution waterfall: claude-sonnet-4.5 → gemini-2.0-flash-exp → claude-opus-4.5 → glm-4-7b
```

### 3. Test with Nexus

```bash
# From Nexus, dispatch a task with custom waterfall
curl -X POST https://nexus-mcp.solamp.workers.dev/tasks \
  -H "X-Passphrase: $NEXUS_PASSPHRASE" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "[implement] Add email verification",
    "description": "Implement email verification flow with token-based validation",
    "status": "next",
    "auto_dispatch": true,
    "model_waterfall": ["gemini-2.0-flash-exp", "claude-sonnet-4.5"]
  }'
```

## Migration Notes

### Backwards Compatibility

✅ **Fully backwards compatible**:
- Old `executor: 'claude'` still works (converted to waterfall internally)
- Existing Nexus tasks continue to work without changes
- Default behavior unchanged (Claude Sonnet first)

### Deprecation Timeline

- **Phase 1** (current): `executor` parameter supported, but deprecated
- **Phase 2** (future): Update Nexus to use `model_waterfall` exclusively
- **Phase 3** (6 months): Remove `executor` parameter support

## Performance Considerations

### Latency Impact

**Best case** (first model succeeds):
- No additional latency (same as before)

**Worst case** (all models fail):
- 4 models × 3 attempts × 60s max delay = up to 12 minutes
- Mitigated by: Exponential backoff, quick failure detection

### Cost Impact

**Reduced costs** with smart routing:
- Use Gemini Flash (cheaper) for simple tasks
- Only fall back to Claude Opus for complex tasks
- Use GLM-4 (free local) as ultimate fallback

**Example cost savings**:
- Gemini Flash: $0.00015/1K tokens (input), $0.0006/1K tokens (output)
- Claude Sonnet: $0.003/1K tokens (input), $0.015/1K tokens (output)
- **Savings**: ~95% if Gemini succeeds first

## Monitoring

### Key Metrics to Track

1. **Waterfall position distribution**:
   - How often does first model succeed?
   - Which position is most common?

2. **Model success rates**:
   - Which model has highest success rate?
   - Which models fail most often?

3. **Fallback frequency**:
   - How often does waterfall reach 2nd, 3rd, 4th model?

4. **Cost per task**:
   - Average cost with waterfall vs. single model

### Example Log Analysis

```bash
# Count waterfall positions
bunx wrangler tail de-workflows --format json | \
  jq -r 'select(.message | contains("succeeded (position")) | .message' | \
  grep -oP 'position \K\d+' | \
  sort | uniq -c

# Output:
# 1245 0  (first model succeeded)
#  156 1  (second model succeeded)
#   23 2  (third model succeeded)
#    4 3  (fourth model succeeded)
```

## Troubleshooting

### Issue: All Models Failing

**Symptoms**:
- Callback returns `executor: "ALL_RUNNERS_FAILED"`
- All models in `attempted_models` array

**Diagnosis**:
```bash
# Check runner health
curl https://claude-runner.shiftaltcreate.com/health
curl https://gemini-runner.shiftaltcreate.com/health
curl https://vllm.shiftaltcreate.com/health

# Check sandbox-executor logs
bunx wrangler tail sandbox-executor --format pretty
```

**Solutions**:
- Verify runner authentication (RUNNER_SECRET, GEMINI_RUNNER_SECRET)
- Check Cloudflare Tunnel status
- Verify quota/rate limits not exceeded

### Issue: Override Not Expiring

**Symptoms**:
- Still using override waterfall after `override_until` timestamp

**Diagnosis**:
```bash
# Check server time
curl https://intake.distributedelectrons.com/time

# Verify override_until is ISO 8601 format
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

**Solutions**:
- Ensure `override_until` is in UTC (trailing 'Z')
- Verify server clock is accurate

### Issue: Waterfall Position Always 0

**Symptoms**:
- `waterfall_position: 0` for all tasks
- First model always succeeds

**Diagnosis**:
- This is actually **good** - means first model is reliable
- No action needed unless you want to test fallback behavior

**Testing fallback**:
```typescript
// Temporarily break first model to test fallback
model_waterfall: [
  "invalid-model-name",  // Will fail immediately
  "claude-sonnet-4.5"    // Should succeed
]
```

## Files Changed

1. **workers/intake/types.ts** - Added model_waterfall, primary_model, override fields to IntakePayload
2. **workers/workflows/types.ts** - Added waterfall fields to CodeExecutionParams, ExecutionResult, PrimeEnv
3. **workers/workflows/lib/model-mapping.ts** - NEW: Model-to-runner mapping and waterfall selection
4. **workers/workflows/PrimeWorkflow.ts** - Added waterfall selection logic
5. **workers/workflows/CodeExecutionWorkflow.ts** - Replaced single executor with waterfall loop
6. **workers/workflows/wrangler.toml** - Added DEFAULT_MODEL_WATERFALL configuration

## Summary

The model waterfall implementation provides:

✅ **Flexibility** - Choose specific models instead of generic "claude"/"gemini"
✅ **Reliability** - Automatic fallback if primary model fails
✅ **Cost optimization** - Use cheaper models first, powerful models as fallback
✅ **Testing support** - Time-based overrides for experimentation
✅ **Backwards compatibility** - Legacy `executor` parameter still works
✅ **Observability** - Track which models succeeded and at what position

This enables Nexus to intelligently route tasks based on:
- **Cost** (use Gemini Flash for simple tasks)
- **Capability** (use Claude Opus for complex reasoning)
- **Availability** (fall back if primary runner is down)
- **Testing** (temporarily prioritize specific models)
