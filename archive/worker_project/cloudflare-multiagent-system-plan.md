# Cloudflare Multi-Agent System - Planning Document

## Project Overview

Migration of 120-agent Content Forge system to Cloudflare Workers infrastructure, creating a generic, flexible, and portable multi-agent platform that can be consumed by any authenticated application.

**Key Goals:**
- Move from experimental JS-locked system to production-ready architecture
- Create reusable worker nodes accessible across multiple applications
- Build provider-agnostic infrastructure that adapts to API changes
- Enable code agents to proactively maintain and update workers
- Establish foundation for text, image, video, and other AI services

---

## Architecture Decisions - FINALIZED

### Hierarchical Model: Organization → Instance → Project

**Organization**
- Top-level entity (e.g., Acme Corp., Voltage Labs)
- Has Admins who manage everything below

**Instance** (Key concept - like a VM)
- Self-contained environment with its own:
  - API keys (shared by all projects in instance)
  - Rate limits (shared pool)
  - Worker deployments (full set)
  - R2 storage buckets
- Examples: "production", "development", "staging", "client-xyz"

**Project** (Lightweight - just metadata)
- Logical grouping within an instance
- All projects in an instance share that instance's resources
- Examples: "Content Forge", "Solar Proposals", "Website Chat"

### Permission Model (Simple)
- **Super Admin**: System-wide access (Voltage Labs only)
- **Admin**: Manages org - creates instances, assigns users, sets API keys/limits
- **User**: Accesses assigned instances - can call workers, create projects

### Authentication
- API key-based for MVP
- Users/Projects authenticate with API key
- Config Service looks up which instance they belong to
- Workers use that instance's configuration

### Rate Limiting
- Per Instance per Provider
- All projects in an instance share the rate limit pool
- Implemented via Durable Objects
- Key format: `instance:{instance_id}:provider:{provider_name}`

### Instance Deployment
- Each instance = separate worker deployments
- Same code, different URLs (e.g., image-gen-prod.workers.dev, image-gen-dev.workers.dev)
- Configuration stored in Config Service (D1), cached aggressively
- GitHub Actions deploy to selected instances on code push

---

## MVP Scope - What We're Building

### MVP Goals
- 2-3 instances to prove the concept
- One functional worker (Image Generation with Ideogram)
- Basic Config Service for instance management
- Simple authentication (API keys)
- Rate limiting per instance
- Monitoring and logging
- GitHub-based deployment automation

### What's IN Scope for MVP
1. Config/Management Service (single worker + D1)
2. Instance deployment tooling
3. Image Generation Worker with Ideogram provider
4. Provider Adapter Framework (extensible for future providers)
5. Rate Limiting via Durable Objects
6. R2 storage integration
7. Basic monitoring/logging
8. Simple testing GUI
9. GitHub Actions for deployment
10. Admin interface for instance management

### What's OUT of Scope for MVP
- Complex user permissions per worker
- Multi-org management (single org for now)
- Billing/usage tiers
- Advanced routing/orchestration
- A/B testing
- Multiple providers (start with just Ideogram)
- Text/video generation workers (image only)
- Code agent auto-updates (manual for MVP)

---

## System Architecture - Functional Decomposition

### Core Infrastructure Layer (Build First)

#### 1. **API Key Manager Worker**
- Fetch credentials from secure storage based on provider
- Handle key rotation
- Track usage per key for rate limit awareness

#### 2. **Queue Manager with Rate Limiting**
- Dynamic rate limiting per provider
- Job batching and priority
- Cross-app job coordination
- Dead letter queue for failed jobs

#### 3. **Provider Adapter Framework**
- Abstract provider interface
- Provider-specific formatters (Ideogram, OpenAI, Claude, Gemini, etc.)
- Standardized request/response format
- Provider health checking and fallback logic

#### 4. **Logging & Monitoring Infrastructure**
- Structured logging to Durable Objects or D1
- Request tracking with correlation IDs
- Performance metrics collection
- Error aggregation and alerting

#### 5. **R2 Storage Manager**
- Bucket management and selection
- Upload handling with metadata
- CDN URL generation
- Storage cleanup policies

#### 6. **Worker Registry/Discovery Service**
- Catalog of available workers and capabilities
- Version management
- API schema definitions
- Health status tracking

### Functional Workers (Build After Infrastructure)

