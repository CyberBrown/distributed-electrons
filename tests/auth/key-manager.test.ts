/**
 * Key Manager Tests
 *
 * Tests for API key generation, hashing, and validation
 */

import { describe, it, expect } from 'vitest';
import {
  generateApiKey,
  generateTestApiKey,
  isValidKeyFormat,
  hashApiKey,
  verifyApiKey,
  isTestKey,
  isLiveKey,
  extractApiKey,
  sanitizeKeyForLogging,
  generateKeyPair,
} from '@/infrastructure/auth/key-manager';

describe('Key Manager', () => {
  describe('generateApiKey', () => {
    it('should generate a live API key with correct format', async () => {
      const key = await generateApiKey();

      expect(key).toMatch(/^sk_live_[0-9a-f]{64}$/);
    });

    it('should generate unique keys', async () => {
      const key1 = await generateApiKey();
      const key2 = await generateApiKey();

      expect(key1).not.toBe(key2);
    });

    it('should generate keys of correct length', async () => {
      const key = await generateApiKey();

      // sk_live_ (8 chars) + 64 hex chars = 72 total
      expect(key.length).toBe(72);
    });
  });

  describe('generateTestApiKey', () => {
    it('should generate a test API key with correct format', async () => {
      const key = await generateTestApiKey();

      expect(key).toMatch(/^sk_test_[0-9a-f]{64}$/);
    });

    it('should generate unique test keys', async () => {
      const key1 = await generateTestApiKey();
      const key2 = await generateTestApiKey();

      expect(key1).not.toBe(key2);
    });
  });

  describe('isValidKeyFormat', () => {
    it('should accept valid live keys', () => {
      const validKey = 'sk_live_' + 'a'.repeat(64);
      expect(isValidKeyFormat(validKey)).toBe(true);
    });

    it('should accept valid test keys', () => {
      const validKey = 'sk_test_' + 'b'.repeat(64);
      expect(isValidKeyFormat(validKey)).toBe(true);
    });

    it('should reject keys with invalid prefix', () => {
      const invalidKey = 'invalid_' + 'a'.repeat(64);
      expect(isValidKeyFormat(invalidKey)).toBe(false);
    });

    it('should reject keys with wrong length', () => {
      const shortKey = 'sk_live_abc123';
      expect(isValidKeyFormat(shortKey)).toBe(false);
    });

    it('should reject keys with non-hex characters', () => {
      const invalidKey = 'sk_live_' + 'g'.repeat(64);
      expect(isValidKeyFormat(invalidKey)).toBe(false);
    });

    it('should reject empty strings', () => {
      expect(isValidKeyFormat('')).toBe(false);
    });

    it('should reject malformed keys', () => {
      expect(isValidKeyFormat('sk_live')).toBe(false);
      expect(isValidKeyFormat('sk_live_')).toBe(false);
    });
  });

  describe('hashApiKey', () => {
    it('should hash a valid API key', async () => {
      const key = await generateApiKey();
      const hash = await hashApiKey(key);

      // SHA-256 produces 64 hex characters
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce consistent hashes', async () => {
      const key = await generateApiKey();
      const hash1 = await hashApiKey(key);
      const hash2 = await hashApiKey(key);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different keys', async () => {
      const key1 = await generateApiKey();
      const key2 = await generateApiKey();

      const hash1 = await hashApiKey(key1);
      const hash2 = await hashApiKey(key2);

      expect(hash1).not.toBe(hash2);
    });

    it('should reject invalid key formats', async () => {
      await expect(hashApiKey('invalid-key')).rejects.toThrow(
        'Invalid API key format'
      );
    });
  });

  describe('verifyApiKey', () => {
    it('should verify correct API key against hash', async () => {
      const key = await generateApiKey();
      const hash = await hashApiKey(key);

      const isValid = await verifyApiKey(key, hash);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect API key', async () => {
      const key1 = await generateApiKey();
      const key2 = await generateApiKey();
      const hash1 = await hashApiKey(key1);

      const isValid = await verifyApiKey(key2, hash1);
      expect(isValid).toBe(false);
    });

    it('should reject invalid key format', async () => {
      const validKey = await generateApiKey();
      const hash = await hashApiKey(validKey);

      const isValid = await verifyApiKey('invalid-key', hash);
      expect(isValid).toBe(false);
    });

    it('should reject empty hash', async () => {
      const key = await generateApiKey();
      const isValid = await verifyApiKey(key, '');
      expect(isValid).toBe(false);
    });
  });

  describe('isTestKey', () => {
    it('should identify test keys', async () => {
      const testKey = await generateTestApiKey();
      expect(isTestKey(testKey)).toBe(true);
    });

    it('should reject live keys', async () => {
      const liveKey = await generateApiKey();
      expect(isTestKey(liveKey)).toBe(false);
    });
  });

  describe('isLiveKey', () => {
    it('should identify live keys', async () => {
      const liveKey = await generateApiKey();
      expect(isLiveKey(liveKey)).toBe(true);
    });

    it('should reject test keys', async () => {
      const testKey = await generateTestApiKey();
      expect(isLiveKey(testKey)).toBe(false);
    });
  });

  describe('extractApiKey', () => {
    it('should extract key from Bearer token format', async () => {
      const key = await generateApiKey();
      const authHeader = `Bearer ${key}`;

      const extracted = extractApiKey(authHeader);
      expect(extracted).toBe(key);
    });

    it('should extract key without Bearer prefix', async () => {
      const key = await generateApiKey();
      const extracted = extractApiKey(key);
      expect(extracted).toBe(key);
    });

    it('should return null for invalid format', () => {
      const extracted = extractApiKey('Bearer invalid-key');
      expect(extracted).toBeNull();
    });

    it('should return null for empty string', () => {
      const extracted = extractApiKey('');
      expect(extracted).toBeNull();
    });

    it('should handle whitespace correctly', async () => {
      const key = await generateApiKey();
      const authHeader = `Bearer  ${key}`;

      // Should not extract due to extra space
      const extracted = extractApiKey(authHeader);
      expect(extracted).toBeNull();
    });
  });

  describe('sanitizeKeyForLogging', () => {
    it('should sanitize live keys for logging', async () => {
      const key = await generateApiKey();
      const sanitized = sanitizeKeyForLogging(key);

      expect(sanitized).toMatch(/^sk_live_\.\.\.[0-9a-f]{4}$/);
      expect(sanitized).not.toBe(key);
    });

    it('should sanitize test keys for logging', async () => {
      const key = await generateTestApiKey();
      const sanitized = sanitizeKeyForLogging(key);

      expect(sanitized).toMatch(/^sk_test_\.\.\.[0-9a-f]{4}$/);
      expect(sanitized).not.toBe(key);
    });

    it('should return *** for short strings', () => {
      const sanitized = sanitizeKeyForLogging('short');
      expect(sanitized).toBe('***');
    });

    it('should return *** for empty strings', () => {
      const sanitized = sanitizeKeyForLogging('');
      expect(sanitized).toBe('***');
    });
  });

  describe('generateKeyPair', () => {
    it('should generate a key pair with valid key and hash', async () => {
      const { apiKey, hash } = await generateKeyPair();

      expect(isValidKeyFormat(apiKey)).toBe(true);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should generate verifiable key pairs', async () => {
      const { apiKey, hash } = await generateKeyPair();

      const isValid = await verifyApiKey(apiKey, hash);
      expect(isValid).toBe(true);
    });

    it('should generate unique key pairs', async () => {
      const pair1 = await generateKeyPair();
      const pair2 = await generateKeyPair();

      expect(pair1.apiKey).not.toBe(pair2.apiKey);
      expect(pair1.hash).not.toBe(pair2.hash);
    });
  });
});
