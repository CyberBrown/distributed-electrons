# Distributed Electrons - Project Overview

A multi-agent AI platform built on Cloudflare Workers infrastructure.

**Live Domain**: https://distributedelectrons.com

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    distributedelectrons.com                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  FRONTENDS (Cloudflare Pages)                                   │
│  ├── admin.distributedelectrons.com      → Admin Panel          │
│  ├── monitoring.distributedelectrons.com → Metrics Dashboard    │
│  ├── testing.distributedelectrons.com    → Image Gen Testing    │
│  └── text-testing.distributedelectrons.com → Text Gen Testing   │
│                                                                 │
│  BACKENDS (Cloudflare Workers)                                  │
│  ├── api.distributedelectrons.com        → Config Service       │
│  ├── images.distributedelectrons.com     → Image Generation     │
│  ├── text-gen.solamp.workers.dev         → Text Generation      │
│  ├── audio-gen.solamp.workers.dev        → Audio Generation     │
│  ├── stock-media.solamp.workers.dev      → Stock Media Search   │
│  └── render-service.solamp.workers.dev   → Video Rendering      │
│                                                                 │
│  STORAGE & STATE                                                │
│  ├── D1 Database    → instances, users, projects, model_configs │
│  ├── KV Namespace   → caching                                   │
│  ├── R2 Buckets     → de-audio-storage, de-render-storage       │
│  └── Durable Objects → rate limiting (shared)                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Services

| Service | URL | Status | Description |
|---------|-----|--------|-------------|
| Config Service | api.distributedelectrons.com | ✅ Live | Central config, auth, model management |
| Image Gen | images.distributedelectrons.com | ✅ Live | Multi-provider image generation (dynamic) |
| Text Gen | text-gen.solamp.workers.dev | ✅ Live | Multi-provider text generation (dynamic) |
| Audio Gen | audio-gen.solamp.workers.dev | ✅ Live | ElevenLabs text-to-speech |
| Stock Media | stock-media.solamp.workers.dev | ✅ Live | Pexels stock videos/images |
| Render Service | render-service.solamp.workers.dev | ✅ Live | Shotstack video rendering |
| Admin Panel | admin.distributedelectrons.com | ✅ Live | Instance/user/model management |
| Monitoring | monitoring.distributedelectrons.com | ✅ Live | Real-time metrics dashboard |
| Image Testing | testing.distributedelectrons.com | ✅ Live | Test image generation |
| Text Testing | text-testing.distributedelectrons.com | ✅ Live | Test text generation |

---

## Project Structure

```
cloudflare-multiagent-system/
├── infrastructure/
│   ├── config-service/     # Central API (D1 + KV)
│   ├── database/           # D1 schema, migrations & seed files
│   ├── auth/               # Authentication middleware
│   └── lookup/             # Instance resolution
├── workers/
│   ├── image-gen/          # Image generation (multi-provider)
│   ├── text-gen/           # Text generation (multi-provider)
│   ├── audio-gen/          # Audio generation (ElevenLabs)
│   ├── stock-media/        # Stock media search (Pexels)
│   ├── render-service/     # Video rendering (Shotstack)
│   └── shared/
│       ├── provider-adapters/  # Ideogram, OpenAI, Anthropic, ElevenLabs
│       ├── rate-limiter/       # Durable Object rate limiter
│       ├── r2-manager/         # R2 storage utilities
│       └── utils/              # Payload mapper, helpers
├── interfaces/
│   ├── admin-panel/        # React admin UI
│   ├── monitoring/         # React metrics dashboard
│   ├── testing-gui/        # Image gen testing (dynamic model loading)
│   └── text-testing-gui/   # Text gen testing (dynamic model loading)
├── scripts/                # Deployment automation
└── docs/                   # Specifications
```

---

## Current Status: ~95% Complete

