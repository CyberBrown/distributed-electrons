-- DE Router Schema
-- Workers, Providers, Models, and Workflows

-- Workers (DE services by media type)
CREATE TABLE workers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  media_types TEXT NOT NULL,          -- JSON array: ['text'], ['image', 'video']
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Providers (external services)
CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,                  -- 'api', 'local', 'gateway'
  base_endpoint TEXT,
  auth_type TEXT,                      -- 'api_key', 'bearer', 'none'
  auth_secret_name TEXT,               -- env var name: 'ANTHROPIC_API_KEY'
  priority INTEGER DEFAULT 100,
  enabled INTEGER DEFAULT 1,
  rate_limit_rpm INTEGER,
  daily_quota INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Models (specific models per provider)
CREATE TABLE models (
  id TEXT PRIMARY KEY,                 -- 'anthropic:claude-sonnet-4'
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,              -- Provider's model ID
  worker_id TEXT NOT NULL,             -- Which worker this model serves
  capabilities TEXT,                   -- JSON: ['reasoning', 'code', 'vision']
  context_window INTEGER,
  cost_input_per_1k REAL,
  cost_output_per_1k REAL,
  quality_tier TEXT,                   -- 'draft', 'standard', 'premium'
  speed_tier TEXT,                     -- 'fast', 'medium', 'slow'
  priority INTEGER DEFAULT 100,
  enabled INTEGER DEFAULT 1,
  FOREIGN KEY (provider_id) REFERENCES providers(id),
  FOREIGN KEY (worker_id) REFERENCES workers(id)
);

-- Worker-Provider mapping
CREATE TABLE worker_providers (
  worker_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  priority INTEGER DEFAULT 100,
  PRIMARY KEY (worker_id, provider_id),
  FOREIGN KEY (worker_id) REFERENCES workers(id),
  FOREIGN KEY (provider_id) REFERENCES providers(id)
);

-- Provider runtime status
CREATE TABLE provider_status (
  provider_id TEXT PRIMARY KEY,
  healthy INTEGER DEFAULT 1,
  last_success_at TEXT,
  last_failure_at TEXT,
  consecutive_failures INTEGER DEFAULT 0,
  quota_used_today INTEGER DEFAULT 0,
  quota_resets_at TEXT,
  marked_exhausted_until TEXT,
  FOREIGN KEY (provider_id) REFERENCES providers(id)
);

-- Stored workflows
CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  definition TEXT NOT NULL,            -- JSON workflow definition
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX idx_models_provider ON models(provider_id);
CREATE INDEX idx_models_worker ON models(worker_id);
CREATE INDEX idx_worker_providers_worker ON worker_providers(worker_id);
CREATE INDEX idx_provider_status_healthy ON provider_status(healthy);