#### 7. **Image Generation Worker**
- Accepts standardized image generation request
- Uses Provider Adapter to route to correct service
- Queues job if rate limited
- Monitors completion
- Stores to R2
- Returns image URL + metadata

#### 8. **Text Generation Worker** (Future)
- Similar pattern to image generation
- Streaming support considerations

#### 9. **Video Generation Worker** (Future)
- Long-running job handling
- Progress tracking

---

## Recommended Build Sequence (MVP Focus)

### Phase 1: Foundation Infrastructure (Week 1)
**Goal: Core services that everything depends on**

1. **D1 Database Schema** - Orgs, Instances, Users, Projects tables
2. **Config Service Worker** - CRUD operations for instances/users
3. **Authentication Middleware** - API key validation
4. **Instance Lookup Logic** - Map request → instance config

### Phase 2: First Functional Worker (Week 2)  
**Goal: End-to-end image generation working**

5. **Provider Adapter Framework** - Abstract interface + Ideogram implementation
6. **Rate Limiter (Durable Object)** - Per instance+provider tracking
7. **R2 Storage Manager** - Upload, generate URLs, bucket management
8. **Image Generation Worker** - Complete flow with one provider

### Phase 3: Operations & Deployment (Week 3)
**Goal: Make it production-ready**

9. **Error Handling & Retries** - Timeouts, fallbacks, circuit breakers
10. **Logging Infrastructure** - Structured logs to D1
11. **Instance Deployment Script** - Automate deploying new instances
12. **GitHub Actions** - CI/CD for multi-instance deployment
13. **Deploy 2 Real Instances** - Production and Development

### Phase 4: Polish & Testing (Week 4)
**Goal: Make it usable and maintainable**

14. **Testing GUI** - Simple web form to test image generation
15. **Admin Interface** - Create instances, manage users, view logs
16. **Documentation** - README, API docs, deployment guide
17. **Add Second Provider** - Validate provider adapter framework works
18. **Monitoring Dashboard** - View usage, errors, performance per instance

---

## Multi-Agent Development Plan

### Overview
Self-organizing development team structure using Claude Code agents working in parallel, managed hierarchically to build the MVP in one automated run.

### Team Structure
```
You (Project Manager)
├── Team Leader 1: Infrastructure Team
│   ├── Agent 1.1: Database Schema
│   ├── Agent 1.2: Config Service
│   ├── Agent 1.3: Auth Middleware
│   └── Agent 1.4: Instance Lookup
├── Team Leader 2: Worker Implementation Team  
│   ├── Agent 2.1: Provider Adapter Framework
│   ├── Agent 2.2: Rate Limiter
│   ├── Agent 2.3: R2 Storage Manager
│   └── Agent 2.4: Image Gen Worker
├── Team Leader 3: Operations Team
│   ├── Agent 3.1: Error Handling
│   ├── Agent 3.2: Logging System
│   ├── Agent 3.3: Deployment Scripts
│   └── Agent 3.4: GitHub Actions
└── Team Leader 4: Interface Team
    ├── Agent 4.1: Testing GUI
    ├── Agent 4.2: Admin Interface
    ├── Agent 4.3: Documentation
    └── Agent 4.4: Monitoring Dashboard
```

### Git Workflow
- Main branch: Production-ready code
- Each Team Leader works on: `team-{n}-{name}` branch
- Each Agent works on: `agent-{team}-{n}-{component}` branch
- Agents merge to Team Leader branch when complete
- Team Leaders merge to main when phase complete
- Automated conflict resolution via Claude Code
- Automated testing before merge

### Agent Coordination
- Shared knowledge base in `/docs/specs/` folder
- Each component has interface specification
- Agents write integration tests
- Team Leaders validate integration between components
- Merge conflicts resolved by Team Leaders with context of both changes

---

## Common Node Types & Sub-Nodes

### 1. **Generation Nodes**
**Purpose:** Create new content

- **Image Generation Node**
  - Sub-nodes: Provider Adapter, Prompt Optimizer, Quality Validator, Style Transfer
  
- **Text Generation Node**
  - Sub-nodes: Provider Adapter, Context Manager, Response Formatter, Token Counter
  
- **Video Generation Node**
  - Sub-nodes: Provider Adapter, Frame Optimizer, Progress Tracker, Codec Manager
  
