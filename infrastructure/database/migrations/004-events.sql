-- Migration: Events & Activity Tracking
-- Version: 1.3
-- Created: 2025-12-13
-- Description: Activity tracking and event logging for audit trails and user activity feeds

-- ============================================================================
-- TABLE: events
-- Description: Core event log for all trackable actions across the platform
-- Supports polymorphic associations via eventable_type/eventable_id
-- ============================================================================
CREATE TABLE events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,              -- Organization/instance scope
    user_id TEXT,                         -- User who triggered the event (null for system events)
    action TEXT NOT NULL,                 -- Event action: created, updated, deleted, generated, etc.
    eventable_type TEXT NOT NULL,         -- Polymorphic type: request, deliverable, model_config, etc.
    eventable_id TEXT NOT NULL,           -- ID of the related entity
    particulars JSON,                     -- Event-specific details and metadata
    ip_address TEXT,                      -- Client IP for audit purposes
    user_agent TEXT,                      -- Client user agent
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_events_tenant_id ON events(tenant_id);
CREATE INDEX idx_events_user_id ON events(user_id);
CREATE INDEX idx_events_action ON events(action);
CREATE INDEX idx_events_eventable ON events(eventable_type, eventable_id);
CREATE INDEX idx_events_created_at ON events(created_at DESC);
CREATE INDEX idx_events_tenant_created ON events(tenant_id, created_at DESC);

-- ============================================================================
-- TABLE: event_subscriptions
-- Description: Webhook subscriptions for real-time event notifications
-- ============================================================================
CREATE TABLE event_subscriptions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    webhook_url TEXT NOT NULL,
    secret TEXT,                          -- For webhook signature verification
    event_types JSON NOT NULL,            -- Array of event types to subscribe to
    filters JSON,                         -- Optional filters (e.g., specific user_id, eventable_type)
    is_active INTEGER DEFAULT 1,
    retry_count INTEGER DEFAULT 0,
    last_failure TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_event_subscriptions_tenant ON event_subscriptions(tenant_id);
CREATE INDEX idx_event_subscriptions_active ON event_subscriptions(is_active);

-- ============================================================================
-- TABLE: event_deliveries
-- Description: Track webhook delivery attempts for subscriptions
-- ============================================================================
CREATE TABLE event_deliveries (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending'         -- pending, delivered, failed, retrying
        CHECK(status IN ('pending', 'delivered', 'failed', 'retrying')),
    attempts INTEGER DEFAULT 0,
    last_attempt_at DATETIME,
    response_code INTEGER,
    response_body TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (subscription_id) REFERENCES event_subscriptions(id) ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX idx_event_deliveries_subscription ON event_deliveries(subscription_id);
CREATE INDEX idx_event_deliveries_event ON event_deliveries(event_id);
CREATE INDEX idx_event_deliveries_status ON event_deliveries(status);

-- ============================================================================
-- TABLE: activity_feed
-- Description: Denormalized activity feed for fast retrieval
-- Pre-computed feed entries for dashboard display
-- ============================================================================
CREATE TABLE activity_feed (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT,
    event_id TEXT NOT NULL,
    feed_type TEXT NOT NULL,              -- global, user, project, etc.
    title TEXT NOT NULL,                  -- Human-readable event title
    description TEXT,                     -- Human-readable event description
    icon TEXT,                            -- Icon identifier for UI
    link TEXT,                            -- Deep link to related resource
    metadata JSON,                        -- Additional display metadata
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX idx_activity_feed_tenant ON activity_feed(tenant_id);
CREATE INDEX idx_activity_feed_user ON activity_feed(user_id);
CREATE INDEX idx_activity_feed_type ON activity_feed(feed_type);
CREATE INDEX idx_activity_feed_created ON activity_feed(created_at DESC);
CREATE INDEX idx_activity_feed_unread ON activity_feed(tenant_id, is_read) WHERE is_read = 0;

-- ============================================================================
-- TABLE: metrics_snapshots
-- Description: Periodic snapshots of key metrics for analytics
-- ============================================================================
CREATE TABLE metrics_snapshots (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    snapshot_type TEXT NOT NULL,          -- hourly, daily, weekly, monthly
    period_start DATETIME NOT NULL,
    period_end DATETIME NOT NULL,
    metrics JSON NOT NULL,                -- Aggregated metrics for the period
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_metrics_snapshots_tenant ON metrics_snapshots(tenant_id);
CREATE INDEX idx_metrics_snapshots_type ON metrics_snapshots(snapshot_type);
CREATE INDEX idx_metrics_snapshots_period ON metrics_snapshots(period_start, period_end);

-- ============================================================================
-- Predefined event actions
-- ============================================================================
-- Generation events:
--   request.created, request.queued, request.processing, request.completed, request.failed, request.cancelled
--   deliverable.created, deliverable.approved, deliverable.rejected, deliverable.delivered
--   generation.started, generation.completed, generation.failed
--
-- Model config events:
--   model_config.created, model_config.updated, model_config.deleted, model_config.activated, model_config.deprecated
--
-- User events:
--   user.created, user.updated, user.deleted, user.login, user.logout
--   api_key.created, api_key.revoked
--
-- System events:
--   system.health_check, system.rate_limit_hit, system.error
