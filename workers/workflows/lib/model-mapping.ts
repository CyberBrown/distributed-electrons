/**
 * Model-to-Runner Mapping Utilities
 *
 * Maps specific model names (e.g., "claude-opus-4.5", "gemini-2.0-flash-exp")
 * to their corresponding runner endpoints and API model identifiers.
 *
 * Supports:
 * - Claude models → claude-runner (port 8789)
 * - Gemini models → gemini-runner (port 8790)
 * - Local models → vllm endpoint (port 8000)
 */

/**
 * Runner configuration for a specific model
 */
export interface RunnerConfig {
  /** Local URL (e.g., http://localhost:8789) */
  url: string;
  /** Cloudflare Tunnel URL */
  tunnel: string;
  /** API model identifier to send to the runner */
  api_model: string;
  /** Runner type (claude, gemini, or vllm) */
  runner_type: 'claude' | 'gemini' | 'vllm';
}

/**
 * Default model waterfall
 * Order: Claude Sonnet (balanced) → Gemini Flash (fast) → Claude Opus (powerful) → GLM-4 (local fallback)
 */
export const DEFAULT_MODEL_WATERFALL = [
  'claude-sonnet-4.5',
  'gemini-2.0-flash-exp',
  'claude-opus-4.5',
  'glm-4-7b',
] as const;

/**
 * Legacy executor to model mapping
 * Maps old binary 'claude'/'gemini' preference to default models
 */
export function legacyExecutorToWaterfall(executor: 'claude' | 'gemini'): string[] {
  if (executor === 'claude') {
    return ['claude-sonnet-4.5', 'gemini-2.0-flash-exp', 'claude-opus-4.5'];
  } else {
    return ['gemini-2.0-flash-exp', 'claude-sonnet-4.5', 'claude-opus-4.5'];
  }
}

/**
 * Model to runner mapping
 * Maps friendly model names to runner configurations
 */
const MODEL_RUNNER_MAP: Record<string, RunnerConfig> = {
  // Claude models → claude-runner (port 8789)
  'claude-opus-4.5': {
    url: 'http://localhost:8789',
    tunnel: 'https://claude-runner.shiftaltcreate.com',
    api_model: 'claude-opus-4-5-20251101',
    runner_type: 'claude',
  },
  'claude-sonnet-4.5': {
    url: 'http://localhost:8789',
    tunnel: 'https://claude-runner.shiftaltcreate.com',
    api_model: 'claude-sonnet-4-5-20250929',
    runner_type: 'claude',
  },
  'claude-haiku-4': {
    url: 'http://localhost:8789',
    tunnel: 'https://claude-runner.shiftaltcreate.com',
    api_model: 'claude-haiku-4-20250514',
    runner_type: 'claude',
  },

  // Gemini models → gemini-runner (port 8790)
  'gemini-2.0-flash-exp': {
    url: 'http://localhost:8790',
    tunnel: 'https://gemini.spark.shiftaltcreate.com',
    api_model: 'gemini-2.0-flash-exp',
    runner_type: 'gemini',
  },
  'gemini-2.0-flash-thinking-exp': {
    url: 'http://localhost:8790',
    tunnel: 'https://gemini.spark.shiftaltcreate.com',
    api_model: 'gemini-2.0-flash-thinking-exp-01-21',
    runner_type: 'gemini',
  },
  'gemini-1.5-pro': {
    url: 'http://localhost:8790',
    tunnel: 'https://gemini.spark.shiftaltcreate.com',
    api_model: 'gemini-1.5-pro',
    runner_type: 'gemini',
  },

  // Local models → vllm endpoint (port 8000)
  'glm-4-7b': {
    url: 'http://localhost:8000',
    tunnel: 'https://vllm.shiftaltcreate.com',
    api_model: 'glm-4-7b',
    runner_type: 'vllm',
  },
};

/**
 * Get runner configuration for a specific model
 * Returns the runner config or the default (claude-sonnet-4.5) if not found
 */
export function getRunnerForModel(model: string): RunnerConfig {
  const config = MODEL_RUNNER_MAP[model];
  if (!config) {
    console.warn(`[model-mapping] Unknown model "${model}", falling back to claude-sonnet-4.5`);
    return MODEL_RUNNER_MAP['claude-sonnet-4.5'];
  }
  return config;
}

/**
 * Check if a model name is valid
 */
export function isValidModel(model: string): boolean {
  return model in MODEL_RUNNER_MAP;
}

/**
 * Get all supported models
 */
export function getSupportedModels(): string[] {
  return Object.keys(MODEL_RUNNER_MAP);
}

/**
 * Parse default waterfall from environment variable
 * Format: comma-separated model names
 * Example: "claude-sonnet-4.5,gemini-2.0-flash-exp,claude-opus-4.5"
 */
export function parseDefaultWaterfall(waterfallEnv?: string): string[] {
  if (!waterfallEnv) {
    return [...DEFAULT_MODEL_WATERFALL];
  }

  const models = waterfallEnv.split(',').map(m => m.trim()).filter(Boolean);

  // Validate each model
  const validModels = models.filter(model => {
    if (!isValidModel(model)) {
      console.warn(`[model-mapping] Invalid model in DEFAULT_MODEL_WATERFALL: "${model}"`);
      return false;
    }
    return true;
  });

  if (validModels.length === 0) {
    console.warn('[model-mapping] No valid models in DEFAULT_MODEL_WATERFALL, using hardcoded default');
    return [...DEFAULT_MODEL_WATERFALL];
  }

  return validModels;
}

/**
 * Determine effective waterfall from request parameters
 * Priority:
 * 1. Time-based override (if not expired)
 * 2. model_waterfall parameter
 * 3. primary_model parameter
 * 4. Legacy executor parameter
 * 5. Default waterfall
 */
export function determineWaterfall(params: {
  model_waterfall?: string[];
  primary_model?: string;
  preferred_executor?: 'claude' | 'gemini';
  override_until?: string;
  override_waterfall?: string[];
  default_waterfall?: string[];
}): string[] {
  const {
    model_waterfall,
    primary_model,
    preferred_executor,
    override_until,
    override_waterfall,
    default_waterfall = [...DEFAULT_MODEL_WATERFALL],
  } = params;

  // 1. Check time-based override
  if (override_until && override_waterfall) {
    const expiryTime = new Date(override_until);
    const now = new Date();

    if (expiryTime > now) {
      console.log(`[model-mapping] Using override waterfall (expires ${override_until})`);
      return override_waterfall;
    } else {
      console.log(`[model-mapping] Override expired at ${override_until}, ignoring`);
    }
  }

  // 2. Use specified waterfall
  if (model_waterfall && model_waterfall.length > 0) {
    console.log(`[model-mapping] Using specified waterfall: ${model_waterfall.join(', ')}`);
    return model_waterfall;
  }

  // 3. Use primary model (convert to single-item waterfall)
  if (primary_model) {
    console.log(`[model-mapping] Using primary_model: ${primary_model}`);
    return [primary_model];
  }

  // 4. Legacy executor mapping
  if (preferred_executor) {
    const legacyWaterfall = legacyExecutorToWaterfall(preferred_executor);
    console.log(`[model-mapping] Using legacy executor "${preferred_executor}" → ${legacyWaterfall.join(', ')}`);
    return legacyWaterfall;
  }

  // 5. Default waterfall
  console.log(`[model-mapping] Using default waterfall: ${default_waterfall.join(', ')}`);
  return default_waterfall;
}
