# DE Inventory — Project Prometheus

## Summary
- Total files: 411 (excluding node_modules, .git, dist)
- **KEEP: ~165 files** — Core execution engine, provider adapters, rate limiting, runners, health checks
- **REBUILD: ~75 files** — Right direction but needs Prometheus alignment (config service, admin panel, request router DO, delivery, monitoring)
- **STRIP: ~12 files** — Nexus-overlapping task management, scheduling, event tracking
- **ARCHIVE: ~95 files** — Legacy 120-agent prompts, team reports, stale docs, old testing GUIs
- **REVIEW: ~64 files** — Docs and specs that need human triage for relevance

## SECURITY ALERT
- `.env` contains **live API tokens** committed to the repo (Cloudflare API token, Shotstack API key). These should be rotated and the file added to `.gitignore` (which already lists `.env` but the file was committed before the rule was added).

---

## Directory Walk

### /workers/intake/
**Category: KEEP**
- `index.ts` — Unified entry point for all async requests. Classifies by type (code, video, product-shipping, other) and routes to appropriate Cloudflare Workflow. This IS the "single front door" concept.
- `types.ts` — Request/response type definitions
- `wrangler.toml` — D1 (de-database), DO (REQUEST_ROUTER, RATE_LIMITER), Workflows (VIDEO_RENDER, CODE_EXECUTION, PRODUCT_SHIPPING_RESEARCH)
- **Notes**: Clean architecture. Accepts, classifies, fires workflow, returns request ID. Pure execution — no scheduling. The classification logic (code/video/product-shipping/other) could be generalized into a workflow registry pattern.

### /workers/text-gen/
**Category: KEEP**
- `index.ts` — Text generation worker with /generate, /generate/stream, /health, plus /v2/route universal router
- `llm-router.ts` — Smart routing with provider fallback: Spark Local → OpenAI → Anthropic
- `providers.ts` — Provider definitions and API call logic
- `provider-registry.ts` — Provider registration and lookup
- `spark-provider.ts` — On-premise Nemotron/vLLM integration
- `auth.ts` — Instance-level auth for text-gen
- `config.ts` — Dynamic model config fetching from Config Service
- `model-config-types.ts` — TypeScript types for model configs
- `types.ts` — Request/response types
- `worker-configuration.d.ts` — Wrangler-generated env types
- `wrangler.toml` — D1 (de-router), DO (RATE_LIMITER), AI Gateway, Spark Local URL
- `migrations/` — D1 schema for router (0001_router_schema.sql, 0002_seed_data.sql)
- `README.md` — Documentation
- **Notes**: This is the most mature worker. Supports AI Gateway BYOK, streaming, JSON validation with auto-repair, dynamic model config. The /v2/route endpoint is an ambitious universal router that should be the foundation for Prometheus's unified execution API.

### /workers/text-gen/src/lib/router/
**Category: REBUILD**
- `index.ts` — Universal router entry point
- `queue-aware-router.ts` — Checks code execution queue depth, switches routing tier if congested
- `registry.ts` — Provider/model registry
- `selector.ts` — Model selection logic
- `text-only-router.ts` — Simplified text-only routing path
- `transformer.ts` — Response transformation
- `types.ts` — Router types (RouterRequest, RouterResponse, etc.)
- `workflows/engine.ts` — Workflow execution engine for multi-step operations
- `workflows/templates.ts` — Workflow template definitions
- **Notes**: Good architecture — universal routing, cost estimation, latency tracking, provider health monitoring. Needs cleanup: the workflow engine here overlaps with Cloudflare Workflows in /workers/workflows/. Should consolidate. Queue-aware routing is clever but adds complexity.

### /workers/text-gen/src/lib/router/adapters/
**Category: KEEP**
- `base.ts` — Base adapter class (abstract)
- `anthropic.ts` — Anthropic Claude adapter
- `openai.ts` — OpenAI adapter
- `spark.ts` — Spark/Nemotron local adapter
- `zai.ts` — z.ai (GLM-4) adapter
- `ideogram.ts` — Ideogram image adapter
- `elevenlabs.ts` — ElevenLabs TTS adapter
- `replicate.ts` — Replicate adapter
- `index.ts` — Adapter registry and exports
- **Notes**: Clean adapter pattern. Each adapter normalizes provider-specific APIs to a common interface. This is exactly what Prometheus needs. The adapter list covers the full provider landscape.

### /workers/text-gen/src/utils/
**Category: KEEP**
- `index.ts` — Utility exports
- `json-validator.ts` — JSON response validation with auto-repair (retries malformed JSON)
- `json-validator.test.ts` — Co-located test
- `qa-wrapper.ts` — Quality assurance wrapper for LLM responses
- **Notes**: JSON validation/repair is genuinely useful for structured output from LLMs.

### /workers/image-gen/
**Category: KEEP**
- `index.ts` — Image generation with provider fallback (Ideogram → DALL-E → Stability), R2 storage, CDN URLs
- `types.ts` — Request/response types
- `README.md` — Documentation
- `wrangler.toml` — R2 (production-images), DO (RATE_LIMITER)
- **Notes**: Clean execution worker. Generates, stores in R2, returns CDN URL. No scheduling logic.

### /workers/audio-gen/
**Category: KEEP**
- `index.ts` — Text-to-speech via ElevenLabs → OpenAI TTS fallback, R2 storage
- `types.ts` — Request/response types
- `README.md` — Documentation
- `wrangler.toml` — R2 (de-audio-storage), DO (RATE_LIMITER), AI Gateway
- **Notes**: Clean execution worker. Provider fallback pattern consistent with other workers.

### /workers/render-service/
**Category: KEEP**
- `index.ts` — Video rendering via Shotstack API. Timeline conversion, job submission, polling.
- `types.ts` — Timeline/render types
- `README.md` — Documentation
- `wrangler.toml` — Shotstack API key
- **Notes**: Pure execution. Converts DE timeline format → Shotstack format. No scheduling.

