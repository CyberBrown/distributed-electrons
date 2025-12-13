-- Migration: Request Router Schema
-- Version: 1.2
-- Created: 2025-12-13
-- Description: Tables for async request routing, queuing, and delivery system
-- Reference: docs/NEXT_STEPS_REQUEST_ROUTER.md

-- ============================================================================
-- TABLE: requests
-- Description: Incoming requests from client apps awaiting processing
-- Tracks the full lifecycle: pending -> queued -> processing -> completed/failed
-- ============================================================================
CREATE TABLE requests (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL,                    -- Client app identifier
    instance_id TEXT,                        -- Optional: linked instance
    query TEXT NOT NULL,                     -- Raw user query/request
    metadata JSON,                           -- App-specific context, enrichments
    task_type TEXT,                          -- Detected type: text, image, video, audio, context
    provider TEXT,                           -- Selected provider: openai, anthropic, gemini, ideogram, etc.
    model TEXT,                              -- Selected model ID
    status TEXT DEFAULT 'pending' NOT NULL   -- pending, queued, processing, completed, failed, cancelled
        CHECK(status IN ('pending', 'queued', 'processing', 'completed', 'failed', 'cancelled')),
    priority INTEGER DEFAULT 0,              -- Queue priority (higher = more urgent)
    queue_position INTEGER,                  -- Position in provider queue
    retry_count INTEGER DEFAULT 0,           -- Number of retry attempts
    max_retries INTEGER DEFAULT 3,           -- Maximum retry attempts allowed
    error_message TEXT,                      -- Error details if failed
    callback_url TEXT,                       -- Optional webhook for delivery
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    queued_at DATETIME,                      -- When added to provider queue
    started_at DATETIME,                     -- When processing began
    completed_at DATETIME,                   -- When processing finished
    FOREIGN KEY (instance_id) REFERENCES instances(instance_id) ON DELETE SET NULL
);

CREATE INDEX idx_requests_app_id ON requests(app_id);
CREATE INDEX idx_requests_instance_id ON requests(instance_id);
CREATE INDEX idx_requests_status ON requests(status);
CREATE INDEX idx_requests_task_type ON requests(task_type);
CREATE INDEX idx_requests_provider ON requests(provider);
CREATE INDEX idx_requests_priority_created ON requests(priority DESC, created_at ASC);
CREATE INDEX idx_requests_created_at ON requests(created_at DESC);

-- ============================================================================
-- TABLE: rate_limits
-- Description: Provider/model rate limit configurations
-- Used by Router DO to manage queue throughput
-- ============================================================================
CREATE TABLE rate_limits (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT,                              -- NULL means applies to all models for provider
    requests_per_minute INTEGER NOT NULL DEFAULT 60,    -- RPM limit
    tokens_per_minute INTEGER,               -- TPM limit (for text models)
    concurrent_requests INTEGER DEFAULT 5,   -- Max simultaneous requests
    burst_limit INTEGER,                     -- Short burst allowance
    cooldown_seconds INTEGER DEFAULT 60,     -- Cooldown after hitting limit
    is_active INTEGER DEFAULT 1,             -- Enable/disable this limit
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider, model)
);

CREATE INDEX idx_rate_limits_provider ON rate_limits(provider);
CREATE INDEX idx_rate_limits_provider_model ON rate_limits(provider, model);

