/**
 * Provider Adapter Registry
 * Factory pattern for instantiating provider adapters
 */

import { ProviderAdapter } from './base-adapter';
import { IdeogramAdapter } from './ideogram-adapter';

type ProviderAdapterClass = new () => ProviderAdapter;

class ProviderRegistry {
  private adapters: Map<string, ProviderAdapterClass> = new Map();

  constructor() {
    // Register default providers
    this.register('ideogram', IdeogramAdapter);
  }

  /**
   * Register a new provider adapter
   */
  register(providerName: string, adapterClass: ProviderAdapterClass): void {
    this.adapters.set(providerName.toLowerCase(), adapterClass);
  }

  /**
   * Get an adapter instance for a provider
   */
  getAdapter(providerName: string): ProviderAdapter {
    const adapterClass = this.adapters.get(providerName.toLowerCase());

    if (!adapterClass) {
      throw new Error(
        `Provider adapter not found: ${providerName}. Available providers: ${Array.from(
          this.adapters.keys()
        ).join(', ')}`
      );
    }

    return new adapterClass();
  }

  /**
   * Check if a provider is supported
   */
  isSupported(providerName: string): boolean {
    return this.adapters.has(providerName.toLowerCase());
  }

  /**
   * Get list of all supported providers
   */
  getSupportedProviders(): string[] {
    return Array.from(this.adapters.keys());
  }
}

// Export singleton instance
export const providerRegistry = new ProviderRegistry();

// Export class for testing
export { ProviderRegistry };
