# DE Router Phase 2 Implementation Complete

## Files Created

### D1 Migrations
- `migrations/0001_router_schema.sql` - Database schema for providers, models, workflows
- `migrations/0002_seed_data.sql` - Initial data for providers and models

### Router Core
- `src/lib/router/types.ts` - All TypeScript interfaces
- `src/lib/router/registry.ts` - D1 database queries
- `src/lib/router/selector.ts` - Provider/model selection logic
- `src/lib/router/transformer.ts` - Prompt transformers per provider
- `src/lib/router/index.ts` - Main Router class

### Provider Adapters (AI Gateway Enabled)
All adapters route through Cloudflare AI Gateway when `CF_AIG_TOKEN` is configured:
- `adapters/anthropic.ts` - Claude API via AI Gateway
- `adapters/openai.ts` - OpenAI (text, image, audio, embeddings) via AI Gateway
- `adapters/spark.ts` - Nemotron/local models via AI Gateway custom provider
- `adapters/ideogram.ts` - Image generation via AI Gateway
- `adapters/elevenlabs.ts` - Text-to-speech via AI Gateway
- `adapters/replicate.ts` - FLUX, video models via AI Gateway

### Workflow Engine
- `workflows/engine.ts` - Multi-step workflow execution
- `workflows/templates.ts` - Built-in workflows (social-post, blog-with-image, etc.)

## New API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /v2/route` | Route request (simple or workflow) |
| `GET /v2/health` | Provider health status |
| `GET /v2/workflows` | List available workflows |
| `GET /v2/stats` | Router statistics |

---

## AI Gateway Integration

All providers route through Cloudflare AI Gateway (`de-gateway`):
- Gateway URL: `https://gateway.ai.cloudflare.com/v1/52b1c60ff2a24fb21c1ef9a429e63261/de-gateway`
- All provider API keys are managed via BYOK in AI Gateway
- Only `CF_AIG_TOKEN` secret is required in the Worker
- Request logging and analytics available in Cloudflare dashboard

### Prerequisites: Add Spark as Custom Provider in AI Gateway

Before deploying, add Spark Nemotron as a custom provider in AI Gateway:
1. Go to Cloudflare Dashboard > Compute & AI > AI Gateway
2. Select `de-gateway` > Custom Providers
3. Add Custom Provider:
   - Name: `Spark Nemotron`
   - Slug: `spark-local`
   - Base URL: `https://vllm.shiftaltcreate.com/v1`
   - Enabled: Yes

---

## Deployment Steps

```bash
cd /home/chris/projects/distributed-electrons/workers/text-gen

# 1. Login to Cloudflare
npx wrangler login

# 2. Create the D1 database (already done: database_id in wrangler.toml)
# npx wrangler d1 create de-router

# 3. Run migrations locally first (to test)
npx wrangler d1 execute de-router --local --file=migrations/0001_router_schema.sql
npx wrangler d1 execute de-router --local --file=migrations/0002_seed_data.sql

# 4. Verify local data
npx wrangler d1 execute de-router --local --command="SELECT id, name, priority FROM providers ORDER BY priority;"
npx wrangler d1 execute de-router --local --command="SELECT id, provider_id, worker_id FROM models LIMIT 10;"

# 5. Run migrations on remote
npx wrangler d1 execute de-router --remote --file=migrations/0001_router_schema.sql
npx wrangler d1 execute de-router --remote --file=migrations/0002_seed_data.sql

# 6. Add AI Gateway token (ONLY secret needed - BYOK handles provider keys)
npx wrangler secret put CF_AIG_TOKEN
# Enter your Cloudflare API token with AI Gateway permissions

# 7. Deploy
npx wrangler deploy
```

## Testing Examples

### Simple text generation
```bash
curl -X POST https://text.distributedelectrons.com/v2/route \
  -H "Content-Type: application/json" \
  -d '{
    "type": "simple",
    "worker": "text-gen",
    "prompt": "Write a haiku about coding",
    "constraints": { "min_quality": "standard" }
  }'
```

### Workflow request
```bash
curl -X POST https://text.distributedelectrons.com/v2/route \
  -H "Content-Type: application/json" \
  -d '{
    "type": "workflow",
    "workflow_id": "social-post",
    "variables": {
      "platform": "Twitter",
      "topic": "AI coding assistants"
    }
  }'
```

## Built-in Workflows

1. **social-post** - Generate social media copy + matching image
2. **blog-with-image** - Full blog article with featured image
3. **product-description** - SEO-optimized product descriptions
4. **podcast-script** - Podcast episode script with segments
5. **video-storyboard** - Video storyboard with thumbnail

## Provider Priority (configured in seed data)

1. spark-local (Nemotron) - Priority 1
2. anthropic - Priority 2
3. openai - Priority 3
4. google - Priority 4
5. ideogram (images) - Priority 1
6. replicate (FLUX/video) - Priority 2
7. elevenlabs (audio) - Priority 1
