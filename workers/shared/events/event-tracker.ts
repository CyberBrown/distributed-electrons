/**
 * Event Tracker
 * Core module for recording events and managing activity feeds
 */

import type {
  Event,
  CreateEventInput,
  ActivityFeedItem,
  EventAction,
  EventableType,
  EventEnv,
  EventEnvWithContext,
} from './types';

// Activity feed templates for generating human-readable entries
const FEED_TEMPLATES: Record<string, { title: string; description: string; icon: string }> = {
  // Request events
  'request.created': {
    title: 'New request submitted',
    description: 'A new {eventable_type} request was created',
    icon: 'plus-circle',
  },
  'request.queued': {
    title: 'Request queued',
    description: 'Request is waiting in the processing queue',
    icon: 'clock',
  },
  'request.processing': {
    title: 'Processing started',
    description: 'Request is now being processed',
    icon: 'loader',
  },
  'request.completed': {
    title: 'Request completed',
    description: 'Request was successfully completed',
    icon: 'check-circle',
  },
  'request.failed': {
    title: 'Request failed',
    description: 'Request failed: {error}',
    icon: 'x-circle',
  },
  'request.cancelled': {
    title: 'Request cancelled',
    description: 'Request was cancelled',
    icon: 'slash',
  },

  // Deliverable events
  'deliverable.created': {
    title: 'Deliverable created',
    description: 'A new deliverable is ready for review',
    icon: 'package',
  },
  'deliverable.approved': {
    title: 'Deliverable approved',
    description: 'Deliverable passed quality review',
    icon: 'check',
  },
  'deliverable.rejected': {
    title: 'Deliverable rejected',
    description: 'Deliverable did not pass quality review',
    icon: 'x',
  },
  'deliverable.delivered': {
    title: 'Deliverable delivered',
    description: 'Deliverable was successfully delivered',
    icon: 'send',
  },

  // Generation events
  'generation.started': {
    title: 'Generation started',
    description: '{provider} {task_type} generation started',
    icon: 'play',
  },
  'generation.completed': {
    title: 'Generation completed',
    description: '{provider} generation completed in {duration}ms',
    icon: 'check-circle',
  },
  'generation.failed': {
    title: 'Generation failed',
    description: '{provider} generation failed: {error}',
    icon: 'alert-circle',
  },

  // Model config events
  'model_config.created': {
    title: 'Model added',
    description: 'New model configuration created: {model_name}',
    icon: 'plus',
  },
  'model_config.updated': {
    title: 'Model updated',
    description: 'Model configuration updated: {model_name}',
    icon: 'edit',
  },
  'model_config.deleted': {
    title: 'Model removed',
    description: 'Model configuration deleted: {model_name}',
    icon: 'trash',
  },
  'model_config.activated': {
    title: 'Model activated',
    description: 'Model is now active: {model_name}',
    icon: 'toggle-right',
  },
  'model_config.deprecated': {
    title: 'Model deprecated',
    description: 'Model has been deprecated: {model_name}',
    icon: 'alert-triangle',
  },

  // User events
  'user.login': {
    title: 'User logged in',
    description: 'User signed in from {ip_address}',
    icon: 'log-in',
  },
  'user.logout': {
    title: 'User logged out',
    description: 'User signed out',
    icon: 'log-out',
  },
  'api_key.created': {
    title: 'API key created',
    description: 'New API key was generated',
    icon: 'key',
  },
  'api_key.revoked': {
    title: 'API key revoked',
    description: 'API key was revoked',
    icon: 'key',
  },

  // System events
  'system.rate_limit_hit': {
    title: 'Rate limit reached',
    description: 'Rate limit hit for {provider}',
    icon: 'alert-octagon',
  },
  'system.error': {
    title: 'System error',
    description: 'An error occurred: {error}',
    icon: 'alert-triangle',
  },

  // OAuth events
  'oauth.expired': {
    title: '🔐 OAuth credentials expired',
    description: 'Claude OAuth credentials have expired. Run: npm run de-auth:refresh',
    icon: 'alert-circle',
  },
  'oauth.refresh_needed': {
    title: 'OAuth credentials expiring soon',
    description: 'Claude OAuth credentials will expire in {hours_remaining} hours',
    icon: 'clock',
  },
  'oauth.refreshed': {
    title: 'OAuth credentials updated',
    description: 'Claude OAuth credentials were successfully refreshed',
    icon: 'check-circle',
  },
  'oauth.validation_failed': {
    title: 'OAuth validation failed',
    description: 'Claude OAuth credentials are invalid: {error}',
    icon: 'x-circle',
  },
};

