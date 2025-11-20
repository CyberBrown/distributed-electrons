-- ============================================================================
-- MIGRATION: 001-initial
-- Description: Initial database schema for Cloudflare multi-agent system
-- Author: Agent 1.1
-- Date: 2025-11-20
-- ============================================================================

-- MIGRATION START --

-- ============================================================================
-- TABLE: organizations
-- Description: Top-level entity representing companies or organizations
-- Migration Notes: First table - no dependencies
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
-- Migration Notes: Depends on organizations table
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
-- Migration Notes: Depends on organizations table
-- Roles: 'user', 'admin', 'superadmin'
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
-- Migration Notes: Depends on users and instances tables
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
-- Migration Notes: Depends on instances table
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
-- Migration Notes: Depends on users and projects tables
-- Security: Stores SHA-256 hash only, never plaintext keys
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
-- Migration Notes: Depends on instances table
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
-- MIGRATION VALIDATION
-- ============================================================================
-- After running this migration, verify:
-- 1. All 7 tables created successfully
-- 2. All foreign key constraints are in place
-- 3. All indexes are created
-- 4. Check constraints work (test invalid role insertion)
-- 5. Unique constraints work (test duplicate email insertion)
-- ============================================================================

-- MIGRATION END --

-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
-- To rollback this migration, run the following in reverse order:
-- DROP TABLE usage_logs;
-- DROP TABLE api_keys;
-- DROP TABLE projects;
-- DROP TABLE user_instance_access;
-- DROP TABLE users;
-- DROP TABLE instances;
-- DROP TABLE organizations;
-- ============================================================================
