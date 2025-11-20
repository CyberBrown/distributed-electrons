/**
 * Logging Types and Interfaces
 * Defines structured log entry format
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  timestamp: string; // ISO 8601 format
  level: LogLevel;
  message: string;
  request_id: string;
  instance_id?: string;
  user_id?: string;
  component: string; // e.g., 'image-gen-worker', 'config-service'
  metadata?: Record<string, any>;
}

export interface LogStorageOptions {
  batchSize?: number; // Default: 100
  flushInterval?: number; // Default: 10000ms (10 seconds)
}

export interface Logger {
  debug(message: string, metadata?: Record<string, any>): void;
  info(message: string, metadata?: Record<string, any>): void;
  warn(message: string, metadata?: Record<string, any>): void;
  error(message: string, metadata?: Record<string, any>): void;
  flush(): Promise<void>;
}
