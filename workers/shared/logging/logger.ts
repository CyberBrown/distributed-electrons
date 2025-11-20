/**
 * Structured Logger
 * Provides logging functions with automatic context attachment
 */

import type { LogEntry, LogLevel, Logger, LogStorageOptions } from './types.js';
import { LogStorage } from './storage.js';

export interface LoggerContext {
  request_id: string;
  instance_id?: string;
  user_id?: string;
  component: string;
}

export class StructuredLogger implements Logger {
  private storage?: LogStorage;

  constructor(
    private context: LoggerContext,
    private db?: D1Database,
    storageOptions?: LogStorageOptions
  ) {
    if (db) {
      this.storage = new LogStorage(db, storageOptions);
    }
  }

  /**
   * Log debug message
   */
  debug(message: string, metadata?: Record<string, any>): void {
    this.log('DEBUG', message, metadata);
  }

  /**
   * Log info message
   */
  info(message: string, metadata?: Record<string, any>): void {
    this.log('INFO', message, metadata);
  }

  /**
   * Log warning message
   */
  warn(message: string, metadata?: Record<string, any>): void {
    this.log('WARN', message, metadata);
  }

  /**
   * Log error message
   */
  error(message: string, metadata?: Record<string, any>): void {
    this.log('ERROR', message, metadata);
  }

  /**
   * Internal log method
   */
  private log(level: LogLevel, message: string, metadata?: Record<string, any>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      request_id: this.context.request_id,
      instance_id: this.context.instance_id,
      user_id: this.context.user_id,
      component: this.context.component,
      metadata,
    };

    // Write to console for immediate visibility
    this.logToConsole(entry);

    // Add to storage buffer if available
    if (this.storage) {
      this.storage.add(entry).catch((error) => {
        console.error('Failed to add log to storage:', error);
      });
    }
  }

  /**
   * Log to console with formatting
   */
  private logToConsole(entry: LogEntry): void {
    const prefix = `[${entry.timestamp}] [${entry.level}] [${entry.component}] [${entry.request_id}]`;
    const suffix = entry.metadata ? JSON.stringify(entry.metadata) : '';

    const logLine = suffix ? `${prefix} ${entry.message} ${suffix}` : `${prefix} ${entry.message}`;

    switch (entry.level) {
      case 'DEBUG':
        console.debug(logLine);
        break;
      case 'INFO':
        console.info(logLine);
        break;
      case 'WARN':
        console.warn(logLine);
        break;
      case 'ERROR':
        console.error(logLine);
        break;
    }
  }

  /**
   * Flush buffered logs to storage
   */
  async flush(): Promise<void> {
    if (this.storage) {
      await this.storage.flush();
    }
  }

  /**
   * Query logs from storage
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
    if (!this.storage) {
      throw new Error('Logger not configured with database storage');
    }
    return this.storage.query(options);
  }

  /**
   * Create a child logger with additional context
   */
  child(additionalContext: Partial<LoggerContext>): StructuredLogger {
    return new StructuredLogger(
      {
        ...this.context,
        ...additionalContext,
      },
      this.db,
    );
  }
}

/**
 * Create a logger instance
 */
export function createLogger(
  context: LoggerContext,
  db?: D1Database,
  storageOptions?: LogStorageOptions
): StructuredLogger {
  return new StructuredLogger(context, db, storageOptions);
}

/**
 * Minimal logger for environments without database
 */
export class ConsoleLogger implements Logger {
  constructor(private component: string) {}

  debug(message: string, metadata?: Record<string, any>): void {
    console.debug(`[DEBUG] [${this.component}]`, message, metadata || '');
  }

  info(message: string, metadata?: Record<string, any>): void {
    console.info(`[INFO] [${this.component}]`, message, metadata || '');
  }

  warn(message: string, metadata?: Record<string, any>): void {
    console.warn(`[WARN] [${this.component}]`, message, metadata || '');
  }

  error(message: string, metadata?: Record<string, any>): void {
    console.error(`[ERROR] [${this.component}]`, message, metadata || '');
  }

  async flush(): Promise<void> {
    // No-op for console logger
  }
}