### /workers/stock-media/
**Category: KEEP**
- `index.ts` — Stock video/photo search via Pexels API
- `types.ts` — Search types
- `README.md` — Documentation
- `wrangler.toml` — Pexels API key
- **Notes**: Pure execution. Search and return metadata.

### /workers/sandbox-executor/
**Category: KEEP**
- `src/index.ts` — Code execution delegation to on-prem runners (Claude primary, Gemini fallback)
- `src/types.ts` — Execution types
- `wrangler.toml` — Runner URLs, secrets
- `README.md` — Documentation
- `package.json`, `tsconfig.json`, `bun.lock` — Build config
- `.dev.vars`, `.dev.vars.example`, `.gitignore` — Local dev config
- **Notes**: Critical piece. Delegates to Claude/Gemini runners via Cloudflare Tunnel. Includes false-positive detection (catches AI claiming success when task actually failed). Has its own package.json — semi-independent module.

### /workers/workflows/
**Category: KEEP (workflows) / STRIP (nexus-callback)**

Individual workflow files — **KEEP**:
- `CodeExecutionWorkflow.ts` — Durable code execution with model waterfall (Claude Sonnet → Gemini Flash → Claude Opus → GLM-4). Error classification, retry with exponential backoff, quarantine after MAX_RETRIES.
- `TextGenerationWorkflow.ts` — Waterfall text routing: Runners → Nemotron → z.ai → Anthropic → Gemini → OpenAI
- `ImageGenerationWorkflow.ts` — Image gen with fallback: Ideogram → DALL-E → Stability
- `AudioGenerationWorkflow.ts` — Speech synthesis: ElevenLabs → OpenAI TTS
- `VideoRenderWorkflow.ts` — Video rendering with Shotstack
- `ProductShippingResearchWorkflow.ts` — Product research via z.ai GLM-4-plus with web search
- `types.ts` — Workflow type definitions
- `lib/model-mapping.ts` — Model name → runner/provider mapping for waterfall
- `tsconfig.json`, `README.md` — Build config and docs

Worker entry point — **REBUILD**:
- `index.ts` — Worker entrypoint that wires all workflows. Exposes /execute (PrimeWorkflow), /status/{id}. Needs Prometheus alignment.
- `PrimeWorkflow.ts` — Unified entry point that classifies tasks and routes to sub-workflows. Good concept but overlaps with intake worker classification. Should be consolidated.

Nexus integration — **STRIP**:
- `lib/nexus-callback.ts` — Reports execution results to Nexus MCP server (task completion, failure classification, retry tracking, quarantine, ntfy notifications). **DE should not know about Nexus tasks — this should be a callback mechanism the caller provides.**

