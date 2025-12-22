/**
 * Provider Adapter Registry
 * Central registry for all provider adapters
 */

import type { ProviderAdapter } from '../types';
import { AnthropicAdapter } from './anthropic';
import { OpenAIAdapter } from './openai';
import { SparkAdapter } from './spark';
import { IdeogramAdapter } from './ideogram';
import { ElevenLabsAdapter } from './elevenlabs';
import { ReplicateAdapter } from './replicate';

// Re-export adapters
export { BaseAdapter, TextAdapter, ImageAdapter, AudioAdapter, VideoAdapter } from './base';
export { isQuotaError, isTransientError } from './base';
export { AnthropicAdapter } from './anthropic';
export { OpenAIAdapter } from './openai';
export { SparkAdapter } from './spark';
export { IdeogramAdapter } from './ideogram';
export { ElevenLabsAdapter } from './elevenlabs';
export { ReplicateAdapter } from './replicate';

/**
 * Adapter Registry
 * Maps provider IDs to their adapter instances
 */
export class AdapterRegistry {
  private adapters = new Map<string, ProviderAdapter>();

  constructor() {
    // Register default adapters
    this.register(new AnthropicAdapter());
    this.register(new OpenAIAdapter());
    this.register(new SparkAdapter());
    this.register(new IdeogramAdapter());
    this.register(new ElevenLabsAdapter());
    this.register(new ReplicateAdapter());
  }

  /**
   * Register an adapter
   */
  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.providerId, adapter);
  }

  /**
   * Get adapter by provider ID
   */
  get(providerId: string): ProviderAdapter | null {
    return this.adapters.get(providerId) || null;
  }

  /**
   * Get all adapters that support a worker
   */
  getForWorker(workerId: string): ProviderAdapter[] {
    const result: ProviderAdapter[] = [];
    for (const adapter of this.adapters.values()) {
      if (adapter.supportedWorkers.includes(workerId)) {
        result.push(adapter);
      }
    }
    return result;
  }

  /**
   * Check if a provider is supported
   */
  has(providerId: string): boolean {
    return this.adapters.has(providerId);
  }

  /**
   * List all registered provider IDs
   */
  list(): string[] {
    return Array.from(this.adapters.keys());
  }
}

// Singleton instance
export const adapterRegistry = new AdapterRegistry();