/**
 * EventTracker class for managing events and activity feeds
 */
export class EventTracker {
  private db: D1Database;
  private ctx?: ExecutionContext;

  constructor(env: EventEnvWithContext) {
    this.db = env.DB;
    this.ctx = env.ctx;
  }

  /**
   * Record a new event
   */
  async track(input: CreateEventInput): Promise<Event> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const event: Event = {
      id,
      tenant_id: input.tenant_id,
      user_id: input.user_id,
      action: input.action,
      eventable_type: input.eventable_type,
      eventable_id: input.eventable_id,
      particulars: input.particulars,
      ip_address: input.ip_address,
      user_agent: input.user_agent,
      created_at: now,
    };

    // Insert event into database
    await this.db.prepare(`
      INSERT INTO events (
        id, tenant_id, user_id, action, eventable_type, eventable_id,
        particulars, ip_address, user_agent, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      event.id,
      event.tenant_id,
      event.user_id || null,
      event.action,
      event.eventable_type,
      event.eventable_id,
      event.particulars ? JSON.stringify(event.particulars) : null,
      event.ip_address || null,
      event.user_agent || null,
      event.created_at
    ).run();

    // Create activity feed entry
    await this.createFeedEntry(event);

    // Trigger webhook deliveries in the background
    // Use waitUntil if available to keep the worker alive during delivery
    const webhookPromise = this.triggerWebhooks(event).catch(err => {
      console.error('Webhook delivery error:', err);
    });

    if (this.ctx) {
      this.ctx.waitUntil(webhookPromise);
    } else {
      // Fallback: await webhook delivery if no context available
      await webhookPromise;
    }

    return event;
  }

  /**
   * Create activity feed entry from event
   */
  private async createFeedEntry(event: Event): Promise<void> {
    const template = FEED_TEMPLATES[event.action];
    if (!template) return;

    const feedId = crypto.randomUUID();
    const particulars = event.particulars || {};

    // Interpolate template with particulars
    const title = this.interpolate(template.title, particulars);
    const description = this.interpolate(template.description, {
      ...particulars,
      eventable_type: event.eventable_type,
      ip_address: event.ip_address,
    });

    // Determine feed type
    const feedType = event.user_id ? 'user' : 'global';

    // Generate link to related resource
    const link = this.generateLink(event.eventable_type, event.eventable_id);

    await this.db.prepare(`
      INSERT INTO activity_feed (
        id, tenant_id, user_id, event_id, feed_type,
        title, description, icon, link, metadata, is_read, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      feedId,
      event.tenant_id,
      event.user_id || null,
      event.id,
      feedType,
      title,
      description,
      template.icon,
      link,
      JSON.stringify({ action: event.action, eventable_type: event.eventable_type }),
      0,
      event.created_at
    ).run();
  }

  /**
   * Interpolate template string with values
   */
  private interpolate(template: string, values: Record<string, unknown>): string {
    return template.replace(/\{(\w+)\}/g, (_, key) => {
      const value = values[key];
      return value !== undefined ? String(value) : `{${key}}`;
    });
  }

  /**
   * Generate deep link for eventable
   */
  private generateLink(type: EventableType, id: string): string {
    const baseUrl = 'https://admin.distributedelectrons.com';
    switch (type) {
      case 'request':
        return `${baseUrl}/requests/${id}`;
      case 'deliverable':
        return `${baseUrl}/deliverables/${id}`;
      case 'model_config':
        return `${baseUrl}/models/${id}`;
      case 'user':
        return `${baseUrl}/users/${id}`;
      case 'instance':
        return `${baseUrl}/instances/${id}`;
      case 'oauth_credentials':
        return `${baseUrl}/settings/oauth`;
      default:
        return baseUrl;
    }
  }

