/**
 * Provider Adapters Module
 * Extensible framework for AI provider integrations
 */

export { ProviderAdapter } from './base-adapter';
export { IdeogramAdapter } from './ideogram-adapter';
export { providerRegistry, ProviderRegistry } from './registry';
export type {
  ImageGenerationOptions,
  ProviderRequest,
  JobStatus,
  ImageResult,
  ProviderError,
} from './types';
