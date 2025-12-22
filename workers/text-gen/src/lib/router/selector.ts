/**
 * DE Router Selector
 * Provider and model selection logic
 */

import type {
  ParsedProvider,
  ParsedModel,
  RequestConstraints,
  QualityTier,
  RouterEnv,
} from './types';
import { Registry } from './registry';

const QUALITY_ORDER: QualityTier[] = ['draft', 'standard', 'premium'];

/**
 * Selector for choosing providers and models based on constraints
 */
export class Selector {
  constructor(
    private registry: Registry,
    private env: RouterEnv
  ) {}

  /**
   * Select the best provider for a worker, considering constraints
   */
  async selectProvider(
    workerId: string,
    constraints?: RequestConstraints,
    preferredProvider?: string
  ): Promise<ParsedProvider | null> {
    const providers = await this.registry.getAvailableProviders(workerId, this.env);

    if (providers.length === 0) return null;

    // Apply constraints filter
    let filtered = this.filterProviders(providers, constraints);

    if (filtered.length === 0) {
      // Fall back to all available if constraints too strict
      filtered = providers;
    }

    // If preferred provider is available and passes constraints, use it
    if (preferredProvider) {
      const preferred = filtered.find((p) => p.id === preferredProvider);
      if (preferred) return preferred;
    }

    // Return highest priority (lowest number)
    return filtered[0];
  }

  /**
   * Select the best model for a provider and worker
   */
  async selectModel(
    providerId: string,
    workerId: string,
    constraints?: RequestConstraints,
    preferredModel?: string
  ): Promise<ParsedModel | null> {
    const models = await this.registry.getModelsForProvider(providerId, workerId);

    if (models.length === 0) return null;

    // Apply constraints filter
    let filtered = this.filterModels(models, constraints);

    if (filtered.length === 0) {
      // Fall back to all available if constraints too strict
      filtered = models;
    }

    // If preferred model matches, use it
    if (preferredModel) {
      const preferred = filtered.find(
        (m) => m.id === preferredModel || m.model_id === preferredModel
      );
      if (preferred) return preferred;
    }

    // Return highest priority (lowest number)
    return filtered[0];
  }

  /**
   * Select provider and model together
   */
  async selectProviderAndModel(
    workerId: string,
    constraints?: RequestConstraints,
    preferredProvider?: string,
    preferredModel?: string
  ): Promise<{ provider: ParsedProvider; model: ParsedModel } | null> {
    // Get all available providers
    const providers = await this.registry.getAvailableProviders(workerId, this.env);

    if (providers.length === 0) return null;

    // Filter providers
    let filteredProviders = this.filterProviders(providers, constraints);
    if (filteredProviders.length === 0) {
      filteredProviders = providers;
    }

    // If preferred provider specified, try it first
    if (preferredProvider) {
      const preferred = filteredProviders.find((p) => p.id === preferredProvider);
      if (preferred) {
        filteredProviders = [preferred, ...filteredProviders.filter((p) => p.id !== preferredProvider)];
      }
    }

    // Try each provider until we find one with a suitable model
    for (const provider of filteredProviders) {
      const model = await this.selectModel(
        provider.id,
        workerId,
        constraints,
        preferredModel
      );

      if (model) {
        return { provider, model };
      }
    }

    return null;
  }

  /**
   * Get ordered list of provider-model pairs for fallback
   */
  async getProviderModelChain(
    workerId: string,
    constraints?: RequestConstraints,
    preferredProvider?: string,
    preferredModel?: string
  ): Promise<Array<{ provider: ParsedProvider; model: ParsedModel }>> {
    const providers = await this.registry.getAvailableProviders(workerId, this.env);
    const chain: Array<{ provider: ParsedProvider; model: ParsedModel }> = [];

    // Filter providers
    let orderedProviders = this.filterProviders(providers, constraints);
    if (orderedProviders.length === 0) {
      orderedProviders = providers;
    }

    // Move preferred provider to front
    if (preferredProvider) {
      const preferred = orderedProviders.find((p) => p.id === preferredProvider);
      if (preferred) {
        orderedProviders = [
          preferred,
          ...orderedProviders.filter((p) => p.id !== preferredProvider),
        ];
      }
    }

    // Build chain with models
    for (const provider of orderedProviders) {
      const models = await this.registry.getModelsForProvider(provider.id, workerId);
      let filteredModels = this.filterModels(models, constraints);

      if (filteredModels.length === 0) {
        filteredModels = models;
      }

      // Move preferred model to front for this provider
      if (preferredModel) {
        const preferred = filteredModels.find(
          (m) => m.id === preferredModel || m.model_id === preferredModel
        );
        if (preferred) {
          filteredModels = [
            preferred,
            ...filteredModels.filter((m) => m.id !== preferred.id),
          ];
        }
      }

      // Add all models for this provider
      for (const model of filteredModels) {
        chain.push({ provider, model });
      }
    }

    return chain;
  }

  /**
   * Filter providers based on constraints
   */
  private filterProviders(
    providers: ParsedProvider[],
    constraints?: RequestConstraints
  ): ParsedProvider[] {
    if (!constraints) return providers;

    return providers.filter((p) => {
      // Exclude specific providers
      if (constraints.exclude_providers?.includes(p.id)) {
        return false;
      }

      // Require local provider
      if (constraints.require_local && p.type !== 'local') {
        return false;
      }

      return true;
    });
  }

  /**
   * Filter models based on constraints
   */
  private filterModels(
    models: ParsedModel[],
    constraints?: RequestConstraints
  ): ParsedModel[] {
    if (!constraints) return models;

    return models.filter((m) => {
      // Check minimum quality tier
      if (constraints.min_quality) {
        const modelQualityIndex = QUALITY_ORDER.indexOf(m.quality_tier || 'standard');
        const requiredQualityIndex = QUALITY_ORDER.indexOf(constraints.min_quality);
        if (modelQualityIndex < requiredQualityIndex) {
          return false;
        }
      }

      // Check required capabilities
      if (constraints.require_capabilities?.length) {
        const hasAll = constraints.require_capabilities.every((cap) =>
          m.capabilities.includes(cap)
        );
        if (!hasAll) return false;
      }

      // Check max cost
      if (constraints.max_cost_cents !== undefined) {
        const avgCost = ((m.cost_input_per_1k || 0) + (m.cost_output_per_1k || 0)) / 2;
        // Rough estimate: assume 1k tokens per request
        if (avgCost * 100 > constraints.max_cost_cents) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Get API key for a provider
   */
  getApiKey(provider: ParsedProvider): string | null {
    if (!provider.auth_secret_name) return null;
    return (this.env as any)[provider.auth_secret_name] || null;
  }

  /**
   * Get base URL for a provider
   */
  getBaseUrl(provider: ParsedProvider): string | null {
    // For local providers, the URL is in the secret
    if (provider.type === 'local' && provider.auth_secret_name) {
      return (this.env as any)[provider.auth_secret_name] || null;
    }
    return provider.base_endpoint;
  }
}