-- ============================================================================
-- TABLE: prompts
-- Description: Prompt library for specialized task types
-- Templates can include variables like {user_query}, {context}, etc.
-- ============================================================================
CREATE TABLE prompts (
    id TEXT PRIMARY KEY,
    task_type TEXT NOT NULL,                 -- text, image, facebook_post, blog, educational, etc.
    name TEXT NOT NULL,
    description TEXT,
    template TEXT NOT NULL,                  -- Prompt template with variable placeholders
    variables JSON,                          -- Schema for expected variables: {"user_query": "string", "context": "string"}
    provider TEXT,                           -- Optional: provider-specific prompt
    model TEXT,                              -- Optional: model-specific prompt
    is_default INTEGER DEFAULT 0,            -- Is this the default for task_type?
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_prompts_task_type ON prompts(task_type);
CREATE INDEX idx_prompts_task_type_default ON prompts(task_type, is_default) WHERE is_default = 1;
CREATE INDEX idx_prompts_provider_model ON prompts(provider, model);

-- ============================================================================
-- TABLE: deliverables
-- Description: Results/outputs from processed requests
-- Supports quality scoring and post-processing chains
-- ============================================================================
CREATE TABLE deliverables (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    provider_response JSON,                  -- Raw response from provider
    content_type TEXT,                       -- text, image_url, audio_url, video_url, json
    content TEXT,                            -- Extracted main content (text or URL)
    quality_score REAL,                      -- 0.0 to 1.0 quality assessment
    quality_metadata JSON,                   -- Quality assessment details
    status TEXT DEFAULT 'pending_review' NOT NULL
        CHECK(status IN ('pending_review', 'approved', 'rejected', 'processing', 'delivered', 'failed')),
    post_processing_chain JSON,              -- Chain of post-processing steps
    post_processing_status TEXT,             -- Current step in chain
    final_output JSON,                       -- Final processed output
    delivered_at DATETIME,                   -- When delivered to client
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
);

CREATE INDEX idx_deliverables_request_id ON deliverables(request_id);
CREATE INDEX idx_deliverables_status ON deliverables(status);
CREATE INDEX idx_deliverables_quality_score ON deliverables(quality_score DESC);
CREATE INDEX idx_deliverables_created_at ON deliverables(created_at DESC);

-- ============================================================================
-- TABLE: queue_stats
-- Description: Real-time queue statistics per provider/model
-- Updated by Router DO for monitoring and decisions
-- ============================================================================
CREATE TABLE queue_stats (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT,
    queued_count INTEGER DEFAULT 0,          -- Requests waiting in queue
    processing_count INTEGER DEFAULT 0,      -- Currently processing
    completed_today INTEGER DEFAULT 0,       -- Completed in last 24h
    failed_today INTEGER DEFAULT 0,          -- Failed in last 24h
    avg_processing_time_ms INTEGER,          -- Average processing time
    last_request_at DATETIME,
    last_completion_at DATETIME,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider, model)
);

CREATE INDEX idx_queue_stats_provider ON queue_stats(provider);
CREATE INDEX idx_queue_stats_provider_model ON queue_stats(provider, model);

