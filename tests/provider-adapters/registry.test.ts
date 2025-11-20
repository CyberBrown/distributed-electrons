/**
 * Provider Registry Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRegistry } from '../../workers/shared/provider-adapters/registry';
import { IdeogramAdapter } from '../../workers/shared/provider-adapters/ideogram-adapter';

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  describe('getAdapter', () => {
    it('should return Ideogram adapter for ideogram provider', () => {
      const adapter = registry.getAdapter('ideogram');

      expect(adapter).toBeInstanceOf(IdeogramAdapter);
      expect(adapter.getProviderName()).toBe('ideogram');
    });

    it('should be case-insensitive', () => {
      const adapter1 = registry.getAdapter('ideogram');
      const adapter2 = registry.getAdapter('IDEOGRAM');
      const adapter3 = registry.getAdapter('Ideogram');

      expect(adapter1).toBeInstanceOf(IdeogramAdapter);
      expect(adapter2).toBeInstanceOf(IdeogramAdapter);
      expect(adapter3).toBeInstanceOf(IdeogramAdapter);
    });

    it('should throw error for unsupported provider', () => {
      expect(() => registry.getAdapter('unsupported')).toThrow(
        'Provider adapter not found: unsupported'
      );
    });
  });

  describe('isSupported', () => {
    it('should return true for supported providers', () => {
      expect(registry.isSupported('ideogram')).toBe(true);
      expect(registry.isSupported('IDEOGRAM')).toBe(true);
    });

    it('should return false for unsupported providers', () => {
      expect(registry.isSupported('dalle')).toBe(false);
      expect(registry.isSupported('midjourney')).toBe(false);
    });
  });

  describe('getSupportedProviders', () => {
    it('should return list of supported providers', () => {
      const providers = registry.getSupportedProviders();

      expect(providers).toContain('ideogram');
      expect(providers.length).toBeGreaterThan(0);
    });
  });

  describe('register', () => {
    it('should register new provider adapter', () => {
      // Create a mock adapter class
      class MockAdapter extends IdeogramAdapter {
        constructor() {
          super();
        }
      }

      registry.register('mock', MockAdapter);

      expect(registry.isSupported('mock')).toBe(true);
      const adapter = registry.getAdapter('mock');
      expect(adapter).toBeInstanceOf(MockAdapter);
    });
  });
});