  /**
   * Trigger webhook deliveries for event
   */
  private async triggerWebhooks(event: Event): Promise<void> {
    // Find matching subscriptions
    const subscriptions = await this.db.prepare(`
      SELECT * FROM event_subscriptions
      WHERE tenant_id = ? AND is_active = 1
    `).bind(event.tenant_id).all();

    if (!subscriptions.results || subscriptions.results.length === 0) return;

    const deliveryPromises: Promise<void>[] = [];

    for (const sub of subscriptions.results) {
      const subscription = sub as any;
      const eventTypes: string[] = JSON.parse(subscription.event_types || '[]');

      // Check if subscription matches this event
      if (!eventTypes.includes(event.action) && !eventTypes.includes('*')) {
        continue;
      }

      // Check filters
      const filters = subscription.filters ? JSON.parse(subscription.filters) : null;
      if (filters) {
        if (filters.user_id && filters.user_id !== event.user_id) continue;
        if (filters.eventable_type && filters.eventable_type !== event.eventable_type) continue;
        if (filters.eventable_id && filters.eventable_id !== event.eventable_id) continue;
      }

      // Create delivery record
      const deliveryId = crypto.randomUUID();
      await this.db.prepare(`
        INSERT INTO event_deliveries (id, subscription_id, event_id, status, attempts, created_at)
        VALUES (?, ?, ?, 'pending', 0, ?)
      `).bind(deliveryId, subscription.id, event.id, new Date().toISOString()).run();

      // Queue delivery (await all at the end)
      deliveryPromises.push(
        this.deliverWebhook(deliveryId, subscription, event).catch(err => {
          console.error(`Webhook delivery failed for ${deliveryId}:`, err);
        })
      );
    }

    // Wait for all deliveries to complete (or fail)
    await Promise.all(deliveryPromises);
  }

