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
│  ├── text.distributedelectrons.com       → Text Generation      │
│  ├── audio.distributedelectrons.com      → Audio Generation     │
│  ├── media.distributedelectrons.com      → Stock Media Search   │
│  └── render.distributedelectrons.com     → Video Rendering      │
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
| Text Gen | text.distributedelectrons.com | ✅ Live | Multi-provider text generation (dynamic) |
| Audio Gen | audio.distributedelectrons.com | ✅ Live | ElevenLabs text-to-speech |
| Stock Media | media.distributedelectrons.com | ✅ Live | Pexels stock videos/images |
| Render Service | render.distributedelectrons.com | ✅ Live | Shotstack video rendering |
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

## Current Status: ~99% Complete

### What's Working
- ✅ All 10 Workers deployed (config, image-gen, text-gen, audio-gen, stock-media, render-service, rate-limiter, request-router, intake, delivery)
- ✅ All 4 Interfaces deployed with custom domains
- ✅ D1 database with full schema (7 core tables + 7 Request Router tables + 5 Events tables)
- ✅ Dynamic model config integration in workers
- ✅ Dynamic model loading in testing GUIs
- ✅ Rate limiting via Durable Objects
- ✅ R2 storage for generated content (images, audio, renders, deliverables)
- ✅ Admin Panel with model configuration UI
- ✅ CI/CD via GitHub Actions (all workers included)
- ✅ Request Router system for async job processing
- ✅ Events & Activity Tracking system
- ✅ Full test coverage (636 tests passing)

### Model Configs in Database
| Provider | Models |
|----------|--------|
| Anthropic | Claude 3.5 Sonnet, Claude 3.5 Haiku |
| OpenAI | GPT-4o, GPT-4o-mini, DALL-E 3, DALL-E 2 |
| Ideogram | Ideogram V2 |
| Gemini | Veo 3.1, Flash Nano Banana |
| ElevenLabs | Multilingual V2 |

### What's Remaining
- Add OPENAI_API_KEY to text-gen worker (optional, for OpenAI support)
- Advanced features: Progressive Disclosure, Entropy System, Notifications

---

## Recent Updates (December 2024)

### Request Router System (NEW)
Async job processing system to solve CF Worker-to-Worker timeout issues:
- **Intake Worker** (`intake.distributedelectrons.com`): Entry point for async requests
- **Request Router DO**: Central queue management with per-provider rate limiting
- **Delivery Worker** (`delivery.distributedelectrons.com`): Handles provider responses
- **Task Classifier**: Automatic task type detection and provider routing
- **Quality Assessment**: Auto-approve/reject based on content quality scores

### Database Schema Expansion
New tables for Request Router (migration 003):
- `requests` - Incoming requests with full lifecycle tracking
- `rate_limits` - Per-provider rate limit configurations
- `prompts` - Prompt library for task types
- `deliverables` - Results with quality scoring
- `queue_stats` - Real-time queue statistics
- `task_classifications` - Query-to-task-type mapping rules
- `provider_routing_rules` - Provider/model selection rules

### Dynamic Model Config Integration
- **Image Gen Worker**: Now accepts `model_id` parameter, fetches config from Config Service, uses payload mapper for provider-agnostic requests
- **Text Gen Worker**: Supports both new `model_id` and legacy `model: "provider:model-name"` formats with backwards compatibility
- **Testing GUIs**: Dynamically load available models from Config Service with fallback to hardcoded defaults

### Events & Activity Tracking System (NEW)
Comprehensive event logging and activity feed system:
- **Event Tracker** (`workers/shared/events/`): Core event recording with polymorphic associations
- **Activity Feed**: Human-readable activity stream with icons and deep links
- **Webhook Subscriptions**: Real-time event notifications with HMAC signatures
- **Event Delivery Tracking**: Retry logic with exponential backoff
- **Metrics Snapshots**: Periodic analytics aggregation

New API endpoints on Config Service:
- `GET /activity` - Activity feed with filtering
- `POST /activity/read` - Mark items as read
- `POST /events` - Track new events
- `GET /events/stats` - Event statistics
- `GET /events/{type}/{id}` - Events for entity
- Event subscription management (CRUD)

### Text Streaming (NEW)
Real-time text generation via Server-Sent Events (SSE):
- **Endpoint**: `POST /generate/stream` on text-gen worker
- **Providers**: OpenAI and Anthropic streaming supported
- **Format**: SSE events with `{ text, done, request_id }` payload
- **GUI Support**: Text Testing GUI updated with streaming toggle

### Test Coverage Expansion
- Added tests for text-gen, audio-gen, stock-media, render-service workers
- Added tests for Request Router classifier, Intake Worker, Delivery Worker
- Added tests for Events system
- Added streaming endpoint tests
- 646 tests now passing across the entire codebase (all pre-existing failures fixed)

### CI/CD Updates
- GitHub Actions deploy.yml updated to include all 10 workers
- Request Router, Intake, and Delivery workers added to pipeline

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

### Text Gen (text.distributedelectrons.com)
- `POST /generate` - Generate text (accepts `model_id` or legacy `model: "provider:model"`)
- `POST /generate/stream` - Stream text generation via SSE (Server-Sent Events)
- `GET /health` - Health check

### Audio Gen (audio.distributedelectrons.com)
- `POST /synthesize` - Text-to-speech synthesis
- `GET /audio/:id.mp3` - Retrieve generated audio
- `GET /voices` - List available voices
- `GET /health` - Health check

### Stock Media (media.distributedelectrons.com)
- `POST /search/videos` - Search stock videos
- `POST /search/images` - Search stock images
- `GET /health` - Health check

### Render Service (render.distributedelectrons.com)
- `POST /render` - Submit video render job
- `GET /render/:id` - Check render status
- `GET /health` - Health check

### Intake (intake.distributedelectrons.com)
- `POST /intake` - Submit async request for processing
- `GET /status?request_id=` - Check request status
- `POST /cancel` - Cancel pending request
- `GET /health` - Health check

### Delivery (delivery.distributedelectrons.com)
- `POST /deliver` - Receive provider response
- `POST /webhook` - Provider webhook endpoint
- `GET /deliverable?id=` - Get deliverable details
- `POST /approve` - Manually approve pending deliverable
- `POST /reject` - Manually reject pending deliverable
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
