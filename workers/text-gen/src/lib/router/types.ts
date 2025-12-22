/**
 * DE Router Types
 * All TypeScript interfaces for the Universal Router
 */

// ============================================================================
// Media Types
// ============================================================================

export type MediaType = 'text' | 'image' | 'video' | 'audio' | 'embedding' | 'mixed';
export type QualityTier = 'draft' | 'standard' | 'premium';
export type SpeedTier = 'fast' | 'medium' | 'slow';
export type AuthType = 'api_key' | 'bearer' | 'none';
export type ProviderType = 'api' | 'local' | 'gateway';

// ============================================================================
// Database Models
// ============================================================================

export interface Worker {
  id: string;
  name: string;
  media_types: string; // JSON array
  enabled: number;
  created_at: string;
}

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  base_endpoint: string | null;
  auth_type: AuthType | null;
  auth_secret_name: string | null;
  priority: number;
  enabled: number;
  rate_limit_rpm: number | null;
  daily_quota: number | null;
  created_at: string;
}

export interface Model {
  id: string;
  provider_id: string;
  model_id: string;
  worker_id: string;
  capabilities: string | null; // JSON array
  context_window: number | null;
  cost_input_per_1k: number | null;
  cost_output_per_1k: number | null;
  quality_tier: QualityTier | null;
  speed_tier: SpeedTier | null;
  priority: number;
  enabled: number;
}

export interface WorkerProvider {
  worker_id: string;
  provider_id: string;
  priority: number;
}

export interface ProviderStatus {
  provider_id: string;
  healthy: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: number;
  quota_used_today: number;
  quota_resets_at: string | null;
  marked_exhausted_until: string | null;
}

export interface StoredWorkflow {
  id: string;
  name: string;
  description: string | null;
  definition: string; // JSON WorkflowDefinition
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Parsed/Runtime Types
// ============================================================================

export interface ParsedProvider extends Omit<Provider, 'enabled'> {
  enabled: boolean;
  status?: ProviderStatus;
}

export interface ParsedModel extends Omit<Model, 'enabled' | 'capabilities'> {
  enabled: boolean;
  capabilities: string[];
}

// ============================================================================
// Request Types
// ============================================================================

export interface RequestConstraints {
  max_cost_cents?: number;
  max_latency_ms?: number;
  min_quality?: QualityTier;
  require_local?: boolean;
  require_capabilities?: string[];
  exclude_providers?: string[];
}

export interface TextOptions {
  system_prompt?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
}

export interface ImageOptions {
  width?: number;
  height?: number;
  aspect_ratio?: string;
  style?: string;
  negative_prompt?: string;
  num_images?: number;
}

export interface AudioOptions {
  voice_id?: string;
  speed?: number;
  stability?: number;
  similarity_boost?: number;
  output_format?: string;
}

export interface VideoOptions {
  duration?: number;
  fps?: number;
  resolution?: string;
  aspect_ratio?: string;
}

export type MediaOptions = TextOptions | ImageOptions | AudioOptions | VideoOptions;

export interface SimpleRequest {
  type: 'simple';
  worker: string;
  prompt: string;
  preferred_provider?: string;
  preferred_model?: string;
  constraints?: RequestConstraints;
  options?: MediaOptions;
}

export interface WorkflowRequest {
  type: 'workflow';
  workflow_id?: string;
  workflow?: WorkflowDefinition;
  variables: Record<string, any>;
  constraints?: RequestConstraints;
}

export type RouterRequest = SimpleRequest | WorkflowRequest;

// ============================================================================
// Workflow Types
// ============================================================================

export interface WorkflowStep {
  id: string;
  worker: string;
  prompt_template: string;
  input_from?: string; // 'step:previous-step-id' or 'request'
  output_key: string;
  constraints?: RequestConstraints;
  options?: MediaOptions;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  parallel_groups?: string[][]; // Steps that can run in parallel
}

// ============================================================================
// Response Types
// ============================================================================

export interface StepMeta {
  id: string;
  worker: string;
  provider: string;
  model: string;
  latency_ms: number;
  cost_cents?: number;
  tokens_used?: number;
}

export interface RouterResponseMeta {
  request_type: 'simple' | 'workflow';
  steps: StepMeta[];
  total_cost_cents: number;
  total_latency_ms: number;
}

export interface RouterResponse {
  success: boolean;
  results: Record<string, any>;
  _meta: RouterResponseMeta;
}

export interface TextResult {
  text: string;
  provider: string;
  model: string;
  tokens_used?: number;
}

export interface ImageResult {
  url: string;
  base64?: string;
  provider: string;
  model: string;
  width?: number;
  height?: number;
}

export interface AudioResult {
  url?: string;
  base64?: string;
  provider: string;
  model: string;
  duration_ms?: number;
}

export interface VideoResult {
  url: string;
  provider: string;
  model: string;
  duration_ms?: number;
}

export type MediaResult = TextResult | ImageResult | AudioResult | VideoResult;

// ============================================================================
// Adapter Types
// ============================================================================

export interface AdapterContext {
  worker: string;
  provider: ParsedProvider;
  model: ParsedModel;
  apiKey: string;
  baseUrl?: string;
}

export interface ProviderAdapter {
  readonly providerId: string;
  readonly supportedWorkers: string[];

  execute(
    prompt: string,
    options: MediaOptions,
    context: AdapterContext
  ): Promise<MediaResult>;

  checkHealth?(context: AdapterContext): Promise<boolean>;
}

// ============================================================================
// Transformer Types
// ============================================================================

export interface TransformContext {
  worker: string;
  provider: string;
  model: string;
  task_type?: string;
  capabilities_needed?: string[];
}

export interface PromptTransformer {
  readonly providerId: string;

  transform(prompt: string, context: TransformContext): string;
  getSystemPrompt(context: TransformContext): string | null;
}

// ============================================================================
// Router Environment
// ============================================================================

export interface RouterEnv {
  DB: D1Database;

  // Provider API Keys
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  IDEOGRAM_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  REPLICATE_API_KEY?: string;

  // Local providers
  SPARK_LOCAL_URL?: string;
  SPARK_API_KEY?: string;
}

// ============================================================================
// Error Types
// ============================================================================

export class RouterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly provider?: string,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'RouterError';
  }
}

export class QuotaExhaustedError extends RouterError {
  constructor(provider: string, message: string) {
    super(message, 'QUOTA_EXHAUSTED', provider, false);
    this.name = 'QuotaExhaustedError';
  }
}

export class ProviderError extends RouterError {
  constructor(provider: string, message: string, retryable: boolean = true) {
    super(message, 'PROVIDER_ERROR', provider, retryable);
    this.name = 'ProviderError';
  }
}

export class NoAvailableProviderError extends RouterError {
  constructor(worker: string) {
    super(`No available providers for worker: ${worker}`, 'NO_PROVIDERS', undefined, false);
    this.name = 'NoAvailableProviderError';
  }
}
