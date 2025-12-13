/**
 * Activity Feed Handlers
 * Endpoints for activity feed and event management
 */

import { Env } from '../types';
import { successResponse, errorResponse } from '../utils';
import { EventTracker } from '../../../workers/shared/events/event-tracker';
import type { CreateEventInput } from '../../../workers/shared/events/types';

/**
 * Get activity feed for a tenant
 * GET /activity?tenant_id=xxx&feed_type=global&limit=50&offset=0&unread_only=false
 */
export async function getActivityFeed(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const tenantId = url.searchParams.get('tenant_id');

    if (!tenantId) {
      return errorResponse('tenant_id is required', 400);
    }

    const feedType = url.searchParams.get('feed_type') as 'global' | 'user' | 'project' | undefined;
    const userId = url.searchParams.get('user_id') || undefined;
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const unreadOnly = url.searchParams.get('unread_only') === 'true';

    const tracker = new EventTracker(env);
    const feed = await tracker.getFeed(tenantId, {
      feedType,
      userId,
      limit,
      offset,
      unreadOnly,
    });

    return successResponse(feed);
  } catch (error) {
    console.error('Get activity feed error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to get activity feed',
      500
    );
  }
}

/**
 * Mark activity feed items as read
 * POST /activity/read
 * Body: { tenant_id: string, feed_item_ids: string[] }
 */
export async function markActivityRead(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = await request.json() as {
      tenant_id: string;
      feed_item_ids: string[];
    };

    if (!body.tenant_id) {
      return errorResponse('tenant_id is required', 400);
    }

    if (!body.feed_item_ids || !Array.isArray(body.feed_item_ids)) {
      return errorResponse('feed_item_ids array is required', 400);
    }

    const tracker = new EventTracker(env);
    await tracker.markAsRead(body.tenant_id, body.feed_item_ids);

    return successResponse({ marked_count: body.feed_item_ids.length });
  } catch (error) {
    console.error('Mark activity read error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to mark as read',
      500
    );
  }
}

/**
 * Get events for a specific entity
 * GET /events/:eventable_type/:eventable_id?limit=50&offset=0
 */
export async function getEventsForEntity(
  eventableType: string,
  eventableId: string,
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    const tracker = new EventTracker(env);
    const events = await tracker.getEventsFor(
      eventableType as any,
      eventableId,
      { limit, offset }
    );

    return successResponse(events);
  } catch (error) {
    console.error('Get events error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to get events',
      500
    );
  }
}

/**
 * Get event counts/statistics for a tenant
 * GET /events/stats?tenant_id=xxx&since=2024-01-01
 */
export async function getEventStats(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const tenantId = url.searchParams.get('tenant_id');

    if (!tenantId) {
      return errorResponse('tenant_id is required', 400);
    }

    const sinceParam = url.searchParams.get('since');
    const since = sinceParam ? new Date(sinceParam) : undefined;

    const tracker = new EventTracker(env);
    const counts = await tracker.getEventCounts(tenantId, since);

    // Calculate totals
    const totals = {
      total_events: Object.values(counts).reduce((a, b) => a + b, 0),
      by_action: counts,
    };

    return successResponse(totals);
  } catch (error) {
    console.error('Get event stats error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to get event stats',
      500
    );
  }
}

/**
 * Track a new event (internal API)
 * POST /events
 * Body: CreateEventInput
 */
export async function trackEvent(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = await request.json() as CreateEventInput;

    // Validate required fields
    if (!body.tenant_id) {
      return errorResponse('tenant_id is required', 400);
    }
    if (!body.action) {
      return errorResponse('action is required', 400);
    }
    if (!body.eventable_type) {
      return errorResponse('eventable_type is required', 400);
    }
    if (!body.eventable_id) {
      return errorResponse('eventable_id is required', 400);
    }

    // Extract client info from request
    const ip_address = request.headers.get('CF-Connecting-IP') ||
                       request.headers.get('X-Forwarded-For') ||
                       undefined;
    const user_agent = request.headers.get('User-Agent') || undefined;

    const tracker = new EventTracker(env);
    const event = await tracker.track({
      ...body,
      ip_address: body.ip_address || ip_address,
      user_agent: body.user_agent || user_agent,
    });

    return successResponse(event, 201);
  } catch (error) {
    console.error('Track event error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to track event',
      500
    );
  }
}

