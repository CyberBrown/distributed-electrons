/**
 * Event Types for Activity Tracking
 */

// Event actions by category
export type RequestAction =
  | 'request.created'
  | 'request.queued'
  | 'request.processing'
  | 'request.completed'
  | 'request.failed'
  | 'request.cancelled';

export type DeliverableAction =
  | 'deliverable.created'
  | 'deliverable.approved'
  | 'deliverable.rejected'
  | 'deliverable.delivered';

export type GenerationAction =
  | 'generation.started'
  | 'generation.completed'
  | 'generation.failed';

export type ModelConfigAction =
  | 'model_config.created'
  | 'model_config.updated'
  | 'model_config.deleted'
  | 'model_config.activated'
  | 'model_config.deprecated';

export type UserAction =
  | 'user.created'
  | 'user.updated'
  | 'user.deleted'
  | 'user.login'
  | 'user.logout'
  | 'api_key.created'
  | 'api_key.revoked';

export type SystemAction =
  | 'system.health_check'
  | 'system.rate_limit_hit'
  | 'system.error';

export type OAuthAction =
  | 'oauth.expired'
  | 'oauth.refresh_needed'
  | 'oauth.refreshed'
  | 'oauth.validation_failed';

export type EventAction =
  | RequestAction
  | DeliverableAction
  | GenerationAction
  | ModelConfigAction
  | UserAction
  | SystemAction
  | OAuthAction;

// Eventable types (polymorphic association)
export type EventableType =
  | 'request'
  | 'deliverable'
  | 'model_config'
  | 'user'
  | 'api_key'
  | 'instance'
  | 'organization'
  | 'project'
  | 'system'
  | 'oauth_credentials';

// Core event structure
export interface Event {
  id: string;
  tenant_id: string;
  user_id?: string;
  action: EventAction;
  eventable_type: EventableType;
  eventable_id: string;
  particulars?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
  created_at: string;
}

// Event creation input
export interface CreateEventInput {
  tenant_id: string;
  user_id?: string;
  action: EventAction;
  eventable_type: EventableType;
  eventable_id: string;
  particulars?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
}

// Activity feed item
export interface ActivityFeedItem {
  id: string;
  tenant_id: string;
  user_id?: string;
  event_id: string;
  feed_type: 'global' | 'user' | 'project' | 'instance';
  title: string;
  description?: string;
  icon?: string;
  link?: string;
  metadata?: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

// Event subscription for webhooks
export interface EventSubscription {
  id: string;
  tenant_id: string;
  name: string;
  webhook_url: string;
  secret?: string;
  event_types: EventAction[];
  filters?: {
    user_id?: string;
    eventable_type?: EventableType;
    eventable_id?: string;
  };
  is_active: boolean;
  retry_count: number;
  last_failure?: string;
  created_at: string;
  updated_at: string;
}

// Webhook delivery status
export interface EventDelivery {
  id: string;
  subscription_id: string;
  event_id: string;
  status: 'pending' | 'delivered' | 'failed' | 'retrying';
  attempts: number;
  last_attempt_at?: string;
  response_code?: number;
  response_body?: string;
  created_at: string;
}

// Metrics snapshot
export interface MetricsSnapshot {
  id: string;
  tenant_id: string;
  snapshot_type: 'hourly' | 'daily' | 'weekly' | 'monthly';
  period_start: string;
  period_end: string;
  metrics: {
    total_requests?: number;
    completed_requests?: number;
    failed_requests?: number;
    avg_processing_time_ms?: number;
    total_tokens_used?: number;
    provider_breakdown?: Record<string, number>;
    [key: string]: unknown;
  };
  created_at: string;
}

// Environment with D1 binding
export interface EventEnv {
  DB: D1Database;
}

// Extended environment with execution context for background tasks
export interface EventEnvWithContext extends EventEnv {
  ctx?: ExecutionContext;
}
