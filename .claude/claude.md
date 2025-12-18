# Distributed Electrons

Multi-agent AI platform on Cloudflare Workers providing API services for AI-powered applications.

## Repository

- **GitHub**: https://github.com/CyberBrown/distributed-electrons
- **Local Path**: /home/chris/distributed-electrons
- **Domain**: https://distributedelectrons.com

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Database**: D1 (SQLite)
- **Storage**: R2
- **Cache**: KV
- **State**: Durable Objects
- **CI/CD**: GitHub Actions
- **Language**: TypeScript
- **Testing**: Vitest

## Deployed Workers

| Worker | Provider | Live Endpoint | R2 Bucket |
|--------|----------|---------------|-----------|
| text-gen | Anthropic (claude-sonnet-4-20250514), OpenAI | https://text-gen.solamp.workers.dev | - |
| audio-gen | ElevenLabs | https://audio-gen.solamp.workers.dev | de-audio-storage |
| stock-media | Pexels | https://stock-media.solamp.workers.dev | - |
| render-service | Shotstack (sandbox) | https://render-service.solamp.workers.dev | de-render-storage |
| image-gen | Ideogram | https://image-gen.solamp.workers.dev | - |
| sandbox-executor | Claude, CF API, GitHub API | https://sandbox-executor.solamp.workers.dev | - |

### Cloudflare Secrets

All API keys are stored as Cloudflare Workers secrets:
```bash
# Set secrets for each worker
cd workers/text-gen && npx wrangler secret put ANTHROPIC_API_KEY
cd workers/audio-gen && npx wrangler secret put ELEVENLABS_API_KEY
cd workers/stock-media && npx wrangler secret put PEXELS_API_KEY
cd workers/render-service && npx wrangler secret put SHOTSTACK_API_KEY
cd workers/sandbox-executor && npx wrangler secret put ANTHROPIC_API_KEY
cd workers/sandbox-executor && npx wrangler secret put CLOUDFLARE_API_TOKEN
cd workers/sandbox-executor && npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
cd workers/sandbox-executor && npx wrangler secret put GITHUB_PAT
```

### Shared Infrastructure (workers/shared/)

- `provider-adapters` - Multi-provider abstraction
- `rate-limiter` - Durable Object for request throttling
- `r2-manager` - R2 storage operations
- `error-handling` - Standardized error responses
- `logging` - Structured logging
- `utils` - Common utilities

## API Reference

### Text Generation
```bash
POST https://text-gen.solamp.workers.dev/generate
Content-Type: application/json

{
  "prompt": "string",
  "model": "anthropic:claude-sonnet-4-20250514",  # or "openai:gpt-4o-mini"
  "options": { "max_tokens": 2000, "temperature": 0.7 }
}

# Response
{
  "success": true,
  "text": "...",
  "metadata": { "provider": "anthropic", "model": "...", "tokens_used": 123 }
}
```

### Audio Generation (Text-to-Speech)
```bash
POST https://audio-gen.solamp.workers.dev/synthesize
Content-Type: application/json

{
  "text": "string",
  "voice_id": "21m00Tcm4TlvDq8ikWAM",  # Rachel (default)
  "options": { "stability": 0.5, "similarity_boost": 0.75 }
}

# Response
{
  "success": true,
  "audio_url": "https://audio-gen.solamp.workers.dev/audio/{id}.mp3",
  "duration_seconds": 12.5
}

# Fetch audio file
GET https://audio-gen.solamp.workers.dev/audio/{id}.mp3
```

### Stock Media Search
```bash
POST https://stock-media.solamp.workers.dev/search/videos
Content-Type: application/json

{
  "keywords": ["nature", "sunset"],
  "orientation": "landscape",
  "options": { "per_page": 10, "min_duration": 5 }
}

# Response
{
  "success": true,
  "media": [
    { "id": "123", "type": "video", "url": "...", "duration": 15 }
  ]
}
```

### Video Render (Shotstack)
```bash
POST https://render-service.solamp.workers.dev/render
Content-Type: application/json

{
  "timeline": {
    "soundtrack": { "src": "audio_url", "effect": "fadeOut" },
    "tracks": [{ "clips": [...] }]
  },
  "output": { "format": "mp4", "resolution": "hd", "fps": 25 }
}

# Response
{ "success": true, "render_id": "uuid" }

# Check status
GET https://render-service.solamp.workers.dev/render/{render_id}

# Response when complete
{ "status": "done", "url": "https://s3...mp4" }
```

### Health Checks
All workers expose a health endpoint:
```bash
GET https://{worker}.solamp.workers.dev/health
# Response: { "status": "healthy", "service": "{worker}", "timestamp": "..." }
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Deploy a worker
cd workers/text-gen && npx wrangler deploy

# Check worker logs
npx wrangler tail text-gen

# List R2 bucket contents
npx wrangler r2 object get {bucket-name}/{key} --remote
```

## Adding New Workers

1. Create directory under `workers/`
2. Add `index.ts`, `types.ts`, `wrangler.toml`, `README.md`
3. Follow patterns from existing workers (text-gen is the reference)
4. Use shared utilities from `workers/shared/`
5. Deploy with `npx wrangler deploy`
6. Set required secrets with `npx wrangler secret put`

## Worker Architecture Notes

### audio-gen
- Stores audio files in R2 bucket `de-audio-storage`
- Serves audio via `/audio/{id}.mp3` route (self-hosted, not separate domain)
- Uses ElevenLabs v1 API with configurable voice settings

### render-service
- Uses Shotstack sandbox API (for production, switch to production API key)
- Polls for render completion with configurable timeout
- Stores render metadata in R2 bucket `de-render-storage`

### text-gen
- Supports multiple providers via `model` parameter format: `provider:model-name`
- Default model: `claude-sonnet-4-20250514` (Anthropic)
- Falls back to OpenAI if no provider specified

### sandbox-executor
- Executes Claude Code tasks and generates code
- Can auto-deploy generated workers to Cloudflare via CF API
- Can auto-commit generated code to GitHub via Git Data API
- Endpoints: `/execute`, `/deploy`, `/github/commit`, `/health`

## Related Projects

- **Living Arts** (`/home/chris/living-arts`) - Video production frontend that consumes these APIs

## Claude Code Notes

- Clone repos directly with `git clone`
- Both repos should be in `/home/chris/`
- Workers can be deployed independently
- Each worker has its own wrangler.toml
- Use `npx wrangler` (not bare `wrangler`) if wrangler not in PATH
