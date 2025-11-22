-- D1 Database Schema for Cloudflare Multi-Agent System
-- Version: 1.0
-- Created: 2025-11-20
-- Description: Core schema for organization, instance, user, and project management

-- ============================================================================
-- TABLE: organizations
-- Description: Top-level entity representing companies or organizations
-- ============================================================================
CREATE TABLE organizations (
    org_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    billing_email TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_organizations_created_at ON organizations(created_at);

-- ============================================================================
-- TABLE: instances
-- Description: Self-contained environments (like VMs) with isolated resources
-- Each instance has its own API keys, rate limits, and worker deployments
-- ============================================================================
CREATE TABLE instances (
    instance_id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    name TEXT NOT NULL,
    config JSON NOT NULL, -- Full instance configuration including api_keys, rate_limits, worker_urls, r2_bucket
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (org_id) REFERENCES organizations(org_id) ON DELETE CASCADE
);

CREATE INDEX idx_instances_org_id ON instances(org_id);
CREATE INDEX idx_instances_created_at ON instances(created_at);

-- ============================================================================
-- TABLE: users
-- Description: User accounts with role-based access control
-- Roles: 'user' (standard access), 'admin' (org admin), 'superadmin' (system admin)
-- ============================================================================
CREATE TABLE users (
    user_id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK(role IN ('user', 'admin', 'superadmin')),
    org_id TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (org_id) REFERENCES organizations(org_id) ON DELETE CASCADE
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_org_id ON users(org_id);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_created_at ON users(created_at);

-- ============================================================================
-- TABLE: user_instance_access
-- Description: Junction table for many-to-many relationship between users and instances
-- Controls which users can access which instances
-- ============================================================================
CREATE TABLE user_instance_access (
    user_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (user_id, instance_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (instance_id) REFERENCES instances(instance_id) ON DELETE CASCADE
);

CREATE INDEX idx_user_instance_access_instance_id ON user_instance_access(instance_id);

-- ============================================================================
-- TABLE: projects
-- Description: Logical grouping within instances (lightweight metadata only)
-- All projects in an instance share that instance's resources
-- ============================================================================
CREATE TABLE projects (
    project_id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    name TEXT NOT NULL,
    settings JSON NOT NULL DEFAULT '{}', -- Project-specific settings and metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (instance_id) REFERENCES instances(instance_id) ON DELETE CASCADE
);

CREATE INDEX idx_projects_instance_id ON projects(instance_id);
CREATE INDEX idx_projects_created_at ON projects(created_at);

-- ============================================================================
-- TABLE: api_keys
-- Description: API keys for authentication
-- NOTE: key_hash stores SHA-256 hash of the actual key
-- NOTE: Cloudflare D1 provides encryption at rest for all data
-- SECURITY: Actual keys must never be logged or returned in API responses
-- ============================================================================
CREATE TABLE api_keys (
    key_id TEXT PRIMARY KEY,
    user_id TEXT, -- Nullable: key can be associated with user OR project
    project_id TEXT, -- Nullable: key can be associated with user OR project
    key_hash TEXT NOT NULL UNIQUE, -- SHA-256 hash for lookup
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at TIMESTAMP, -- Nullable: null means no expiration
    CHECK ((user_id IS NOT NULL AND project_id IS NULL) OR (user_id IS NULL AND project_id IS NOT NULL)),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_project_id ON api_keys(project_id);
CREATE INDEX idx_api_keys_expires_at ON api_keys(expires_at);

-- ============================================================================
-- TABLE: usage_logs
-- Description: Track API usage for billing and monitoring
-- Records provider usage, token consumption, and costs per instance
-- ============================================================================
CREATE TABLE usage_logs (
    log_id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    provider TEXT NOT NULL, -- e.g., 'ideogram', 'openai', 'anthropic'
    tokens_used INTEGER NOT NULL DEFAULT 0,
    cost REAL NOT NULL DEFAULT 0.0, -- Cost in USD
    request_id TEXT, -- Optional: for tracing and debugging
    FOREIGN KEY (instance_id) REFERENCES instances(instance_id) ON DELETE CASCADE
);

CREATE INDEX idx_usage_logs_instance_id ON usage_logs(instance_id);
CREATE INDEX idx_usage_logs_timestamp ON usage_logs(timestamp);
CREATE INDEX idx_usage_logs_provider ON usage_logs(provider);
CREATE INDEX idx_usage_logs_request_id ON usage_logs(request_id);

-- ============================================================================
-- TABLE: model_configs
-- Description: Configuration for AI model variants with payload mapping
-- Enables flexible, admin-managed model configurations without code changes
-- Each model variant (e.g., Gemini Veo 3.1, GPT-4) has its own configuration
-- ============================================================================
CREATE TABLE model_configs (
    config_id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL UNIQUE,
    provider_id TEXT NOT NULL, -- e.g., 'gemini', 'openai', 'ideogram', 'anthropic'
    display_name TEXT NOT NULL,
    description TEXT,
    capabilities JSON NOT NULL, -- { "image": true, "video": true, "text": false, ... }
    pricing JSON, -- { "cost_per_image": 0.08, "currency": "USD", ... }
    rate_limits JSON, -- { "rpm": 100, "tpm": 50000, ... }
    payload_mapping JSON NOT NULL, -- Template for transforming inputs to provider format
    status TEXT NOT NULL CHECK(status IN ('active', 'beta', 'deprecated')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_model_configs_model_id ON model_configs(model_id);
CREATE INDEX idx_model_configs_provider_id ON model_configs(provider_id);
CREATE INDEX idx_model_configs_status ON model_configs(status);
CREATE INDEX idx_model_configs_created_at ON model_configs(created_at DESC);

-- ============================================================================
-- ENCRYPTION NOTES
-- ============================================================================
-- Cloudflare D1 provides encryption at rest by default
-- All sensitive data (api_keys.key_hash, instances.config) is encrypted
-- Additional application-level encryption can be added for config JSON fields
-- containing API keys before storage in the config JSON column
--
-- Recommended encryption flow for instance API keys:
-- 1. Encrypt API keys using Cloudflare Workers Crypto API before storing in config JSON
-- 2. Decrypt only when needed for provider API calls
-- 3. Never return decrypted keys in API responses
-- ============================================================================