-- ============================================================================
-- TABLE: task_classifications
-- Description: Mapping rules for query -> task type classification
-- Used by Router DO or classifier worker
-- ============================================================================
CREATE TABLE task_classifications (
    id TEXT PRIMARY KEY,
    pattern TEXT NOT NULL,                   -- Regex or keyword pattern
    pattern_type TEXT DEFAULT 'keyword'      -- keyword, regex, ml_label
        CHECK(pattern_type IN ('keyword', 'regex', 'ml_label')),
    task_type TEXT NOT NULL,                 -- Resulting task type
    confidence_boost REAL DEFAULT 0,         -- Boost to classification confidence
    priority INTEGER DEFAULT 0,              -- Rule evaluation priority
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_task_classifications_task_type ON task_classifications(task_type);
CREATE INDEX idx_task_classifications_priority ON task_classifications(priority DESC);

-- ============================================================================
-- TABLE: provider_routing_rules
-- Description: Rules for selecting provider/model based on task type
-- Supports A/B testing, load balancing, cost optimization
-- ============================================================================
CREATE TABLE provider_routing_rules (
    id TEXT PRIMARY KEY,
    task_type TEXT NOT NULL,
    subtask TEXT,                            -- Optional refinement: illustration, photo-realistic, etc.
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    weight INTEGER DEFAULT 100,              -- For weighted random selection (A/B testing)
    cost_tier TEXT,                          -- low, medium, high
    quality_tier TEXT,                       -- standard, premium
    is_default INTEGER DEFAULT 0,            -- Default route for task_type
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_provider_routing_rules_task_type ON provider_routing_rules(task_type);
CREATE INDEX idx_provider_routing_rules_task_subtask ON provider_routing_rules(task_type, subtask);

-- ============================================================================
-- SEED DATA: Default rate limits for known providers
-- ============================================================================
INSERT INTO rate_limits (id, provider, model, requests_per_minute, tokens_per_minute, concurrent_requests) VALUES
    ('rl-openai-default', 'openai', NULL, 60, 90000, 10),
    ('rl-openai-gpt4', 'openai', 'gpt-4o', 40, 40000, 5),
    ('rl-anthropic-default', 'anthropic', NULL, 50, 100000, 10),
    ('rl-anthropic-claude', 'anthropic', 'claude-3-5-sonnet', 50, 80000, 5),
    ('rl-ideogram-default', 'ideogram', NULL, 30, NULL, 5),
    ('rl-gemini-default', 'gemini', NULL, 60, 100000, 10),
    ('rl-elevenlabs-default', 'elevenlabs', NULL, 30, NULL, 5);

-- ============================================================================
-- SEED DATA: Default task classifications
-- ============================================================================
INSERT INTO task_classifications (id, pattern, pattern_type, task_type, priority) VALUES
    ('tc-image-draw', 'draw|paint|sketch|illustrate', 'keyword', 'image', 10),
    ('tc-image-photo', 'photo|picture|image|photograph', 'keyword', 'image', 10),
    ('tc-image-generate', 'generate.*image|create.*image|make.*image', 'regex', 'image', 15),
    ('tc-text-write', 'write|compose|draft|create.*text', 'keyword', 'text', 10),
    ('tc-text-explain', 'explain|describe|summarize', 'keyword', 'text', 10),
    ('tc-audio-speak', 'speak|say|narrate|voice', 'keyword', 'audio', 10),
    ('tc-audio-tts', 'text.to.speech|tts|read.*aloud', 'regex', 'audio', 15),
    ('tc-video-render', 'render|video|animation|animate', 'keyword', 'video', 10),
    ('tc-context-query', 'from.*context|in.*codebase|search.*docs', 'regex', 'context', 15);

-- ============================================================================
-- SEED DATA: Default provider routing rules
-- ============================================================================
INSERT INTO provider_routing_rules (id, task_type, subtask, provider, model, weight, is_default) VALUES
    ('pr-image-default', 'image', NULL, 'ideogram', 'ideogram-v2', 100, 1),
    ('pr-image-illustration', 'image', 'illustration', 'gemini', 'gemini-nano-banana', 100, 0),
    ('pr-image-photo', 'image', 'photo-realistic', 'ideogram', 'ideogram-v2', 100, 0),
    ('pr-text-default', 'text', NULL, 'anthropic', 'claude-3-5-sonnet', 100, 1),
    ('pr-text-fast', 'text', 'fast', 'anthropic', 'claude-3-5-haiku', 100, 0),
    ('pr-text-openai', 'text', NULL, 'openai', 'gpt-4o', 50, 0),
    ('pr-audio-default', 'audio', NULL, 'elevenlabs', 'eleven_multilingual_v2', 100, 1),
    ('pr-context-default', 'context', NULL, 'gemini', 'gemini-context', 100, 1);

-- ============================================================================
-- SEED DATA: Default prompts for common task types
-- ============================================================================
INSERT INTO prompts (id, task_type, name, template, variables, is_default) VALUES
    ('p-image-default', 'image', 'Default Image Prompt', '{user_query}', '{"user_query": "string"}', 1),
    ('p-text-default', 'text', 'Default Text Prompt', '{user_query}', '{"user_query": "string"}', 1),
    ('p-facebook-post', 'text', 'Facebook Post', 'Write an engaging Facebook post about: {user_query}\n\nRequirements:\n- Keep it under 500 characters\n- Include a call to action\n- Use an engaging tone', '{"user_query": "string"}', 0),
    ('p-blog-post', 'text', 'Blog Post', 'Write a blog post about: {user_query}\n\nStructure:\n- Engaging title\n- Introduction hook\n- 3-5 main points with examples\n- Conclusion with takeaways', '{"user_query": "string"}', 0),
    ('p-educational', 'text', 'Educational Article', 'Create an educational explanation of: {user_query}\n\nRequirements:\n- Use clear, accessible language\n- Include examples and analogies\n- Build from simple to complex concepts', '{"user_query": "string"}', 0);