### What's Working
- ✅ All 7 Workers deployed and responding (config, image-gen, text-gen, audio-gen, stock-media, render-service, rate-limiter)
- ✅ All 4 Interfaces deployed with custom domains
- ✅ D1 database with full schema and 10 seeded model configs
- ✅ Dynamic model config integration in workers
- ✅ Dynamic model loading in testing GUIs
- ✅ Rate limiting via Durable Objects
- ✅ R2 storage for generated content (images, audio, renders)
- ✅ Admin Panel with model configuration UI
- ✅ CI/CD via GitHub Actions (all workers included)

### Model Configs in Database
| Provider | Models |
|----------|--------|
| Anthropic | Claude 3.5 Sonnet, Claude 3.5 Haiku |
| OpenAI | GPT-4o, GPT-4o-mini, DALL-E 3, DALL-E 2 |
| Ideogram | Ideogram V2 |
| Gemini | Veo 3.1, Flash Nano Banana |
| ElevenLabs | Multilingual V2 |

### What's Remaining
- Set up custom DNS for new workers (audio, media, render, text)
- Add OPENAI_API_KEY to text-gen worker (optional, for OpenAI support)
- Production testing of dynamic model config system
- Implement streaming responses for text generation (future)

---

## Recent Updates (December 2024)

### Dynamic Model Config Integration
- **Image Gen Worker**: Now accepts `model_id` parameter, fetches config from Config Service, uses payload mapper for provider-agnostic requests
- **Text Gen Worker**: Supports both new `model_id` and legacy `model: "provider:model-name"` formats with backwards compatibility
- **Testing GUIs**: Dynamically load available models from Config Service with fallback to hardcoded defaults

### New Workers Added
- **audio-gen**: ElevenLabs text-to-speech (R2 storage: de-audio-storage)
- **stock-media**: Pexels API for stock videos/images
- **render-service**: Shotstack video rendering (R2 storage: de-render-storage)

### CI/CD Updates
- GitHub Actions deploy.yml updated to include all 7 workers
- Rate limiter deployed as shared dependency

---

## Quick Commands

```bash
# Install dependencies
npm install

# Local development
npm run wrangler:dev

# Deploy all workers
npm run deploy-all

# Deploy single instance
npm run deploy-instance -- --config instances/production.json

# Run tests
npm test
```

---

## API Endpoints

### Config Service (api.distributedelectrons.com)
- `GET /health` - Health check
- `GET /instance/:id` - Get instance config
- `GET /model-config` - List model configurations (supports `?type=text|image`)
- `GET /model-config/:id` - Get specific model config
- `POST /model-config` - Create model config
- `PUT /model-config/:id` - Update model config
- `DELETE /model-config/:id` - Delete model config

### Image Gen (images.distributedelectrons.com)
- `POST /generate` - Generate image (accepts `model_id` for dynamic model selection)
- `GET /status/:id` - Check generation status
- `GET /health` - Health check

### Text Gen (text-gen.solamp.workers.dev)
- `POST /generate` - Generate text (accepts `model_id` or legacy `model: "provider:model"`)
- `GET /health` - Health check

### Audio Gen (audio-gen.solamp.workers.dev)
- `POST /synthesize` - Text-to-speech synthesis
- `GET /audio/:id.mp3` - Retrieve generated audio
- `GET /voices` - List available voices
- `GET /health` - Health check

### Stock Media (stock-media.solamp.workers.dev)
- `POST /search/videos` - Search stock videos
- `POST /search/images` - Search stock images
- `GET /health` - Health check

### Render Service (render-service.solamp.workers.dev)
- `POST /render` - Submit video render job
- `GET /render/:id` - Check render status
- `GET /health` - Health check

---

## Tech Stack

- **Compute**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2
- **Cache**: Cloudflare KV
- **State**: Cloudflare Durable Objects
- **Frontend**: React (Vite) + Static HTML/JS
- **CI/CD**: GitHub Actions
- **Language**: TypeScript

---

## Related Documentation

- `DEPLOYMENT_GUIDE.md` - Full deployment instructions
- `CUSTOM_DOMAIN_SETUP.md` - Domain configuration
- `MODEL_CONFIG_PROGRESS.md` - Model config system progress
- `AUTOMATION_GUIDE.md` - Automation scripts