- **Audio Generation Node**
  - Sub-nodes: Provider Adapter, Voice Selector, Audio Mixer

### 2. **Information Gathering Nodes**
**Purpose:** Collect and retrieve data

- **Web Search Node**
  - Sub-nodes: Query Optimizer, Result Ranker, Content Extractor, Cache Manager
  
- **API Data Fetcher Node**
  - Sub-nodes: Endpoint Resolver, Response Parser, Rate Limiter, Cache Layer
  
- **Database Query Node**
  - Sub-nodes: Query Builder, Result Formatter, Connection Pooler

### 3. **Processing Nodes**
**Purpose:** Transform and analyze data

- **Information Distillation Node**
  - Sub-nodes: Summarizer, Entity Extractor, Fact Checker, Relevance Scorer
  
- **Data Transformation Node**
  - Sub-nodes: Format Converter, Schema Mapper, Validator
  
- **Analysis Node**
  - Sub-nodes: Sentiment Analyzer, Topic Classifier, Pattern Detector

### 4. **Quality Control Nodes**
**Purpose:** Validate and improve outputs

- **Content QC Node**
  - Sub-nodes: Brand Compliance Checker, Factual Validator, Toxicity Filter, Format Validator
  
- **Image QC Node**
  - Sub-nodes: Resolution Checker, Content Moderator, Brand Element Detector
  
- **Editing/Refinement Node**
  - Sub-nodes: Iterative Improver, A/B Variant Generator, Style Adjuster

### 5. **Orchestration Nodes**
**Purpose:** Coordinate workflows

- **Workflow Coordinator Node**
  - Sub-nodes: Task Router, Dependency Resolver, Parallel Executor, Retry Manager
  
- **Decision Router Node**
  - Sub-nodes: Condition Evaluator, Path Selector, Context Analyzer

### 6. **Infrastructure Nodes**
**Purpose:** Support system operation

- **Authentication Node**
  - Sub-nodes: Token Validator, Permission Checker, Rate Limiter
  
- **Logging Node**
  - Sub-nodes: Event Collector, Metric Aggregator, Alert Trigger
  
- **Cache Manager Node**
  - Sub-nodes: Cache Lookup, Cache Write, Invalidation Handler, TTL Manager
  
- **Queue Manager Node**
  - Sub-nodes: Job Enqueuer, Priority Sorter, Rate Limiter, Batch Processor

### 7. **Code Agent Nodes**
**Purpose:** Maintain and improve system

- **Worker Update Agent**
  - Sub-nodes: Code Analyzer, Diff Generator, Test Runner, Deployment Manager
  
- **Performance Optimizer Agent**
  - Sub-nodes: Metrics Analyzer, Bottleneck Detector, Optimization Suggester
  
- **Provider Monitor Agent**
  - Sub-nodes: API Change Detector, Schema Validator, Migration Planner

### 8. **Guardrail Nodes**
**Purpose:** Ensure safe, compliant operation

- **Content Safety Node**
  - Sub-nodes: Input Filter, Output Filter, Context Evaluator
  
- **Cost Control Node**
  - Sub-nodes: Budget Tracker, Cost Estimator, Spend Alert
  
- **Compliance Node**
  - Sub-nodes: Policy Checker, Data Privacy Validator, Audit Logger

---

## Common Sub-Node Opportunities (Shared Across Multiple Nodes)

These sub-nodes can be built once and reused:

### **Provider Adapter** (Used by all generation nodes)
- Handles formatting for multiple AI providers
- Shared interface, provider-specific implementations

### **Rate Limiter** (Used across system)
- Queue management
- Per-provider limits
- Cross-app coordination

### **Cache Manager** (Used by data retrieval and API nodes)
- KV-based caching
- TTL management
- Cache invalidation

### **Logging/Telemetry** (Used by all nodes)
- Standardized event format
- Correlation ID tracking
- Performance metrics

### **Retry Manager** (Used by all external API calls)
- Exponential backoff
- Circuit breaker pattern
- Fallback routing

### **Response Formatter** (Used by all nodes)
- Standardized output structure
- Error formatting
- Metadata inclusion

---

## Image Generation Worker - Detailed Flow

