# DE Request Router - Next Steps & Strategy

**Session Date:** 2025-12-08
**Status:** Architecture Design Phase
**Related:** ecosystem-agent integration, Mnemo context caching

---

## Executive Summary

This document outlines the strategy for building the DE Request Router - a central orchestration system that manages AI requests from multiple client apps, routes them to appropriate workers, handles long-running LLM operations without timeouts, and delivers results back to clients.

**Problem Being Solved:**
- ecosystem-agent calling Mnemo directly causes 19+ second timeouts
- CF Worker-to-Worker calls fail for long-running Gemini context queries
- No centralized request management across DE services

---

## Full Architecture Vision

### End-to-End Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│ A) USER REQUEST                                                          │
│    "Draw me a picture of a monkey"                                       │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ B) CLIENT APP (e.g., image app that only creates red pictures)           │
│    - Optionally formats/enriches request                                 │
│    - Adds app-specific context ("make it red")                           │
│    - Or sends query as-is                                                │
│    - Sends to DE Intake Worker                                           │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ C) INTAKE WORKER                                                         │
│    - Accepts query                                                       │
│    - Applies metadata (app_id, timestamp, request_id)                    │
│    - Saves query + metadata to D1                                        │
│    - Notifies Request Router DO about new request                        │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ D) REQUEST ROUTER (Durable Object)                                       │
│    - Determines task type (text, image, video, audio, context, etc.)     │
│    - Can use NLP/classifier worker to analyze natural language query     │
│    - Matches query to appropriate task type                              │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ E) PROVIDER/MODEL SELECTION                                              │
│    - Based on task type, selects provider + model                        │
│    - Examples:                                                           │
│      • Illustration → Gemini Nano Banana                                 │
│      • Photo-realistic → Ideogram                                        │
│      • Text generation → OpenAI/Anthropic                                │
│      • Context query → Mnemo (Gemini context cache)                      │
│    - Updates query metadata with type + provider + model                 │
│    - DO notified of provider selection                                   │
│    - DO queues request based on provider's rate limits                   │
│      (Rate limits stored in DB, per provider/model)                      │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ F) PROCESSING WORKER (when queue turn comes up)                          │
│    - Formats query into provider-specific prompt                         │
│    - Uses established JSON template required by LLM                      │
│    - Adds specialized prompt content from Prompt Library                 │
│      • Facebook posts prompt                                             │
│      • Blog posts prompt                                                 │
│      • Educational articles prompt                                       │
│      • Image generation prompts                                          │
│    - Sends formatted payload to provider                                 │
│    - DOES NOT WAIT for response (fire and forget)                        │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ G) DELIVERY WORKER (receives provider response)                          │
│    - Receives deliverable (or error/timeout) from provider               │
│    - Saves deliverable to database                                       │
│    - Performs quality control                                            │
│    - Updates DO with status                                              │
│    - Post-processing chains possible:                                    │
│      • Facebook post: gets image + text                                  │
│      • Images graded, best selected                                      │
│      • Copy adjusted to match image                                      │
│      • Multi-step chains supported                                       │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ H) DELIVERY TO CLIENT                                                    │
│    - Once deliverable gets green light                                   │
│    - Routed back to requesting app                                       │
│    - Via callback URL or polling                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Key Components to Build

### 1. Intake Worker
- Endpoint: `POST /intake`
- Accepts raw queries from client apps
- Adds metadata, saves to D1
- Notifies Router DO

### 2. Request Router Durable Object
- Central orchestration
- Task type classification
- Provider/model selection
- Queue management per provider rate limits
- Status tracking

### 3. Task Classifier (Worker or within DO)
- NLP-based query analysis
- Determines: text, image, video, audio, context, etc.
- Maps to appropriate worker type

### 4. Provider Selector
- Rules engine for provider/model selection
- Example rules:
  - `illustration` → `gemini-nano-banana`
  - `photo-realistic` → `ideogram`
  - `context-query` → `mnemo`
  - `text-generation` → `openai/anthropic`

### 5. Processing Workers (per type)
- text-gen-processor
- image-gen-processor
- mnemo-processor
- audio-gen-processor
- Fire payloads, don't wait

### 6. Delivery Worker
- Webhook endpoint for provider callbacks
- Or polling mechanism for providers without callbacks
- Quality control
- Post-processing chains
- Final delivery to client

### 7. Rate Limits Database
- Per provider/model limits
- Queue position tracking
- D1 table structure needed

### 8. Prompt Library
- Specialized prompts per task type
- Facebook posts, blog posts, educational, etc.
- Storage: D1 or KV

---

## Database Schema Additions

