# DE Workflows

Cloudflare Workflows for long-running operations in Distributed Electrons.

## Overview

This worker provides durable, crash-recoverable workflows for operations that take longer than typical Worker timeouts (e.g., video rendering, batch processing).

## Available Workflows

### VideoRenderWorkflow

Handles video rendering via Shotstack with automatic retries and crash recovery.

**Steps:**
1. `submit-to-shotstack` - Submit render job, get render_id (retry 3x, 30s timeout)
2. `poll-shotstack-completion` - Poll until done/failed (retry 120x @ 5s = 10 min max)
3. `update-d1-status` - Mark request completed in database
4. `notify-delivery` - Send result to Delivery Worker (best effort)
5. `send-callback` - Notify client if callback_url configured (best effort)

**Usage:**

Requests with `task_type: "video"` or a `timeline` field are automatically routed to this workflow by the Intake Worker.

```bash
curl -X POST https://intake.solamp.workers.dev/intake \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Render my video",
    "task_type": "video",
    "timeline": {
      "tracks": [{
        "clips": [{
          "asset": {
            "type": "video",
            "src": "https://example.com/video.mp4"
          },
          "start": 0,
          "length": 10
        }]
      }]
    },
    "output": {
      "format": "mp4",
      "resolution": "hd"
    },
    "callback_url": "https://your-app.com/webhook"
  }'
```

**Response:**
```json
{
  "success": true,
  "request_id": "uuid",
  "status": "processing",
  "workflow_instance_id": "uuid",
  "workflow_name": "video-render-workflow"
}
```

## Configuration

### Environment Variables (wrangler.toml)
- `DELIVERY_URL` - URL of Delivery Worker for completion notifications
- `SHOTSTACK_ENV` - "stage" or "v1" for Shotstack environment

### Secrets (wrangler secret put)
- `SHOTSTACK_API_KEY` - Shotstack API key

### Bindings
- `DB` - D1 database for request tracking
- `VIDEO_RENDER_WORKFLOW` - Workflow binding

## Deployment

```bash
cd workers/workflows

# Deploy workflow worker
CLOUDFLARE_API_TOKEN=xxx npx wrangler deploy

# Set Shotstack API key
echo "your-key" | CLOUDFLARE_API_TOKEN=xxx npx wrangler secret put SHOTSTACK_API_KEY
```

## Monitoring

Check workflow status:
```bash
npx wrangler workflows instances describe video-render-workflow <instance-id>
```

List running workflows:
```bash
npx wrangler workflows instances list video-render-workflow
```

## Architecture

```
Client Request
      │
      ▼
┌─────────────────┐
│  Intake Worker  │──── task_type != video ───► Request Router DO
│                 │
└────────┬────────┘
         │ task_type = video
         ▼
┌─────────────────────────────────────────────────────────────┐
│                   VideoRenderWorkflow                        │
├─────────────────────────────────────────────────────────────┤
│  Step 1: Submit to Shotstack ──► Get render_id              │
│  Step 2: Poll for completion ──► Retry until done           │
│  Step 3: Update D1 ──► Mark completed, create deliverable   │
│  Step 4: Notify Delivery Worker ──► HTTP POST               │
│  Step 5: Send callback ──► Webhook to client                │
└─────────────────────────────────────────────────────────────┘
```

## Future Workflows

Planned additions:
- `BatchProcessWorkflow` - Process multiple items with per-item isolation
- `FallbackChainWorkflow` - Multi-provider resilience (Anthropic → OpenAI → Gemini)
- `HumanApprovalWorkflow` - Cost control gates for expensive operations