```
1. Request Received
   ↓
2. Authentication Check
   ↓
3. Request Validation
   ↓
4. Provider Selection Logic
   ├─ Cost optimization
   ├─ Speed requirements
   ├─ Quality preferences
   └─ Availability check
   ↓
5. API Key Fetch (from Key Manager)
   ↓
6. Prompt Formatting (Provider Adapter)
   ↓
7. Rate Limit Check
   ├─ Available → Continue
   └─ Limited → Queue Job
   ↓
8. Submit to Provider
   ↓
9. Monitor Job Status
   ├─ Poll for completion
   ├─ Handle timeouts → Retry or Fallback
   └─ Handle rejections → Retry or Fallback
   ↓
10. Retrieve Completed Image
    ↓
11. Quality Check (optional)
    ↓
12. Save to R2 Bucket
    ├─ User-specified bucket
    └─ Default bucket
    ↓
13. Generate CDN URL
    ↓
14. Return Response
    ├─ Image URL
    ├─ R2 path
    ├─ Metadata (dimensions, format, provider used)
    ├─ Generation parameters
    └─ Cost/performance data
    ↓
15. Log Completion
```

---

## Design Principles

### 1. **Provider Agnostic**
- No hard-coded provider logic in core workers
- Easy to add new providers without touching main logic
- Graceful fallback chains

### 2. **Portable & Modular**
- Each worker is self-contained
- Shared sub-nodes via npm packages or git submodules
- Environment-agnostic configuration

### 3. **Observable**
- Every request fully traceable
- Performance metrics at each step
- Error context preservation

### 4. **Resilient**
- Timeout handling at every external call
- Retry logic with exponential backoff
- Circuit breakers for failing providers
- Queue system prevents resource exhaustion

### 5. **Maintainable**
- Code agents can update workers programmatically
- Version control and rollback capability
- Testing frameworks integrated
- Documentation auto-generated from code

### 6. **Cost Conscious**
- Track spend per job
- Configurable cost optimization
- Budget alerts and limits

---

## Technical Considerations

### Cloudflare Workers Constraints
- **CPU Time:** 50ms free tier, up to 30s on paid (consider for video generation)
- **Memory:** 128MB (fine for most tasks, watch for large payloads)
- **Subrequests:** 50 per request on free, 1000 on paid
- **Duration:** Consider Durable Objects for long-polling job status

### Recommended Cloudflare Services
- **Workers:** Main compute
- **Durable Objects:** Queue state, job tracking, rate limiting counters
- **R2:** Image/video/file storage
- **D1:** Structured logging, job history (if needed)
- **KV:** Fast caching, provider metadata
- **Queues:** Async job processing (if needed beyond Durable Objects)

### Provider Integration Notes
- **Ideogram:** Start here - well-documented API
- **Replicate:** Good for open-source models
- **Stability AI:** Multiple model options
- **OpenAI/DALL-E:** Straightforward integration
- **Midjourney:** May need unofficial API or Discord bridge
- **Local LLMs:** WebSocket or HTTP endpoint to your DGX

---

## Next Steps

### Immediate Actions:
1. **Review and refine this document** - add notes, questions, corrections
2. **Prioritize which infrastructure components are absolutely critical for MVP**
3. **Design the Provider Adapter interface** - this affects everything
4. **Sketch out authentication approach**
5. **Create initial Cloudflare account structure** (if not already done)

### Before Coding:
- Finalize architectural decisions from questions above
- Create API schemas for inter-worker communication
- Design database schemas for logging/tracking
- Document provider requirements and rate limits
- Set up development/staging/production environments

---

## Open Questions & Decisions Needed

*Use this section to track decisions as they're made*

- [ ] Authentication mechanism selected
- [ ] API key storage approach decided
- [ ] Queue system: Durable Objects vs Cloudflare Queues
- [ ] Logging: D1 vs external service (Axiom, Grafana Cloud, etc.)
- [ ] Code agent update workflow defined
- [ ] Provider selection algorithm designed
- [ ] Cost tracking requirements clarified
- [ ] Testing strategy established

---

## Notes & Ideas

*Capture thoughts here as we develop the plan*

- Consider using Cloudflare's AI Gateway for unified provider access and caching
- Workers AI might be good for smaller models (embeddings, classification) to reduce external calls
- MCP server integration could provide real-time API spec updates
- Could build admin dashboard as Cloudflare Pages app
- Potential to monetize this infrastructure as a service to others

---

**Document Version:** 0.1  
**Last Updated:** 2025-11-19  
**Status:** Initial Planning Phase
