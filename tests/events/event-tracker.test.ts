/**
 * Tests for Event Tracker
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventTracker, createEventTracker, trackEvent } from '../../workers/shared/events/event-tracker';
import type { CreateEventInput } from '../../workers/shared/events/types';

// Mock D1 database
const createMockDB = () => ({
  prepare: vi.fn().mockReturnValue({
    bind: vi.fn().mockReturnValue({
      run: vi.fn().mockResolvedValue({ success: true }),
      all: vi.fn().mockResolvedValue({ results: [] }),
      first: vi.fn().mockResolvedValue(null),
    }),
  }),
});

describe('EventTracker', () => {
  let mockDB: ReturnType<typeof createMockDB>;
  let tracker: EventTracker;

  beforeEach(() => {
    mockDB = createMockDB();
    tracker = new EventTracker({ DB: mockDB as any });
    vi.clearAllMocks();
  });

  describe('track', () => {
    it('should create an event with all required fields', async () => {
      const input: CreateEventInput = {
        tenant_id: 'tenant-123',
        user_id: 'user-456',
        action: 'request.created',
        eventable_type: 'request',
        eventable_id: 'req-789',
        particulars: { provider: 'anthropic' },
      };

      const event = await tracker.track(input);

      expect(event.id).toBeDefined();
      expect(event.tenant_id).toBe('tenant-123');
      expect(event.user_id).toBe('user-456');
      expect(event.action).toBe('request.created');
      expect(event.eventable_type).toBe('request');
      expect(event.eventable_id).toBe('req-789');
      expect(event.particulars).toEqual({ provider: 'anthropic' });
      expect(event.created_at).toBeDefined();
    });

    it('should insert event into database', async () => {
      const input: CreateEventInput = {
        tenant_id: 'tenant-123',
        action: 'generation.started',
        eventable_type: 'request',
        eventable_id: 'req-789',
      };

      await tracker.track(input);

      expect(mockDB.prepare).toHaveBeenCalled();
      const prepareCall = mockDB.prepare.mock.calls[0][0];
      expect(prepareCall).toContain('INSERT INTO events');
    });

    it('should create activity feed entry', async () => {
      const input: CreateEventInput = {
        tenant_id: 'tenant-123',
        action: 'request.completed',
        eventable_type: 'request',
        eventable_id: 'req-789',
      };

      await tracker.track(input);

      // Should have at least 2 prepare calls - one for event, one for activity_feed
      expect(mockDB.prepare.mock.calls.length).toBeGreaterThanOrEqual(2);
      const insertCalls = mockDB.prepare.mock.calls.map(c => c[0]);
      expect(insertCalls.some((c: string) => c.includes('INSERT INTO activity_feed'))).toBe(true);
    });

    it('should include IP address and user agent when provided', async () => {
      const input: CreateEventInput = {
        tenant_id: 'tenant-123',
        action: 'user.login',
        eventable_type: 'user',
        eventable_id: 'user-456',
        ip_address: '192.168.1.1',
        user_agent: 'Mozilla/5.0',
      };

      const event = await tracker.track(input);

      expect(event.ip_address).toBe('192.168.1.1');
      expect(event.user_agent).toBe('Mozilla/5.0');
    });

    it('should handle events without user_id (system events)', async () => {
      const input: CreateEventInput = {
        tenant_id: 'tenant-123',
        action: 'system.health_check',
        eventable_type: 'system',
        eventable_id: 'health-check',
      };

      const event = await tracker.track(input);

      expect(event.user_id).toBeUndefined();
    });
  });

  describe('getFeed', () => {
    it('should return activity feed items', async () => {
      const mockFeedItems = [
        {
          id: 'feed-1',
          tenant_id: 'tenant-123',
          user_id: 'user-456',
          event_id: 'event-1',
          feed_type: 'user',
          title: 'Request completed',
          description: 'Your request was completed',
          icon: 'check-circle',
          link: '/requests/req-1',
          metadata: '{"action": "request.completed"}',
          is_read: 0,
          created_at: '2025-12-13T00:00:00Z',
        },
      ];

      mockDB.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue({ results: mockFeedItems }),
        }),
      });

      const feed = await tracker.getFeed('tenant-123');

      expect(feed).toHaveLength(1);
      expect(feed[0].title).toBe('Request completed');
      expect(feed[0].is_read).toBe(false);
      expect(feed[0].metadata).toEqual({ action: 'request.completed' });
    });

    it('should filter by feed type', async () => {
      mockDB.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue({ results: [] }),
        }),
      });

      await tracker.getFeed('tenant-123', { feedType: 'global' });

      const query = mockDB.prepare.mock.calls[0][0];
      expect(query).toContain('feed_type = ?');
    });

    it('should filter by user_id', async () => {
      mockDB.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue({ results: [] }),
        }),
      });

      await tracker.getFeed('tenant-123', { userId: 'user-456' });

      const query = mockDB.prepare.mock.calls[0][0];
      expect(query).toContain('user_id = ?');
    });

    it('should filter unread only', async () => {
      mockDB.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue({ results: [] }),
        }),
      });

      await tracker.getFeed('tenant-123', { unreadOnly: true });

      const query = mockDB.prepare.mock.calls[0][0];
      expect(query).toContain('is_read = 0');
    });

    it('should apply limit and offset', async () => {
      mockDB.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue({ results: [] }),
        }),
      });

      await tracker.getFeed('tenant-123', { limit: 10, offset: 20 });

      const query = mockDB.prepare.mock.calls[0][0];
      expect(query).toContain('LIMIT ? OFFSET ?');
    });
  });

  describe('markAsRead', () => {
    it('should mark feed items as read', async () => {
      await tracker.markAsRead('tenant-123', ['feed-1', 'feed-2']);

      expect(mockDB.prepare).toHaveBeenCalled();
      const query = mockDB.prepare.mock.calls[0][0];
      expect(query).toContain('UPDATE activity_feed SET is_read = 1');
    });

    it('should handle empty array', async () => {
      await tracker.markAsRead('tenant-123', []);

      // Should not call database for empty array
      expect(mockDB.prepare).not.toHaveBeenCalled();
    });
  });

  describe('getEventsFor', () => {
    it('should get events for a specific entity', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          tenant_id: 'tenant-123',
          action: 'request.created',
          eventable_type: 'request',
          eventable_id: 'req-789',
          particulars: '{"provider": "anthropic"}',
          created_at: '2025-12-13T00:00:00Z',
        },
      ];

      mockDB.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue({ results: mockEvents }),
        }),
      });

      const events = await tracker.getEventsFor('request', 'req-789');

      expect(events).toHaveLength(1);
      expect(events[0].action).toBe('request.created');
      expect(events[0].particulars).toEqual({ provider: 'anthropic' });
    });
  });

  describe('getEventCounts', () => {
    it('should return event counts by action', async () => {
      const mockCounts = [
        { action: 'request.created', count: 10 },
        { action: 'request.completed', count: 8 },
        { action: 'request.failed', count: 2 },
      ];

      mockDB.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue({ results: mockCounts }),
        }),
      });

      const counts = await tracker.getEventCounts('tenant-123');

      expect(counts['request.created']).toBe(10);
      expect(counts['request.completed']).toBe(8);
      expect(counts['request.failed']).toBe(2);
    });

    it('should filter by date when since is provided', async () => {
      mockDB.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue({ results: [] }),
        }),
      });

      const since = new Date('2025-01-01');
      await tracker.getEventCounts('tenant-123', since);

      const query = mockDB.prepare.mock.calls[0][0];
      expect(query).toContain('created_at >= ?');
    });
  });
});

describe('createEventTracker', () => {
  it('should create an EventTracker instance', () => {
    const mockDB = createMockDB();
    const tracker = createEventTracker({ DB: mockDB as any });
    expect(tracker).toBeInstanceOf(EventTracker);
  });
});

describe('trackEvent', () => {
  it('should be a convenience function that creates tracker and tracks event', async () => {
    const mockDB = createMockDB();
    const input: CreateEventInput = {
      tenant_id: 'tenant-123',
      action: 'request.created',
      eventable_type: 'request',
      eventable_id: 'req-789',
    };

    const event = await trackEvent({ DB: mockDB as any }, input);

    expect(event.id).toBeDefined();
    expect(event.action).toBe('request.created');
  });
});
