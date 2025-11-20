import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LogStorage } from '../../workers/shared/logging/storage.js';
import type { LogEntry } from '../../workers/shared/logging/types.js';

// Mock D1Database
class MockD1Database {
  private queries: any[] = [];

  prepare(sql: string) {
    const self = this;
    return {
      bind: (...values: any[]) => ({
        run: async () => {
          self.queries.push({ sql, values, type: 'run' });
          return { meta: { changes: values.length / 9 } }; // Simulate affected rows
        },
        all: async () => {
          self.queries.push({ sql, values, type: 'all' });
          // Mock query results
          return { results: [] };
        },
      }),
    };
  }

  getQueries() {
    return this.queries;
  }

  clearQueries() {
    this.queries = [];
  }
}

describe('LogStorage', () => {
  let mockDb: MockD1Database;
  let storage: LogStorage;

  beforeEach(() => {
    mockDb = new MockD1Database();
    storage = new LogStorage(mockDb as any, {
      batchSize: 3,
      flushInterval: 1000,
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('add', () => {
    it('should add log entry to buffer', async () => {
      const entry: LogEntry = {
        timestamp: '2025-11-20T00:00:00Z',
        level: 'INFO',
        message: 'Test message',
        request_id: 'req-123',
        component: 'test',
      };

      await storage.add(entry);

      // Should not flush yet (batch size is 3)
      expect(mockDb.getQueries()).toHaveLength(0);
    });

    it('should flush when batch size is reached', async () => {
      const entry: LogEntry = {
        timestamp: '2025-11-20T00:00:00Z',
        level: 'INFO',
        message: 'Test message',
        request_id: 'req-123',
        component: 'test',
      };

      await storage.add(entry);
      await storage.add(entry);
      await storage.add(entry);

      // Should have flushed
      expect(mockDb.getQueries()).toHaveLength(1);
      expect(mockDb.getQueries()[0].sql).toContain('INSERT INTO logs');
    });
  });

  describe('flush', () => {
    it('should flush buffered logs to database', async () => {
      const entry: LogEntry = {
        timestamp: '2025-11-20T00:00:00Z',
        level: 'INFO',
        message: 'Test message',
        request_id: 'req-123',
        component: 'test',
        instance_id: 'production',
        user_id: 'user-456',
        metadata: { foo: 'bar' },
      };

      await storage.add(entry);
      await storage.flush();

      const queries = mockDb.getQueries();
      expect(queries).toHaveLength(1);
      expect(queries[0].sql).toContain('INSERT INTO logs');
      expect(queries[0].values).toContain('INFO');
      expect(queries[0].values).toContain('Test message');
      expect(queries[0].values).toContain('req-123');
    });

    it('should handle empty buffer', async () => {
      await storage.flush();

      expect(mockDb.getQueries()).toHaveLength(0);
    });

    it('should clear buffer after flushing', async () => {
      const entry: LogEntry = {
        timestamp: '2025-11-20T00:00:00Z',
        level: 'INFO',
        message: 'Test message',
        request_id: 'req-123',
        component: 'test',
      };

      await storage.add(entry);
      await storage.flush();

      mockDb.clearQueries();

      await storage.flush();
      expect(mockDb.getQueries()).toHaveLength(0);
    });

    it('should serialize metadata as JSON', async () => {
      const entry: LogEntry = {
        timestamp: '2025-11-20T00:00:00Z',
        level: 'INFO',
        message: 'Test message',
        request_id: 'req-123',
        component: 'test',
        metadata: { userId: 'user-123', action: 'login' },
      };

      await storage.add(entry);
      await storage.flush();

      const queries = mockDb.getQueries();
      const metadataValue = queries[0].values.find((v: any) =>
        typeof v === 'string' && v.includes('userId')
      );
      expect(metadataValue).toBeDefined();
      expect(JSON.parse(metadataValue)).toEqual({ userId: 'user-123', action: 'login' });
    });
  });

  describe('scheduled flush', () => {
    it('should flush automatically after interval', async () => {
      const entry: LogEntry = {
        timestamp: '2025-11-20T00:00:00Z',
        level: 'INFO',
        message: 'Test message',
        request_id: 'req-123',
        component: 'test',
      };

      await storage.add(entry);

      // Should not flush yet
      expect(mockDb.getQueries()).toHaveLength(0);

      // Advance timer past flush interval
      await vi.advanceTimersByTimeAsync(1000);

      // Should have flushed
      expect(mockDb.getQueries()).toHaveLength(1);
    });

    it('should not schedule multiple flushes', async () => {
      const entry: LogEntry = {
        timestamp: '2025-11-20T00:00:00Z',
        level: 'INFO',
        message: 'Test message',
        request_id: 'req-123',
        component: 'test',
      };

      await storage.add(entry);
      await storage.add(entry);

      await vi.advanceTimersByTimeAsync(1000);

      // Should only flush once
      expect(mockDb.getQueries()).toHaveLength(1);
    });
  });

  describe('query', () => {
    it('should query logs with filters', async () => {
      const results = await storage.query({
        level: 'ERROR',
        component: 'test-component',
        limit: 10,
      });

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it('should query logs by request_id', async () => {
      await storage.query({
        request_id: 'req-123',
      });

      const queries = mockDb.getQueries();
      expect(queries[0].sql).toContain('request_id = ?');
      expect(queries[0].values).toContain('req-123');
    });

    it('should query logs by time range', async () => {
      await storage.query({
        startTime: '2025-11-20T00:00:00Z',
        endTime: '2025-11-20T23:59:59Z',
      });

      const queries = mockDb.getQueries();
      expect(queries[0].sql).toContain('timestamp >=');
      expect(queries[0].sql).toContain('timestamp <=');
    });

    it('should apply limit', async () => {
      await storage.query({
        limit: 50,
      });

      const queries = mockDb.getQueries();
      expect(queries[0].sql).toContain('LIMIT ?');
      expect(queries[0].values).toContain(50);
    });
  });

  describe('deleteOlderThan', () => {
    it('should delete logs older than specified days', async () => {
      const deletedCount = await storage.deleteOlderThan(30);

      const queries = mockDb.getQueries();
      expect(queries).toHaveLength(1);
      expect(queries[0].sql).toContain('DELETE FROM logs');
      expect(queries[0].sql).toContain('WHERE timestamp < ?');
      expect(deletedCount).toBeGreaterThanOrEqual(0);
    });

    it('should calculate correct cutoff date', async () => {
      const now = new Date('2025-11-20T00:00:00Z');
      vi.setSystemTime(now);

      await storage.deleteOlderThan(30);

      const queries = mockDb.getQueries();
      const cutoffDate = new Date(queries[0].values[0]);
      const expectedCutoff = new Date('2025-10-21T00:00:00Z');

      expect(cutoffDate.getTime()).toBe(expectedCutoff.getTime());
    });
  });
});
