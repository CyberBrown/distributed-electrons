/**
 * Log Storage Manager
 * Handles batch writing of logs to D1 database
 */

import type { LogEntry, LogStorageOptions } from './types.js';

export class LogStorage {
  private buffer: LogEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly batchSize: number;
  private readonly flushInterval: number;

  constructor(
    private db: D1Database,
    options: LogStorageOptions = {}
  ) {
    this.batchSize = options.batchSize || 100;
    this.flushInterval = options.flushInterval || 10000; // 10 seconds
  }

  /**
   * Add log entry to buffer
   */
  async add(entry: LogEntry): Promise<void> {
    this.buffer.push(entry);

    // Flush if buffer is full
    if (this.buffer.length >= this.batchSize) {
      await this.flush();
    } else {
      // Schedule flush if not already scheduled
      this.scheduleFlush();
    }
  }

  /**
   * Flush all buffered logs to database
   */
  async flush(): Promise<void> {
    // Clear timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Nothing to flush
    if (this.buffer.length === 0) {
      return;
    }

    // Get logs to flush and clear buffer
    const logsToFlush = [...this.buffer];
    this.buffer = [];

    try {
      // Build batch insert statement
      const placeholders = logsToFlush
        .map(() => '(?, ?, ?, ?, ?, ?, ?, ?)')
        .join(', ');

      const sql = `
        INSERT INTO logs (
          log_id,
          timestamp,
          level,
          message,
          request_id,
          instance_id,
          user_id,
          component,
          metadata
        ) VALUES ${placeholders}
      `;

      // Flatten values for batch insert
      const values: any[] = [];
      for (const log of logsToFlush) {
        values.push(
          crypto.randomUUID(), // log_id
          log.timestamp,
          log.level,
          log.message,
          log.request_id,
          log.instance_id || null,
          log.user_id || null,
          log.component,
          log.metadata ? JSON.stringify(log.metadata) : null
        );
      }

      await this.db.prepare(sql).bind(...values).run();
    } catch (error) {
      // Log to console if database write fails
      console.error('Failed to write logs to database:', error);
      // Re-add logs to buffer for retry
      this.buffer.unshift(...logsToFlush);
    }
  }

  /**
   * Schedule automatic flush
   */
  private scheduleFlush(): void {
    if (this.flushTimer) {
      return; // Already scheduled
    }

    this.flushTimer = setTimeout(() => {
      this.flush().catch((error) => {
        console.error('Scheduled flush failed:', error);
      });
    }, this.flushInterval);
  }

  /**
   * Query logs from database
   */
  async query(options: {
    level?: string;
    component?: string;
    instance_id?: string;
    request_id?: string;
    startTime?: string;
    endTime?: string;
    limit?: number;
  }): Promise<LogEntry[]> {
    let sql = 'SELECT * FROM logs WHERE 1=1';
    const bindings: any[] = [];

    if (options.level) {
      sql += ' AND level = ?';
      bindings.push(options.level);
    }

    if (options.component) {
      sql += ' AND component = ?';
      bindings.push(options.component);
    }

    if (options.instance_id) {
      sql += ' AND instance_id = ?';
      bindings.push(options.instance_id);
    }

    if (options.request_id) {
      sql += ' AND request_id = ?';
      bindings.push(options.request_id);
    }

    if (options.startTime) {
      sql += ' AND timestamp >= ?';
      bindings.push(options.startTime);
    }

    if (options.endTime) {
      sql += ' AND timestamp <= ?';
      bindings.push(options.endTime);
    }

    sql += ' ORDER BY timestamp DESC';

    if (options.limit) {
      sql += ' LIMIT ?';
      bindings.push(options.limit);
    }

    const result = await this.db.prepare(sql).bind(...bindings).all();

    return result.results.map((row: any) => ({
      timestamp: row.timestamp,
      level: row.level,
      message: row.message,
      request_id: row.request_id,
      instance_id: row.instance_id,
      user_id: row.user_id,
      component: row.component,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }

  /**
   * Delete old logs (for cleanup cron job)
   */
  async deleteOlderThan(days: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setUTCDate(cutoffDate.getUTCDate() - days);
    const cutoffISO = cutoffDate.toISOString();

    const result = await this.db
      .prepare('DELETE FROM logs WHERE timestamp < ?')
      .bind(cutoffISO)
      .run();

    return result.meta?.changes || 0;
  }
}