Bindings (`wrangler.toml`) — **KEEP but REVIEW**:
- D1 (de-database), 7 Cloudflare Workflows, runner URLs, AI Gateway
- `NEXUS_API_URL`, `NEXUS_PASSPHRASE` — **STRIP** these bindings
- `NTFY_TOPIC` — **STRIP** (notification should be caller's responsibility)

### /workers/shared/error-handling/
**Category: KEEP**
- `errors.ts` — Custom error classes (DEError, ProviderError, ValidationError, RateLimitError, etc.)
- `middleware.ts` — Error handling middleware for workers
- `retry.ts` — Retry logic with exponential backoff, jitter
- `index.ts` — Module exports
- **Notes**: Solid error handling. Retry logic is essential for provider fallback.

### /workers/shared/logging/
**Category: KEEP**
- `logger.ts` — Structured logging with levels, context, request tracing
- `storage.ts` — Log storage (D1 or console)
- `types.ts` — Log types and levels
- `index.ts` — Module exports
- **Notes**: Good structured logging. Will need enhancement for Prometheus cost tracking.

### /workers/shared/http/
**Category: KEEP**
- `index.ts` — CORS helpers, error/success response factories, fetchWithRetry
- **Notes**: Clean utility module. Used by all workers.

### /workers/shared/provider-adapters/
**Category: KEEP**
- `base-adapter.ts` — Abstract base adapter class
- `dynamic-adapter.ts` — Dynamic adapter that builds from model config payload mapping
- `ideogram-adapter.ts` — Ideogram-specific adapter
- `registry.ts` — Adapter registration and lookup
- `types.ts` — Adapter interfaces
- `index.ts` — Module exports
- **Notes**: Core pattern for Prometheus. Dynamic adapter is powerful — builds provider calls from stored config without code changes. This is the key to supporting new providers/models without deploys.

### /workers/shared/r2-manager/
**Category: KEEP**
- `storage.ts` — R2 upload/download with CDN URL generation
- `metadata.ts` — Image/file metadata management
- `types.ts` — Storage types
- `index.ts` — Module exports
- **Notes**: Clean R2 abstraction. Used by image-gen, audio-gen, delivery.

### /workers/shared/rate-limiter/
**Category: KEEP**
- `limiter.ts` — Durable Object implementing sliding window rate limiting (RPM + TPM)
- `client.ts` — Client library for checking/recording rate limits
- `types.ts` — Rate limit config and result types
- `wrangler.toml` — DO class export
- `index.ts` — Module exports
- **Notes**: Production-quality rate limiting via Durable Objects. Per-instance, per-provider. Essential for Prometheus cost control.

### /workers/shared/request-router-do/
**Category: REBUILD**
- `router.ts` — Durable Object for request queue management, provider selection, processing tracking
- `classifier.ts` — Query → task type classification (image/text/audio/video/context with subtasks)
- `types.ts` — IntakeRequest, QueuedRequest, ProviderQueue, RouterState, etc.
- `wrangler.toml` — DO class export
- `index.ts` — Module exports
- **Notes**: The request routing DO manages queues, tracks processing, handles provider selection. **Problem**: Much of this overlaps with Nexus's job of queue management and scheduling. The classifier is useful (KEEP), but the queue management and task tracking should be stripped. DE should route and execute, not queue and schedule.

### /workers/shared/events/
**Category: STRIP**
- `event-tracker.ts` — Event logging, activity feeds, webhook delivery
- `types.ts` — Event types (request.created, deliverable.approved, etc.)
- `index.ts` — Module exports
- **Notes**: Full event/activity tracking system including webhook subscriptions and delivery tracking. This duplicates what Nexus should handle. DE should emit events to callers via callbacks, not maintain its own event system.

### /workers/shared/utils/
**Category: KEEP**
- `payload-mapper.ts` — Dynamic payload transformation using model config templates (variable substitution, nested field mapping)
- `validation.ts` — Request validation utilities
- `index.ts` — Module exports
- **Notes**: Payload mapper is a key innovation — transforms generic DE requests into provider-specific payloads using stored config. Essential for Prometheus.

### /workers/shared/config-cache/
**Category: KEEP**
- `index.ts` — Caches instance and model configs from Config Service
- **Notes**: TTL-based caching with stale fallback. Used by workers to avoid hitting Config Service on every request.

---

### /infrastructure/auth/
**Category: KEEP**
- `key-manager.ts` — API key generation (sk_live_*/sk_test_*), SHA-256 hashing, constant-time comparison
- `middleware.ts` — Authentication middleware, user context loading
- `types.ts` — Auth types, permission hierarchy (user/admin/superadmin)
- `index.ts` — Module exports
- `README.md` — Documentation
- **Notes**: Clean auth layer. Timing-attack-safe key comparison. Log sanitization.

### /infrastructure/config-service/
**Category: REBUILD**

Core — **KEEP**:
- `index.ts` — Main router with CRUD endpoints for instances, users, projects, model configs, provider keys
- `types.ts` — Entity types (Instance, User, Project, ModelConfig, etc.)
- `utils.ts` — Response factories, validation, JSON parsing
- `wrangler.toml` — D1 (multiagent_system), KV (PROVIDER_KEYS), route: api.distributedelectrons.com/*
- `README.md` — Documentation

Handlers — **KEEP**:
- `handlers/instance-handlers.ts` — Instance CRUD
- `handlers/user-handlers.ts` — User CRUD
- `handlers/project-handlers.ts` — Project CRUD
- `handlers/model-config-handlers.ts` — Model config CRUD (validates format, generates config IDs)
- `handlers/provider-key-handlers.ts` — Provider API key management (AES-GCM encryption)
- `handlers/dev-credentials-handlers.ts` — Dev credential management
- `handlers/oauth-handlers.ts` — Claude OAuth credential management (store, refresh, status)

Handler — **STRIP**:
- `handlers/activity-handlers.ts` — Activity feed, event tracking, webhook subscriptions. Duplicates Nexus functionality.

- **Notes**: Config Service is solid but bloated. Core CRUD for instances/models/keys is essential. OAuth management is operationally critical. Activity/events handler should be stripped. For Prometheus, this becomes the "control plane" — manages what providers/models are available and how to call them. Needs API versioning and better separation of concerns.

### /infrastructure/database/
**Category: MIXED**

**KEEP**:
- `schema.sql` — Master schema reference
- `queries.ts` — Database query utilities
- `migrations/001-initial.sql` — Core tables (organizations, instances, users, projects, api_keys, usage_logs)
- `migrations/002-prompt-templates.sql` — Adds prompt_template to model_configs
- `migrations/005-workflows.sql` — Adds workflow_instance_id and workflow_name to requests table
- `migrations/006-oauth.sql` — OAuth credential tracking tables

**STRIP**:
- `migrations/003-request-router.sql` — Creates requests, rate_limits, prompts, deliverables, queue_stats, task_classifications, provider_routing_rules tables. **This is task management and scheduling** — the requests queue, queue_stats, and task_classifications tables are Nexus territory. The rate_limits and provider_routing_rules tables overlap with model config.
- `migrations/004-events.sql` — Creates events, event_subscriptions, event_deliveries, activity_feed, metrics_snapshots tables. **This is event/activity tracking** — Nexus territory.

**REBUILD**:
- `seed.sql`, `seed-models.sql`, `seed-model-configs.sql`, `seed-text-models.sql` — Seed data. Useful but needs refresh for current provider landscape.

- **Notes**: The database has grown organically. Migrations 003 and 004 added significant scheduling/tracking infrastructure that belongs in Nexus. For Prometheus, DE needs: organizations, instances, model_configs, api_keys, usage_logs, oauth_credentials, and workflow tracking — not request queues or event feeds.

### /infrastructure/lookup/
**Category: KEEP**
- `instance-resolver.ts` — Cache-first instance config resolution with Config Service fallback
- `cache.ts` — KV-based caching with TTL and stale-cache grace period (5min TTL, 1hr stale grace)
- `types.ts` — LookupContext, LookupResult, CacheEntry, LookupError
- `index.ts` — Module exports
- `README.md` — Documentation
- **Notes**: Well-designed caching layer. Stale-cache fallback ensures workers function even if Config Service is down.

### /infrastructure/DEPLOYMENT_SETUP.md
**Category: REVIEW**
- Deployment setup instructions for infrastructure components.

---

### /interfaces/admin-panel/
**Category: REBUILD**
- React + Vite + Tailwind admin interface
- Pages: Instances, Users, Models, Services, Deployments, Logs, Login
- Components: Navbar, Footer, ApiKeyModal, ModelConfigModal
- Config: providers.js, services.js
- `wrangler.toml` — Cloudflare Pages deployment config
- `wrangler.toml.bak` — Backup of old config
- **30 files total**
- **Notes**: Functional admin panel for managing the DE platform. Talks to Config Service API. For Prometheus, this should become the unified control plane UI — but it needs significant updates to align with the new architecture (remove multi-agent references, add cost tracking, workflow management). The service registry visualization in services.js is useful.

### /interfaces/monitoring/
**Category: REBUILD**
- React + Vite + Tailwind monitoring dashboard
- Components: RequestsChart, ErrorsChart, ProviderChart, RateLimitChart, StatsCards, Header
- `wrangler.toml` — Cloudflare Pages deployment config
- **14 files total**
- **Notes**: Monitoring dashboard with charts for requests, errors, provider usage, rate limits. For Prometheus, this should become the cost/usage dashboard. Good foundation but needs real data integration.

### /interfaces/testing-gui/
**Category: ARCHIVE**
- Static HTML/JS testing interface for image generation
- `wrangler.toml.bak` — Deployment config (note: .bak, not active)
- **5 files total**
- **Notes**: Old testing interface. Superseded by text-testing-gui and admin panel.

### /interfaces/text-testing-gui/
**Category: ARCHIVE**
- Static HTML/JS testing interface for text generation
- **4 files total**
- **Notes**: Newer testing GUI but still a standalone static page. Could be rolled into admin panel.

### /interfaces/deploy-all.sh
**Category: KEEP**
- Shell script to deploy all interfaces
- **Notes**: Operational utility.

### /interfaces/DEPLOYMENT.md, UAT_CHECKLIST.md, ADDING_SERVICES.md
**Category: REVIEW**
- Deployment and testing documentation for interfaces.

---

### /services/claude-runner/
**Category: KEEP**
- Docker-based Claude Code runner on DGX Spark
- `src/server.ts` — Express server accepting /execute requests, spawns Claude Code CLI
- `Dockerfile` — Installs Claude Code CLI, Node.js
- `docker-compose.yml` — Port 8789, volume mounts for repos
- `README.md` — Documentation
- **10 files total**
- **Notes**: Critical infrastructure. Runs on-premise via Cloudflare Tunnel (claude-runner.shiftaltcreate.com). This is the "local GPU advantage" for Prometheus. Accepts execution requests, runs them with Claude Code, returns results.

### /services/gemini-runner/
**Category: KEEP**
- Docker-based Gemini CLI runner on DGX Spark
- `src/server.ts` — Express server accepting /execute requests, spawns Gemini CLI
- `Dockerfile` — Installs Gemini CLI
- `docker-compose.yml` — Port 8790
- `README.md` — Documentation
- **10 files total**
- **Notes**: Fallback runner. Same pattern as claude-runner. Runs on-premise via Cloudflare Tunnel (gemini.spark.shiftaltcreate.com).

### /services/reauth-ui/
**Category: KEEP**
- OAuth re-authentication web UI for Claude Code and Gemini CLI
- `src/server.ts` — Express server with /status, /reauth/claude, /reauth/gemini endpoints
- `public/index.html` — Mobile-friendly UI with auto-refresh, pull-to-refresh
- `docker-compose.yml` — Port 8791
- **8 files total**
- **Notes**: Operational tool. Checks OAuth token status, triggers re-auth flows. Accessible via reauth.shiftaltcreate.com. Essential for keeping runners authenticated.

---

### /scripts/
**Category: KEEP (mostly)**

**KEEP**:
- `cf-access-setup.sh` — Creates Cloudflare Access policies to protect runner tunnels
- `cf-auth-setup.sh` — Fetches Cloudflare credentials from Config Service
- `cf-auth-store.sh` — Stores Cloudflare API tokens in Config Service
- `de-auth.ts` — CLI for Claude OAuth credential management (status, refresh, deploy)
- `delete-instance.ts` — Instance cleanup with confirmation prompt
- `deploy-all-instances.ts` — Batch deployment
- `deploy-instance.ts` — Full instance deployment (R2, workers, DB)
- `update-instance.ts` — Instance config updates
- `README.md` — Script documentation

**REVIEW**:
- `test-code-workflow.ts` — Integration test for Code Execution Workflow. References Nexus MCP directly (creates tasks, polls status). Useful for testing but has Nexus coupling.
- `setup-custom-domains.sh` — May be stale; domain structure may have changed.

### /tests/
**Category: KEEP**
- **38 test files** across all components
- Unit tests: auth, config-service, database, error-handling, logging, lookup, provider-adapters, r2-manager, rate-limiter, shared/validation
- Integration tests: config-service/integration, image-gen, intake, text-gen, workflows
- Mock infrastructure: `__mocks__/cloudflare-workers.ts`
- **Notes**: Good test coverage (~646 tests, 99.2% pass rate). Tests are well-structured with proper mocking. The workflow tests verify Nexus integration (X-Passphrase header). Tests should be kept and updated as architecture evolves.

---

### /archive/
**Category: ARCHIVE**

### /archive/team-reports/
- 17 files documenting the multi-agent development experiment (4 teams, 16 agents)
- `FINAL_PROJECT_REPORT.md` — Comprehensive project report: Team 1 (D+ 65%), Team 2 (A 93%), Team 3 (A+ 98%), Team 4 (A+ 97%)
- `CODE_REVIEW_TEAMS_1_2_3.md` — Cross-team code review
- `TEAM_*_TODO.md`, `TEAM_*_VERIFICATION.md` — Per-team status tracking
- **Notes**: Historical record of the 120-agent Content Forge development experiment. Valuable for understanding how the codebase was built but not operationally relevant.

### /archive/worker_project/
- `multi-agent-orchestration-plan.md` — Original multi-agent architecture plan
- `cloudflare-multiagent-system-plan.md` — Detailed system design document
- **Notes**: Foundational architecture docs. Some design decisions captured here are still relevant.

### /prompts/
**Category: ARCHIVE**
- 17 files total: 4 team leader prompts, 16 agent prompts, README, DELIVERABLES, EXTRACTION_SUMMARY
- These are the AI agent task specifications used in the 120-agent Content Forge development
- Team 1: Infrastructure (database, config, auth, lookup)
- Team 2: Workers (providers, rate limiter, storage, image gen)
- Team 3: Operations (errors, logging, deploy, CI/CD)
- Team 4: Interfaces (testing GUI, admin, docs, monitoring)
- **Notes**: Historical. The multi-agent development approach generated the codebase. Interesting for process documentation but not needed for Prometheus.

### /.claude/
**Category: ARCHIVE**
- `claude.md` — Project-level instructions for Claude Code with team lead commands
- `commands/` — 4 team lead command definitions + README
- **Notes**: Part of the multi-agent development system. The team lead commands could be repurposed for Prometheus development but the current content is Content Forge-specific.

---

### /.github/workflows/
**Category: KEEP**
- `deploy.yml` — Deploys all workers on push to master/main. Runs tests, deploys 10+ workers, smoke tests.
- `test.yml` — CI: lint, typecheck, test coverage, security audit on PR/push
- `deploy-instance.yml` — Manual workflow for deploying new instances
- `sync-registry.yml` — Syncs services-manifest.json to Developer Guides MCP
- **Notes**: Solid CI/CD pipeline. deploy.yml needs updating as workers are added/removed for Prometheus.

---

### Root-level Documentation

**KEEP** (operationally relevant):
- `README.md` — Main project overview. Current but references "multi-agent" framing that needs Prometheus update.
- `SECURITY.md` — Security policy, vulnerability reporting
- `LICENSE` — MIT license

**REBUILD** (useful content, needs update):
- `PROJECT_OVERVIEW.md` — System architecture overview. Good content but pre-Prometheus framing.
- `HANDOFF.md` — Comprehensive dev handoff (Dec 13, 2024). Captures known issues and next steps.

**REVIEW** (may contain useful Prometheus-relevant architecture decisions):
- `WATERFALL_IMPLEMENTATION.md` — Model waterfall enhancement. Directly relevant to Prometheus.
- `WATERFALL_TEST_RESULTS.md` — Test results for waterfall (Dec 30, 2025). Shows integration working.
- `TEXT_GEN_INTEGRATION_GUIDE.md` — Text-gen integration with model config system. Relevant.
- `TEXT_GEN_INTEGRATION_SUMMARY.md` — Summary of text-gen integration (Jan 16, 2025).
- `TEXT_GEN_API_QUICK_REFERENCE.md` — API reference. Useful.
- `MODEL_CONFIG_PROGRESS.md` — Model config implementation report. All phases complete.
- `DEPLOYMENT_GUIDE.md` — Comprehensive 10-phase deployment guide. Still useful.

**ARCHIVE** (stale or superseded):
- `AUTOMATION_GUIDE.md` — Automation scripts guide. May need URL updates.
- `COMPLETE_DNS_SETUP_GUIDE.md` — DNS setup (one-time operation, completed)
- `CUSTOM_DOMAIN_SETUP.md` — Custom domain setup (completed)
- `CUSTOM_DOMAIN_SETUP_INSTRUCTIONS.md` — Duplicate of above
- `DNS_API_TOKEN_TROUBLESHOOTING.md` — DNS troubleshooting (completed)
- `DNS_SETUP_COMPLETE.md` — DNS setup completion record
- `TEST_REPORT.md` — Old test report
- `GEMINI.md` — Gemini agent context (Dec 23, 2025). Specific to gemini-code-review branch.
- `gemini-code-review.md` — Gemini code review notes

### /docs/
**Category: REVIEW**

**Specs** (architecturally relevant):
- `specs/architecture.md` — Hierarchical architecture spec. Core design decisions still valid.
- `specs/api-contracts.md` — API contract definitions
- `specs/REQUEST_ROUTER_DESIGN.md` — Request Router design spec
- `specs/testing-requirements.md` — Testing requirements

**Implementation notes** (useful context):
- `NEXT_STEPS_REQUEST_ROUTER.md` — Architecture vision with 8-step flow. Contains 16 follow-up design questions. Relevant to Prometheus.
- `PAYLOAD_MAPPING_SPEC.md` — Payload mapping specification. Core to dynamic provider support.
- `routing-architecture-audit.md` — Routing architecture review
- `SESSION_NOTES_2025-12-04.md` — Working session notes
- `IMPLEMENTATION_NOTES.md` — Implementation notes
- `FILES_MODIFIED.md` — Change tracking

**Model config docs** (useful reference):
- `MODEL_CONFIGURATION_PLAN.md` — 4-phase model config implementation plan
- `MODEL_CONFIG_SCHEMA.md` — Schema documentation
- `MODEL_CONFIG_API.md` — API documentation
- `MODEL_CONFIG_ADMIN_GUIDE.md` — Admin guide
- `MODEL_CONFIG_USER_GUIDE.md` — User guide
- `MODEL_CONFIG_INTEGRATION_SUMMARY.md` — Integration summary
- `MODEL_CONFIG_INTEGRATION_TESTING.md` — Integration testing

**Standard docs** (review for currency):
- `docs/README.md` — Documentation index
- `docs/DEPLOYMENT_CHECKLIST.md` — Pre-deployment checklist
- `docs/DNS_SETUP_GUIDE.md` — DNS setup guide
- `docs/admin/MODEL_MANAGEMENT_GUIDE.md` — Model management admin guide
- `docs/admin/README.md`, `docs/api/README.md`, `docs/deployment/README.md`, `docs/development/README.md`

---

### Root Config Files
**Category: KEEP**
- `package.json` — Project manifest. DevDependencies only (Cloudflare Workers types, TypeScript, Vitest, Wrangler 4.53.0). No runtime deps at root level.
- `tsconfig.json` — TypeScript config
- `vitest.config.ts` — Test config
- `wrangler.toml` — Root Cloudflare config (base template, individual workers override)
- `.env.example` — Environment template (Cloudflare token, Shotstack key)
- `.env` — **SECURITY ISSUE** — Contains live tokens. Should not be committed.
- `.gitignore` — Git ignore rules
- `worker-configuration.d.ts` — Wrangler-generated types (345KB — includes full Cloudflare Workers runtime types)
- `services-manifest.json` — Service registry (7 services: text-gen, image-gen, config-service, voice-to-text [planned], text-to-voice [planned], mnemo [beta], nexus [planned])
- `bun.lock` — Bun lockfile

---

## Provider/Model Assessment

### Active Providers
| Provider | Type | Integration | Status |
|----------|------|-------------|--------|
| **OpenAI** | Text (GPT-4o, GPT-4o-mini) | Direct API + AI Gateway BYOK | Active |
| **Anthropic** | Text (Claude 3.5 Sonnet, Haiku) | Direct API + AI Gateway BYOK | Active |
| **Spark/Nemotron** | Text (local vLLM) | On-premise via Cloudflare Tunnel | Active |
| **z.ai** | Text (GLM-4-plus) | Direct API (api.z.ai) | Active |
| **Ideogram** | Image (v2) | Direct API | Active |
| **ElevenLabs** | Audio/TTS | Direct API | Active |
| **Shotstack** | Video rendering | Direct API | Active |
| **Pexels** | Stock media | Direct API | Active |

### AI Gateway Integration
- **URL**: `https://gateway.ai.cloudflare.com/v1/52b1c60ff2a24fb21c1ef9a429e63261/de-gateway`
- **Purpose**: BYOK (Bring Your Own Keys) mode for OpenAI and Anthropic
- **Status**: Active, used by text-gen and audio-gen workers

### Planned/Deprecated
| Provider | Status | Notes |
|----------|--------|-------|
| Google Gemini | Planned in text-gen, active via runner | Via gemini-runner on-prem |
| Stability AI | Fallback only | Referenced in image-gen fallback chain |
| DALL-E (OpenAI) | Fallback only | Referenced in image-gen fallback chain |
| Replicate | Adapter exists | Not actively used |
| Cohere | Mentioned in docs | Not implemented |

### Model Waterfall Chains
- **Code Execution**: Claude Sonnet → Gemini Flash → Claude Opus → GLM-4
- **Text Generation**: Runners (if idle) → Nemotron → z.ai → Anthropic → Gemini → OpenAI
- **Image Generation**: Ideogram → DALL-E → Stability
- **Audio/TTS**: ElevenLabs → OpenAI TTS

---

## Worker Assessment

### Cloudflare Workers (Deployed)
| Worker | Domain | Purpose | Status |
|--------|--------|---------|--------|
| `config-service` | api.distributedelectrons.com | Config management, model registry | **Deployed** |
| `text-gen` | text.distributedelectrons.com | LLM routing with fallback | **Deployed** |
| `image-gen` | (workers.dev) | Image generation + R2 | **Deployed** |
| `audio-gen` | (workers.dev) | TTS with fallback | **Deployed** |
| `render-service` | (workers.dev) | Video rendering (Shotstack) | **Deployed** |
| `stock-media` | (workers.dev) | Stock media search (Pexels) | **Deployed** |
| `intake` | (workers.dev) | Request intake + classification | **Deployed** |
| `delivery` | (workers.dev) | Response handling + quality | **Deployed** |
| `sandbox-executor` | sandbox-executor.solamp.workers.dev | Code execution delegation | **Deployed** |
| `rate-limiter` | (DO only) | Per-instance rate limiting | **Deployed** (Durable Object) |
| `request-router-do` | (DO only) | Request queue management | **Deployed** (Durable Object) |
| `workflows` | (workers.dev) | 7 Cloudflare Workflows | **Deployed** |

### Docker Services (On-Premise / DGX Spark)
| Service | Port | Tunnel URL | Purpose | Status |
|---------|------|------------|---------|--------|
| claude-runner | 8789 | claude-runner.shiftaltcreate.com | Claude Code execution | **Running** |
| gemini-runner | 8790 | gemini.spark.shiftaltcreate.com | Gemini CLI execution | **Running** |
| reauth-ui | 8791 | reauth.shiftaltcreate.com | OAuth management UI | **Running** |

### Cloudflare Pages (Interfaces)
| Interface | Purpose | Status |
|-----------|---------|--------|
| admin-panel | Platform management UI | **Deployed** (needs rebuild) |
| monitoring | Usage/performance dashboard | **Deployed** (needs rebuild) |
| testing-gui | Image gen testing | **Stale** |
| text-testing-gui | Text gen testing | **Stale** |

---

## API Surface

### Intake Worker
| Method | Endpoint | Purpose | Used By |
|--------|----------|---------|---------|
| POST | /intake | Submit new request | External callers, Nexus |
| GET | /status | Check request status | External callers |
| POST | /cancel | Cancel request | External callers |
| GET | /health | Health check | Monitoring |

### Text-Gen Worker
| Method | Endpoint | Purpose | Used By |
|--------|----------|---------|---------|
| POST | /generate | Text generation | Direct callers, workflows |
| POST | /generate/stream | Streaming text gen | Direct callers |
| GET | /health | Health check | Monitoring |
| POST | /v2/route | Universal router (text, image, audio) | Experimental |
| GET | /v2/health | Router health | Monitoring |
| GET | /v2/workflows | List workflows | Admin |
| GET | /v2/stats | Router stats | Monitoring |

### Image-Gen Worker
| Method | Endpoint | Purpose | Used By |
|--------|----------|---------|---------|
| POST | /generate | Generate image | Workflows, direct |
| GET | /images/{path} | Serve image from R2 | CDN/clients |
| GET | /test-r2 | R2 connectivity test | Admin |
| GET | /health | Health check | Monitoring |

### Audio-Gen Worker
| Method | Endpoint | Purpose | Used By |
|--------|----------|---------|---------|
| POST | /synthesize | Text-to-speech | Workflows, direct |
| GET | /voices | Available voices | Clients |
| GET | /audio/{key} | Serve audio from R2 | CDN/clients |
| GET | /health | Health check | Monitoring |

### Workflows Worker
| Method | Endpoint | Purpose | Used By |
|--------|----------|---------|---------|
| POST | /execute | Create PrimeWorkflow | Intake worker, Nexus |
| GET | /status/{id} | Workflow status | Callers |
| GET | /test-routing | Routing verification | Admin |

### Config Service
| Method | Endpoint | Purpose | Used By |
|--------|----------|---------|---------|
| GET/POST/PUT/DELETE | /instance/* | Instance CRUD | Admin panel, scripts |
| GET/POST/PUT/DELETE | /user/* | User CRUD | Admin panel |
| GET/POST/PUT/DELETE | /project/* | Project CRUD | Admin panel |
| GET/POST/PUT/DELETE | /model-config/* | Model config CRUD | Admin panel, workers |
| POST/GET/DELETE | /provider-key/* | Provider key management | Admin panel |
| POST/GET/DELETE | /dev-credentials/* | Dev credentials | Scripts |
| POST/GET/DELETE | /oauth/claude/* | OAuth management | Reauth UI, runners |
| GET/POST | /activity/* | Activity feed | Admin panel |
| GET/POST/PUT/DELETE | /events/* | Event tracking | Workers |
| GET | /health | Health check | Monitoring |

### Delivery Worker
| Method | Endpoint | Purpose | Used By |
|--------|----------|---------|---------|
| POST | /deliver | Submit provider response | Workflows |
| POST | /webhook | Provider webhook receiver | External providers |
| GET | /deliverable | Get deliverable by ID | Clients |
| POST | /approve | Manual quality approval | Admin |
| POST | /reject | Manual quality rejection | Admin |
| GET | /health | Health check | Monitoring |

### Other Workers
| Worker | Endpoints | Used By |
|--------|-----------|---------|
| render-service | POST /render, GET /render/{id}, GET /health | Workflows |
| stock-media | POST /search, POST /search/videos, POST /search/photos, GET /health | Workflows |
| sandbox-executor | POST /execute, GET /health | Workflows, code execution |

---

## Dependencies Assessment

### Root package.json (devDependencies only)
| Package | Version | Purpose | Status |
|---------|---------|---------|--------|
| @cloudflare/workers-types | ^4.20241127.0 | CF Workers TypeScript types | **Keep** |
| @types/node | ^20.10.0 | Node.js types | **Keep** |
| @typescript-eslint/* | ^6.13.0 | TypeScript linting | **Keep** |
| @vitest/coverage-v8 | ^1.6.1 | Test coverage | **Keep** |
| @vitest/ui | ^1.0.0 | Test UI | **Keep** |
| eslint | ^8.54.0 | Linting | **Keep** |
| prettier | ^3.1.0 | Formatting | **Keep** |
| tsx | ^4.7.0 | TypeScript execution | **Keep** |
| typescript | ^5.3.2 | TypeScript compiler | **Keep** |
| vitest | ^1.0.0 | Test framework | **Keep** |
| wrangler | ^4.53.0 | Cloudflare CLI | **Keep** |

### sandbox-executor/package.json
| Package | Version | Purpose | Status |
|---------|---------|---------|--------|
| hono | (version in lock) | HTTP framework | **Keep** |
| @cloudflare/workers-types | (dev) | CF types | **Keep** |

### services/claude-runner/package.json
| Package | Version | Purpose | Status |
|---------|---------|---------|--------|
| express | ^4.18.2 | HTTP server | **Keep** |
| @types/express, typescript | (dev) | Types/compiler | **Keep** |

### services/gemini-runner/package.json
| Package | Version | Purpose | Status |
|---------|---------|---------|--------|
| express | ^4.18.2 | HTTP server | **Keep** |
| @types/express, typescript | (dev) | Types/compiler | **Keep** |

### services/reauth-ui/package.json
| Package | Version | Purpose | Status |
|---------|---------|---------|--------|
| express | ^4.18.2 | HTTP server | **Keep** |
| @types/express, typescript | (dev) | Types/compiler | **Keep** |

### interfaces/admin-panel/package.json
| Package | Purpose | Status |
|---------|---------|--------|
| react, react-dom | UI framework | **Keep** |
| react-router-dom | Routing | **Keep** |
| recharts | Charts | **Keep** |
| tailwindcss | Styling | **Keep** |
| vite | Build tool | **Keep** |

### interfaces/monitoring/package.json
| Package | Purpose | Status |
|---------|---------|--------|
| react, react-dom, recharts, tailwindcss, vite | Same stack as admin-panel | **Keep** |

**Assessment**: Dependencies are lean. No heavy/unused packages detected. Root package has devDependencies only (all tooling). Individual workers/services have minimal deps. No dependency bloat issues.

---

## Architecture Gaps

### What's Missing for Prometheus (Unified Execution Engine)

1. **Unified API Schema**
   - Currently each worker has its own request/response format
   - Need: Single OpenAPI spec defining the execution request envelope
   - Any app submits: `{ workflow: "text-gen", params: {...}, callback_url: "..." }`

2. **Workflow Registry**
   - Workflows are hardcoded in intake worker classification and PrimeWorkflow
   - Need: Dynamic workflow registry — register new workflow templates without code changes
   - The workflow templates concept in text-gen/src/lib/router/workflows/ is a start

3. **Cost Tracking**
   - usage_logs table exists but isn't actively populated
   - Need: Per-request cost calculation based on provider/model pricing in model_configs
   - Need: Cost aggregation by caller, by workflow, by time period

4. **Caller Identity**
   - Currently uses instance_id for multi-tenancy
   - Need: Clear caller authentication — which app is making this request?
   - Need: Per-caller rate limits and cost budgets

5. **Callback Contract**
   - nexus-callback.ts is Nexus-specific
   - Need: Generic callback mechanism — DE posts result to whatever URL the caller provides
   - Standard webhook format with retry logic

6. **Model Routing Intelligence**
   - Waterfall chains are hardcoded per workflow
   - Need: Dynamic model routing based on: cost, latency, availability, caller preference
   - The model_configs table and payload_mapper provide the foundation

7. **Observability**
   - Logging exists but no centralized metrics/tracing
   - Need: Request tracing across intake → workflow → provider → delivery
   - Need: Provider health dashboard (latency, error rates, cost per request)

8. **Queue Visibility** (without owning the queue)
   - DE shouldn't manage queues (that's Nexus)
   - But DE should expose: "I'm busy" / "I'm available" / "estimated wait time"
   - The rate-limiter DO partially does this

### What Can Be Built from Existing Code

| Prometheus Need | Existing Foundation | Work Required |
|----------------|-------------------|---------------|
| Unified entry point | intake worker + PrimeWorkflow | Consolidate, add workflow registry |
| Provider routing | text-gen llm-router + adapters | Generalize beyond text-gen |
| Rate limiting | rate-limiter DO | Already production-quality |
| Model config | config-service + model_configs | Already working, needs cost tracking |
| Provider adapters | shared/provider-adapters + text-gen adapters | Merge the two adapter systems |
| Asset storage | r2-manager | Already working |
| Code execution | sandbox-executor + runners | Already working |
| Durable workflows | workers/workflows/ | Already working, strip Nexus coupling |
| Auth/multi-tenant | infrastructure/auth + lookup | Already working |
| Monitoring | monitoring interface | Needs real data integration |

---

## Key Decisions Needed

1. **Consolidate or Keep Separate?**
   - Two adapter systems exist: `workers/shared/provider-adapters/` (dynamic, config-driven) and `workers/text-gen/src/lib/router/adapters/` (code-based, per-provider). Which pattern wins? Or merge them?

2. **PrimeWorkflow vs Intake Classification**
   - Both intake/index.ts and PrimeWorkflow.ts classify requests and route to workflows. Which is the single entry point? Recommendation: intake handles HTTP, PrimeWorkflow handles orchestration.

3. **request-router DO fate**
   - The Request Router Durable Object manages queues and tracks request state. This overlaps with Nexus. Strip queue management but keep the routing intelligence? Or remove entirely?

4. **Database migration strategy**
   - Migrations 003 (request router) and 004 (events) created tables that should be stripped. How to handle? New migration that drops tables? Or just stop using them?

5. **Monorepo consolidation**
   - sandbox-executor has its own package.json and bun.lock. Each service (claude-runner, gemini-runner, reauth-ui) has its own. Keep as-is or consolidate?

6. **Config Service scope**
   - Currently handles: instances, users, projects, model configs, provider keys, OAuth, events, activity. For Prometheus, should it be split? (Control plane for config vs. operational data)

7. **services-manifest.json scope**
   - Lists planned services (voice-to-text, text-to-voice, mnemo, nexus) that don't exist as workers. Update or remove?

8. **AI Gateway strategy**
   - Currently optional (BYOK mode). Should all provider calls route through AI Gateway for unified logging/caching? Or keep direct API calls for latency?

9. **On-premise runner authentication**
   - Currently uses shared secrets (RUNNER_SECRET, GEMINI_RUNNER_SECRET). Sufficient? Or need mTLS/CF Access?

10. **Callback mechanism**
    - Strip nexus-callback.ts and replace with generic webhook callback. What's the contract? Who retries? What payload format?

---

## Hardcoded External References

### Service URLs
| URL | Used In | Purpose |
|-----|---------|---------|
| api.distributedelectrons.com | config-service route, workers | Config Service |
| text.distributedelectrons.com | text-gen route | Text generation |
| claude-runner.shiftaltcreate.com | workflows, sandbox-executor | Claude Code runner |
| gemini.spark.shiftaltcreate.com | workflows, sandbox-executor | Gemini CLI runner |
| vllm.shiftaltcreate.com | text-gen | Nemotron inference |
| reauth.shiftaltcreate.com | reauth-ui | OAuth management |
| sandbox-executor.solamp.workers.dev | workflows | Code execution |
| nexus-mcp.solamp.workers.dev | workflows/lib/nexus-callback.ts | **Nexus integration (STRIP)** |
| gateway.ai.cloudflare.com/v1/52b1c60ff2a24fb21c1ef9a429e63261/de-gateway | text-gen, audio-gen | AI Gateway |
| api.z.ai/api/paas/v4/chat/completions | ProductShippingResearchWorkflow | z.ai direct API |
| api.openai.com/v1/chat/completions | text-gen | OpenAI direct |
| api.anthropic.com/v1/messages | text-gen | Anthropic direct |
| api.elevenlabs.io/v1/text-to-speech | audio-gen | ElevenLabs |
| api.ideogram.ai | image-gen | Ideogram |
| api.shotstack.io | render-service | Shotstack |

### Cloudflare Resource IDs
| Resource | ID | Used In |
|----------|------|---------|
| D1 Database (multiagent_system) | 7cff30a0-c974-4ede-b96a-c91dd2f0c870 | config-service |
| KV Namespace (PROVIDER_KEYS) | 60eab140779649c09cb9aea7b3c8f533 | config-service |
| Cloudflare Account | 52b1c60ff2a24fb21c1ef9a429e63261 | AI Gateway URL, .env |