/**
 * List event subscriptions for a tenant
 * GET /events/subscriptions?tenant_id=xxx
 */
export async function listEventSubscriptions(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const tenantId = url.searchParams.get('tenant_id');

    if (!tenantId) {
      return errorResponse('tenant_id is required', 400);
    }

    const results = await env.DB.prepare(`
      SELECT * FROM event_subscriptions
      WHERE tenant_id = ?
      ORDER BY created_at DESC
    `).bind(tenantId).all();

    const subscriptions = (results.results || []).map((row: any) => ({
      ...row,
      event_types: JSON.parse(row.event_types || '[]'),
      filters: row.filters ? JSON.parse(row.filters) : null,
      is_active: !!row.is_active,
    }));

    return successResponse(subscriptions);
  } catch (error) {
    console.error('List subscriptions error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to list subscriptions',
      500
    );
  }
}

/**
 * Create event subscription
 * POST /events/subscriptions
 */
export async function createEventSubscription(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = await request.json() as {
      tenant_id: string;
      name: string;
      webhook_url: string;
      secret?: string;
      event_types: string[];
      filters?: Record<string, string>;
    };

    if (!body.tenant_id || !body.name || !body.webhook_url || !body.event_types) {
      return errorResponse('tenant_id, name, webhook_url, and event_types are required', 400);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await env.DB.prepare(`
      INSERT INTO event_subscriptions (
        id, tenant_id, name, webhook_url, secret, event_types, filters,
        is_active, retry_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
    `).bind(
      id,
      body.tenant_id,
      body.name,
      body.webhook_url,
      body.secret || null,
      JSON.stringify(body.event_types),
      body.filters ? JSON.stringify(body.filters) : null,
      now,
      now
    ).run();

    return successResponse({
      id,
      tenant_id: body.tenant_id,
      name: body.name,
      webhook_url: body.webhook_url,
      event_types: body.event_types,
      is_active: true,
      created_at: now,
    }, 201);
  } catch (error) {
    console.error('Create subscription error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to create subscription',
      500
    );
  }
}

/**
 * Update event subscription
 * PUT /events/subscriptions/:id
 */
export async function updateEventSubscription(
  subscriptionId: string,
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = await request.json() as {
      name?: string;
      webhook_url?: string;
      secret?: string;
      event_types?: string[];
      filters?: Record<string, string>;
      is_active?: boolean;
    };

    // Build update query dynamically
    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (body.name !== undefined) {
      updates.push('name = ?');
      values.push(body.name);
    }
    if (body.webhook_url !== undefined) {
      updates.push('webhook_url = ?');
      values.push(body.webhook_url);
    }
    if (body.secret !== undefined) {
      updates.push('secret = ?');
      values.push(body.secret);
    }
    if (body.event_types !== undefined) {
      updates.push('event_types = ?');
      values.push(JSON.stringify(body.event_types));
    }
    if (body.filters !== undefined) {
      updates.push('filters = ?');
      values.push(JSON.stringify(body.filters));
    }
    if (body.is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(body.is_active ? 1 : 0);
    }

    if (updates.length === 0) {
      return errorResponse('No fields to update', 400);
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(subscriptionId);

    await env.DB.prepare(`
      UPDATE event_subscriptions
      SET ${updates.join(', ')}
      WHERE id = ?
    `).bind(...values).run();

    return successResponse({ id: subscriptionId, updated: true });
  } catch (error) {
    console.error('Update subscription error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to update subscription',
      500
    );
  }
}

/**
 * Delete event subscription
 * DELETE /events/subscriptions/:id
 */
export async function deleteEventSubscription(
  subscriptionId: string,
  env: Env
): Promise<Response> {
  try {
    await env.DB.prepare(`
      DELETE FROM event_subscriptions WHERE id = ?
    `).bind(subscriptionId).run();

    return successResponse({ id: subscriptionId, deleted: true });
  } catch (error) {
    console.error('Delete subscription error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to delete subscription',
      500
    );
  }
}