  /**
   * Deliver webhook to subscription endpoint
   */
  private async deliverWebhook(
    deliveryId: string,
    subscription: any,
    event: Event
  ): Promise<void> {
    const maxAttempts = 3;
    let attempts = 0;
    let lastError: string | undefined;

    while (attempts < maxAttempts) {
      attempts++;

      try {
        // Check if this is an ntfy.sh webhook - needs special formatting
        const isNtfy = subscription.webhook_url.includes('ntfy.sh');

        let payload: Record<string, unknown>;
        let webhookUrl = subscription.webhook_url;

        if (isNtfy) {
          // Extract topic from URL if present (e.g., https://ntfy.sh/my-topic)
          const urlParts = subscription.webhook_url.split('/');
          const topic = urlParts.length > 3 ? urlParts[urlParts.length - 1] : 'alerts';

          // Use root ntfy.sh URL for JSON posts
          webhookUrl = 'https://ntfy.sh';

          // Get template for human-readable message
          const template = FEED_TEMPLATES[event.action];
          const title = template?.title || event.action;
          const description = template?.description || `Event: ${event.action}`;

          // Interpolate template with event data
          const message = this.interpolate(description, {
            ...event.particulars as Record<string, unknown>,
            eventable_type: event.eventable_type,
          });

          payload = {
            topic,
            title,
            message,
            priority: event.action.includes('expired') || event.action.includes('failed') ? 5 : 3,
            tags: event.action.includes('expired') ? ['warning', 'key'] : ['information'],
            // Add action button for OAuth events
            actions: event.action.startsWith('oauth.') ? [
              {
                action: 'view',
                label: '🔄 Refresh Now',
                url: 'https://api.distributedelectrons.com/oauth/refresh',
                clear: true,
              }
            ] : undefined,
          };
        } else {
          // Standard webhook payload
          payload = {
            event_id: event.id,
            action: event.action,
            eventable_type: event.eventable_type,
            eventable_id: event.eventable_id,
            particulars: event.particulars,
            timestamp: event.created_at,
          };
        }

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-DE-Event': event.action,
          'X-DE-Delivery': deliveryId,
        };

        // Add signature if secret is configured (skip for ntfy)
        if (subscription.secret && !isNtfy) {
          const signature = await this.signPayload(JSON.stringify(payload), subscription.secret);
          headers['X-DE-Signature'] = signature;
        }

        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        // Update delivery record
        await this.db.prepare(`
          UPDATE event_deliveries
          SET status = ?, attempts = ?, last_attempt_at = ?, response_code = ?
          WHERE id = ?
        `).bind(
          response.ok ? 'delivered' : 'failed',
          attempts,
          new Date().toISOString(),
          response.status,
          deliveryId
        ).run();

        if (response.ok) return;

        lastError = `HTTP ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';

        await this.db.prepare(`
          UPDATE event_deliveries
          SET status = 'retrying', attempts = ?, last_attempt_at = ?, response_body = ?
          WHERE id = ?
        `).bind(attempts, new Date().toISOString(), lastError, deliveryId).run();
      }

      // Wait before retry (exponential backoff)
      if (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempts) * 1000));
      }
    }

    // Mark as failed after all attempts
    await this.db.prepare(`
      UPDATE event_deliveries SET status = 'failed', response_body = ? WHERE id = ?
    `).bind(lastError, deliveryId).run();

    // Update subscription retry count
    await this.db.prepare(`
      UPDATE event_subscriptions SET retry_count = retry_count + 1, last_failure = ? WHERE id = ?
    `).bind(lastError, subscription.id).run();
  }

  /**
   * Sign webhook payload with HMAC-SHA256
   */
  private async signPayload(payload: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    return Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Get activity feed for a tenant
   */
  async getFeed(
    tenantId: string,
    options: {
      feedType?: 'global' | 'user' | 'project';
      userId?: string;
      limit?: number;
      offset?: number;
      unreadOnly?: boolean;
    } = {}
  ): Promise<ActivityFeedItem[]> {
    const { feedType, userId, limit = 50, offset = 0, unreadOnly = false } = options;

    let query = `
      SELECT * FROM activity_feed
      WHERE tenant_id = ?
    `;
    const params: (string | number)[] = [tenantId];

    if (feedType) {
      query += ` AND feed_type = ?`;
      params.push(feedType);
    }

    if (userId) {
      query += ` AND (user_id = ? OR user_id IS NULL)`;
      params.push(userId);
    }

    if (unreadOnly) {
      query += ` AND is_read = 0`;
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const results = await this.db.prepare(query).bind(...params).all();

    return (results.results || []).map((row: any) => ({
      id: row.id,
      tenant_id: row.tenant_id,
      user_id: row.user_id,
      event_id: row.event_id,
      feed_type: row.feed_type,
      title: row.title,
      description: row.description,
      icon: row.icon,
      link: row.link,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      is_read: !!row.is_read,
      created_at: row.created_at,
    }));
  }

  /**
   * Mark feed items as read
   */
  async markAsRead(tenantId: string, feedItemIds: string[]): Promise<void> {
    if (feedItemIds.length === 0) return;

    const placeholders = feedItemIds.map(() => '?').join(',');
    await this.db.prepare(`
      UPDATE activity_feed SET is_read = 1
      WHERE tenant_id = ? AND id IN (${placeholders})
    `).bind(tenantId, ...feedItemIds).run();
  }

  /**
   * Get events for a specific entity
   */
  async getEventsFor(
    eventableType: EventableType,
    eventableId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<Event[]> {
    const { limit = 50, offset = 0 } = options;

    const results = await this.db.prepare(`
      SELECT * FROM events
      WHERE eventable_type = ? AND eventable_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(eventableType, eventableId, limit, offset).all();

    return (results.results || []).map((row: any) => ({
      id: row.id,
      tenant_id: row.tenant_id,
      user_id: row.user_id,
      action: row.action,
      eventable_type: row.eventable_type,
      eventable_id: row.eventable_id,
      particulars: row.particulars ? JSON.parse(row.particulars) : undefined,
      ip_address: row.ip_address,
      user_agent: row.user_agent,
      created_at: row.created_at,
    }));
  }

  /**
   * Get event counts by action for a tenant
   */
  async getEventCounts(
    tenantId: string,
    since?: Date
  ): Promise<Record<EventAction, number>> {
    let query = `
      SELECT action, COUNT(*) as count FROM events
      WHERE tenant_id = ?
    `;
    const params: (string | number)[] = [tenantId];

    if (since) {
      query += ` AND created_at >= ?`;
      params.push(since.toISOString());
    }

    query += ` GROUP BY action`;

    const results = await this.db.prepare(query).bind(...params).all();

    const counts: Record<string, number> = {};
    for (const row of results.results || []) {
      counts[(row as any).action] = (row as any).count;
    }

    return counts as Record<EventAction, number>;
  }
}

/**
 * Create event tracker instance
 */
export function createEventTracker(env: EventEnvWithContext): EventTracker {
  return new EventTracker(env);
}

/**
 * Convenience function for tracking events
 */
export async function trackEvent(env: EventEnvWithContext, input: CreateEventInput): Promise<Event> {
  const tracker = createEventTracker(env);
  return tracker.track(input);
}
