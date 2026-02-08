# DE Routing Architecture

## Three Pillars

1. **Technical Calls** -- AI Gateway (all LLM calls routed through Cloudflare)
2. **Routing Intelligence** -- Waterfall routing (Spark local -> cloud fallback)
3. **Prompt Library** -- (Phase 3)

## Waterfall Flow

```
Request arrives at PrimeWorkflow
         |
         v
1. Classify task type + routing metadata
   - taskType: code | text | image | audio | video
   - routingMode: realtime | batch
   - localPreferred: true/false (has Spark equivalent?)
         |
         v
2. Route to sub-workflow (e.g., TextGenerationWorkflow)
         |
         v
3. Check Spark availability (3s timeout)
   - Calls Spark Gateway /available/{service_type}
   - Returns: use_local | use_cloud | queue
         |
    +----+----+
    |         |
    v         v
use_local   use_cloud
    |         |
    v         v
4a. Promote   4b. Skip
    Nemotron      Nemotron,
    to top of     go straight
    waterfall     to cloud
         |
         v
5. Execute provider waterfall
   - Try each provider in order
   - Skip unavailable ones
   - Break on first success
         |
         v
6. Return result + callback
```

## Endpoints

### Core
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/execute` | POST | Submit a request (main entry point, triggers PrimeWorkflow) |
| `/status/:id` | GET | Poll request status |
| `/health` | GET | Worker health check |

### Queue & Monitoring
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/queue/stats` | GET | DE workflow queue depth (running/queued per workflow) |
| `/spark/status` | GET | Spark GPU + service status (proxied through DE) |
| `/spark/available/:type` | GET | Check Spark availability for a service type |

### Deprecated (gracefully rerouted to PrimeWorkflow)
- `POST /workflows/code-execution`
- `POST /workflows/text-generation`
- `POST /workflows/image-generation`
- `POST /workflows/audio-generation`

## Spark Gateway

FastAPI service running on DGX Spark (GB10 128GB unified VRAM), exposed via Cloudflare Tunnel.

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Gateway health check |
| `GET /gpu` | GPU utilization, temperature, power, processes |
| `GET /services` | All registered services with container/health status |
| `GET /services/{name}` | Single service status |
| `GET /available/{type}` | Availability check for waterfall routing |

### Service Registry

| Service | Type | Container | Port | Description |
|---------|------|-----------|------|-------------|
| nemotron | llm | vllm-nemotron | 8000 | Nemotron via vLLM |
| comfyui | image-generation | comfyui-optimized | 8188 | ComfyUI |
| claude-runner | code-runner | claude-runner | 8789 | Claude Code agent |
| gemini-runner | code-runner | gemini-runner | 8790 | Gemini agent |

### Availability Response

```json
{
  "available": true,
  "service": "nemotron",
  "reason": "nemotron is running and healthy (45.2ms)",
  "gpu_memory_free_mb": 120000,
  "gpu_utilization_pct": 15,
  "recommendation": "use_local"
}
```

Recommendations:
- `use_local` -- service is healthy, route to Spark
- `use_cloud` -- service unavailable, route through AI Gateway
- `queue` -- service busy but can wait (future batch support)

## Provider Waterfall (TextGenerationWorkflow)

Default order:
1. z.ai (GLM-4.7) -- primary cloud LLM
2. claude-runner (Spark) -- if idle
3. gemini-runner (Spark) -- if idle
4. nemotron (Spark vLLM) -- if healthy
5. Anthropic API -- via AI Gateway
6. Gemini API -- via AI Gateway
7. OpenAI API -- via AI Gateway
8. Workers AI -- Cloudflare serverless

With Spark Gateway intelligence:
- `use_local` -- nemotron promoted to position #1
- `use_cloud` -- nemotron removed entirely (saves timeout)

## Classification Metadata

PrimeWorkflow enriches task classification with routing-relevant metadata:

| Field | Values | Purpose |
|-------|--------|---------|
| `taskType` | code, text, image, audio, video | Determines sub-workflow |
| `routingMode` | realtime, batch | Batch tasks can wait for Spark |
| `localPreferred` | true/false | Whether task has Spark equivalent |
| `cloudProviders` | string[] | Ranked cloud fallback providers |

## Configuration

### Environment Variables (wrangler.toml)
- `SPARK_GATEWAY_URL` -- Cloudflare Tunnel URL for Spark Gateway
- `AI_GATEWAY_URL` -- Cloudflare AI Gateway URL
- `SPARK_VLLM_URL` -- Direct vLLM endpoint (legacy, used by runner health checks)

### Secrets
- `CF_AIG_TOKEN` -- AI Gateway BYOK authentication
- `CF_ACCOUNT_TOKEN` -- Cloudflare API token for queue stats
- `ZAI_API_KEY` -- z.ai direct API key (not routed through Gateway)

## Tunnel Setup

Spark Gateway requires a Cloudflare Tunnel hostname:

1. In Cloudflare dashboard: Zero Trust > Networks > Tunnels
2. Select the Spark tunnel (ID: `5b61e514-...`)
3. Add public hostname: `spark-gateway.shiftaltcreate.com` -> `http://localhost:8080`
4. Verify: `curl https://spark-gateway.shiftaltcreate.com/health`
