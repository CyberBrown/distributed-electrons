/**
 * Audio Generation Worker Types
 */

export interface SynthesizeRequest {
  text: string;
  voice_id?: string;
  model_id?: string;
  instance_id?: string;
  project_id?: string;
  options?: {
    stability?: number;
    similarity_boost?: number;
    style?: number;
    use_speaker_boost?: boolean;
    output_format?: 'mp3_44100_128' | 'mp3_44100_192' | 'pcm_16000' | 'pcm_22050' | 'pcm_24000' | 'pcm_44100';
  };
}

export interface SynthesizeResponse {
  success: boolean;
  audio_url: string;
  duration_seconds: number;
  metadata: {
    provider: string;
    voice_id: string;
    model_id: string;
    character_count: number;
    generation_time_ms: number;
  };
  request_id: string;
  timestamp: string;
}

export interface ErrorResponse {
  error: string;
  error_code: string;
  request_id: string;
  details?: Record<string, any>;
}

export interface Env {
  // Bindings
  AUDIO_STORAGE: R2Bucket;
  RATE_LIMITER?: DurableObjectNamespace;

  // Environment variables
  DEFAULT_INSTANCE_ID?: string;
  DEFAULT_VOICE_ID?: string;
  DEFAULT_MODEL_ID?: string;

  // API Keys (from secrets)
  ELEVENLABS_API_KEY?: string;
  // Cloudflare AI Gateway token - routes OpenAI TTS calls through Gateway
  CF_AIG_TOKEN?: string;
}

export interface InstanceConfig {
  instance_id: string;
  org_id: string;
  api_keys: Record<string, string>;
  rate_limits: Record<string, { rpm: number; tpm: number }>;
}

export interface AudioResult {
  audio_data: ArrayBuffer;
  duration_seconds: number;
  provider: string;
  voice_id: string;
  model_id: string;
  character_count: number;
}