```sql
-- Requests table
CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  query TEXT NOT NULL,
  metadata JSON,
  task_type TEXT,
  provider TEXT,
  model TEXT,
  status TEXT DEFAULT 'pending',
  queue_position INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  completed_at DATETIME
);

-- Rate limits table
CREATE TABLE rate_limits (
  provider TEXT NOT NULL,
  model TEXT,
  rpm INTEGER NOT NULL,  -- requests per minute
  tpm INTEGER,           -- tokens per minute
  concurrent INTEGER,    -- max concurrent
  PRIMARY KEY (provider, model)
);

-- Prompt library table
CREATE TABLE prompts (
  id TEXT PRIMARY KEY,
  task_type TEXT NOT NULL,
  name TEXT NOT NULL,
  template TEXT NOT NULL,
  variables JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Deliverables table
CREATE TABLE deliverables (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  provider_response JSON,
  quality_score REAL,
  status TEXT DEFAULT 'pending_review',
  post_processing_chain JSON,
  final_output JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES requests(id)
);
```

---

## Follow-Up Questions

### Durable Objects Mechanics

1. **DO Persistence:** How long does DO state persist? If a DO hasn't been accessed in hours, does it lose in-memory state? Should we always persist to D1?

2. **DO Alarms:** Can a DO alarm trigger another DO? Or should alarms only trigger the same DO that set them?

3. **DO Concurrency:** If multiple requests hit the same DO simultaneously, how is concurrency handled? Is there automatic queuing?

4. **DO Communication:** Best pattern for Worker → DO → Worker communication? Should workers poll the DO or should DO push to workers?

5. **DO Cost:** What's the cost model for DOs? Per request? Per alarm? Per storage?

### Architecture Questions

6. **Callback vs Polling:** For providers without webhook callbacks (like Gemini), should the Delivery Worker poll, or should we use DO Alarms to check status?

7. **Processing Worker Fire-and-Forget:** When the Processing Worker sends to a provider and doesn't wait, how does the Delivery Worker know where to send the response? Is there a correlation ID passed to the provider?

8. **Multi-Step Chains:** For complex deliverables (image + text, grading, adjustment), should each step be a separate request through the Router, or handled within the Delivery Worker?

9. **Quality Control:** What does QC look like? Is it automated (ML-based scoring), manual (human review queue), or rule-based?

10. **Error Handling:** If a provider fails, where does retry logic live? In the Router DO? In a separate retry worker?

### Rate Limiting Questions

11. **Rate Limit Scope:** Are rate limits per-app, per-provider, or per-provider-per-app?

12. **Queue Priority:** Should some apps or request types have priority in the queue?

13. **Overflow Handling:** When queue is full, reject immediately or return estimated wait time?

### Integration Questions

14. **ecosystem-agent Migration:** Should ecosystem-agent use the full Router flow, or a simplified direct path to Mnemo while Router is being built?

15. **Existing Workers:** How do existing text-gen and image-gen workers fit? Wrap them? Replace them? Run parallel?

16. **Auth Model:** Per-app API keys? JWT? How does the Intake Worker validate requests?

---

## Implementation Phases

### Phase 1: Foundation (Priority)
- [ ] Create Intake Worker
- [ ] Create Request Router DO (basic)
- [ ] Create D1 schema for requests
- [ ] Simple task type detection (hardcoded rules)
- [ ] Direct routing to existing workers

### Phase 2: Queue & Rate Limits
- [ ] Rate limits database
- [ ] Queue management in Router DO
- [ ] Per-provider rate limiting

### Phase 3: Fire-and-Forget Processing
- [ ] Refactor processing workers to not wait
- [ ] Create Delivery Worker
- [ ] Webhook/polling for provider responses
- [ ] Status updates to Router DO

### Phase 4: Intelligence
- [ ] NLP-based task classification
- [ ] Dynamic provider/model selection
- [ ] Prompt library integration

### Phase 5: Quality & Chains
- [ ] Quality control system
- [ ] Post-processing chains
- [ ] Multi-step deliverables

---

## Immediate Next Steps

1. **Answer architecture questions** (above) to finalize design
2. **Create Intake Worker** as first component
3. **Create basic Router DO** with simple routing
4. **Test with ecosystem-agent** using simplified flow
5. **Iterate** based on learnings

---

## Related Documents

- `/docs/specs/REQUEST_ROUTER_DESIGN.md` - Initial design doc
- `/workers/text-gen/README.md` - Existing text-gen worker
- `/workers/shared/rate-limiter/` - Existing rate limiter DO

---

## Session Notes

**What was accomplished this session:**
- Identified root cause of ecosystem-agent timeout issues (CF Worker-to-Worker limitations)
- Confirmed Mnemo API key is valid, queries work but take 19+ seconds
- Cleaned up ecosystem-agent MnemoClient (removed unused API key parameter)
- Created CLAUDE.md for ecosystem-agent
- Designed initial Request Router architecture
- Documented expanded vision for full request flow

**What's blocked:**
- ecosystem-agent cannot reliably query Mnemo until Router is built
- Need answers to DO mechanics questions before implementation

**Temporary workaround:**
- ecosystem-agent cache was manually created
- Queries work when called directly (not from CF Worker)
