-- Migration: OAuth Credential Tracking
-- Version: 006
-- Created: 2025-12-20
-- Description: Track OAuth credential status and refresh history for human-in-the-loop re-auth

-- ============================================================================
-- TABLE: oauth_credentials
-- Description: Track OAuth credential metadata (not the actual tokens - those are in KV)
-- ============================================================================
CREATE TABLE IF NOT EXISTS oauth_credentials (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,              -- 'claude_max', etc.
    status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active', 'expired', 'refreshing', 'invalid')),
    expires_at DATETIME,
    last_used_at DATETIME,
    last_refreshed_at DATETIME,
    failure_count INTEGER DEFAULT 0,
    last_failure_reason TEXT,
    metadata TEXT,                       -- JSON metadata
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraint on provider (only one credential per provider)
CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_credentials_provider ON oauth_credentials(provider);

-- Index for status queries
CREATE INDEX IF NOT EXISTS idx_oauth_credentials_status ON oauth_credentials(status);

-- Index for expiration queries
CREATE INDEX IF NOT EXISTS idx_oauth_credentials_expires ON oauth_credentials(expires_at);

-- ============================================================================
-- TABLE: oauth_refresh_history
-- Description: Audit log of OAuth refresh attempts
-- ============================================================================
CREATE TABLE IF NOT EXISTS oauth_refresh_history (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    action TEXT NOT NULL,                -- 'refresh', 'expire', 'validate', 'fail'
    success INTEGER NOT NULL,            -- 1 = success, 0 = failure
    error_message TEXT,
    initiated_by TEXT,                   -- 'user', 'system', 'scheduled'
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for provider history
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_history_provider ON oauth_refresh_history(provider);

-- Index for recent history queries
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_history_created ON oauth_refresh_history(created_at DESC);

-- ============================================================================
-- Insert initial record for claude_max provider
-- ============================================================================
INSERT OR IGNORE INTO oauth_credentials (id, provider, status, created_at, updated_at)
VALUES (
    'oauth_claude_max',
    'claude_max',
    'active',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);
