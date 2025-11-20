import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  StructuredLogger,
  createLogger,
  ConsoleLogger,
  type LoggerContext,
} from '../../workers/shared/logging/logger.js';

// Mock console methods
const originalConsole = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

describe('StructuredLogger', () => {
  let context: LoggerContext;

  beforeEach(() => {
    // Mock console methods
    console.debug = vi.fn();
    console.info = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();

    context = {
      request_id: 'req-123',
      instance_id: 'production',
      user_id: 'user-456',
      component: 'test-component',
    };
  });

  afterEach(() => {
    // Restore console
    console.debug = originalConsole.debug;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });

  describe('logging methods', () => {
    it('should log debug messages', () => {
      const logger = new StructuredLogger(context);
      logger.debug('Debug message', { foo: 'bar' });

      expect(console.debug).toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG]')
      );
      expect(console.debug).toHaveBeenCalledWith(
        expect.stringContaining('Debug message')
      );
    });

    it('should log info messages', () => {
      const logger = new StructuredLogger(context);
      logger.info('Info message');

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('[INFO]')
      );
      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('Info message')
      );
    });

    it('should log warning messages', () => {
      const logger = new StructuredLogger(context);
      logger.warn('Warning message');

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('[WARN]')
      );
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Warning message')
      );
    });

    it('should log error messages', () => {
      const logger = new StructuredLogger(context);
      logger.error('Error message');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR]')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Error message')
      );
    });
  });

  describe('context attachment', () => {
    it('should include request_id in logs', () => {
      const logger = new StructuredLogger(context);
      logger.info('Test message');

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('req-123')
      );
    });

    it('should include component in logs', () => {
      const logger = new StructuredLogger(context);
      logger.info('Test message');

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('test-component')
      );
    });

    it('should include metadata when provided', () => {
      const logger = new StructuredLogger(context);
      logger.info('Test message', { userId: 'user-123', action: 'login' });

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('userId')
      );
    });
  });

  describe('child logger', () => {
    it('should create child logger with additional context', () => {
      const logger = new StructuredLogger(context);
      const childLogger = logger.child({ component: 'child-component' });

      childLogger.info('Child message');

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('child-component')
      );
      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('req-123')
      );
    });

    it('should inherit parent context', () => {
      const logger = new StructuredLogger(context);
      const childLogger = logger.child({ user_id: 'new-user' });

      childLogger.info('Child message');

      // Should still use parent's request_id and component
      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('req-123')
      );
      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('test-component')
      );
    });
  });

  describe('flush', () => {
    it('should flush without error when no storage', async () => {
      const logger = new StructuredLogger(context);

      await expect(logger.flush()).resolves.toBeUndefined();
    });
  });
});

describe('createLogger', () => {
  beforeEach(() => {
    console.debug = vi.fn();
    console.info = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
  });

  afterEach(() => {
    console.debug = originalConsole.debug;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });

  it('should create a logger instance', () => {
    const logger = createLogger({
      request_id: 'req-123',
      component: 'test',
    });

    expect(logger).toBeInstanceOf(StructuredLogger);
  });

  it('should create a functional logger', () => {
    const logger = createLogger({
      request_id: 'req-123',
      component: 'test',
    });

    logger.info('Test message');

    expect(console.info).toHaveBeenCalled();
  });
});

describe('ConsoleLogger', () => {
  beforeEach(() => {
    console.debug = vi.fn();
    console.info = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
  });

  afterEach(() => {
    console.debug = originalConsole.debug;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });

  it('should log debug messages to console', () => {
    const logger = new ConsoleLogger('test-component');
    logger.debug('Debug message', { foo: 'bar' });

    expect(console.debug).toHaveBeenCalledWith(
      '[DEBUG] [test-component]',
      'Debug message',
      { foo: 'bar' }
    );
  });

  it('should log info messages to console', () => {
    const logger = new ConsoleLogger('test-component');
    logger.info('Info message');

    expect(console.info).toHaveBeenCalledWith(
      '[INFO] [test-component]',
      'Info message',
      ''
    );
  });

  it('should log warnings to console', () => {
    const logger = new ConsoleLogger('test-component');
    logger.warn('Warning message');

    expect(console.warn).toHaveBeenCalledWith(
      '[WARN] [test-component]',
      'Warning message',
      ''
    );
  });

  it('should log errors to console', () => {
    const logger = new ConsoleLogger('test-component');
    logger.error('Error message', { error: 'details' });

    expect(console.error).toHaveBeenCalledWith(
      '[ERROR] [test-component]',
      'Error message',
      { error: 'details' }
    );
  });

  it('should flush without error', async () => {
    const logger = new ConsoleLogger('test');
    await expect(logger.flush()).resolves.toBeUndefined();
  });
});
