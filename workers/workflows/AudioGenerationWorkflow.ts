/**
 * AudioGenerationWorkflow
 *
 * Cloudflare Workflow for durable audio/speech generation.
 * Wraps the audio-gen worker with:
 * - Validation and early error detection
 * - Provider fallback (ElevenLabs → OpenAI TTS)
 * - Automatic retries with exponential backoff
 * - R2 storage for generated audio
 * - Callback notifications
 *
 * Steps:
 * 1. validate-request: Validate text and parameters
 * 2. synthesize-audio: Call TTS provider with fallback
 * 3. send-callback: Notify caller of result
 */

import { WorkflowEntrypoint, WorkflowStep, type WorkflowEvent } from 'cloudflare:workers';
import type { NexusEnv } from './types';

// Default audio-gen worker URL
const DEFAULT_AUDIO_GEN_URL = 'https://audio-gen.solamp.workers.dev';

export interface AudioGenerationParams {
  /** Unique request identifier */
  request_id: string;

  /** The text to synthesize into speech */
  text: string;

  /** Voice ID (provider-specific) */
  voice_id?: string;

  /** Model ID (e.g., 'eleven_monolingual_v1') */
  model_id?: string;

  /** Synthesis options */
  options?: {
    stability?: number;
    similarity_boost?: number;
    style?: number;
    speed?: number;
  };

  /** Optional callback URL for completion notification */
  callback_url?: string;

  /** Execution timeout in milliseconds (default: 60000 = 1 minute) */
  timeout_ms?: number;
}

export interface AudioGenerationResult {
  success: boolean;
  request_id: string;
  audio_url?: string;
  duration_seconds?: number;
  provider?: string;
  voice_id?: string;
  model_id?: string;
  error?: string;
  duration_ms: number;
}

interface AudioGenEnv extends NexusEnv {
  AUDIO_GEN_URL?: string;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

export class AudioGenerationWorkflow extends WorkflowEntrypoint<AudioGenEnv, AudioGenerationParams> {
  /**
   * Main workflow execution
   */
  override async run(event: WorkflowEvent<AudioGenerationParams>, step: WorkflowStep) {
    const {
      request_id,
      text,
      voice_id,
      model_id,
      options,
      callback_url,
      timeout_ms = 60000, // 1 minute default
    } = event.payload;

    const startTime = Date.now();

    console.log(`[AudioGenerationWorkflow] Starting for request ${request_id}`);
    console.log(`[AudioGenerationWorkflow] Text length: ${text.length} characters`);

    // Step 1: Validate request
    const validation = await step.do(
      'validate-request',
      {
        retries: { limit: 1, delay: '1 second', backoff: 'constant' },
        timeout: '10 seconds',
      },
      async () => {
        return this.validateRequest(event.payload);
      }
    );

    if (!validation.valid) {
      console.error(`[AudioGenerationWorkflow] Validation failed: ${validation.error}`);
      return this.createErrorResult(request_id, validation.error, startTime);
    }

    // Step 2: Synthesize audio via audio-gen worker
    let result: AudioGenerationResult;
    try {
      result = await step.do(
        'synthesize-audio',
        {
          retries: { limit: 2, delay: '3 seconds', backoff: 'exponential' },
          timeout: `${Math.ceil(timeout_ms / 1000)} seconds`,
        },
        async () => {
          return this.synthesizeAudio(request_id, text, voice_id, model_id, options);
        }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[AudioGenerationWorkflow] Synthesis failed: ${errorMessage}`);
      result = this.createErrorResult(request_id, errorMessage, startTime);
    }

    // Step 3: Send callback if configured
    if (callback_url) {
      await step.do(
        'send-callback',
        {
          retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' },
          timeout: '30 seconds',
        },
        async () => {
          await this.sendCallback(callback_url, result);
          return { sent: true };
        }
      );
    }

    // Step 4: Log completion
    await step.do(
      'log-completion',
      {
        retries: { limit: 1, delay: '1 second', backoff: 'constant' },
        timeout: '5 seconds',
      },
      async () => {
        console.log(`[AudioGenerationWorkflow] Completed request ${request_id}`);
        console.log(`[AudioGenerationWorkflow] Result: success=${result.success}, provider=${result.provider}`);
        return { logged: true };
      }
    );

    return result;
  }

  /**
   * Validate request parameters
   */
  private validateRequest(params: AudioGenerationParams): ValidationResult {
    if (!params.request_id) {
      return { valid: false, error: 'Missing request_id' };
    }

    if (!params.text || params.text.trim() === '') {
      return { valid: false, error: 'Missing or empty text' };
    }

    if (params.text.length > 5000) {
      return { valid: false, error: 'Text exceeds maximum length of 5000 characters' };
    }

    return { valid: true };
  }

  /**
   * Synthesize audio via audio-gen worker
   */
  private async synthesizeAudio(
    request_id: string,
    text: string,
    voice_id?: string,
    model_id?: string,
    options?: AudioGenerationParams['options']
  ): Promise<AudioGenerationResult> {
    const audioGenUrl = this.env.AUDIO_GEN_URL || DEFAULT_AUDIO_GEN_URL;
    const startTime = Date.now();

    console.log(`[AudioGenerationWorkflow] Calling audio-gen at ${audioGenUrl}/synthesize`);

    const response = await fetch(`${audioGenUrl}/synthesize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        voice_id,
        model_id,
        options: options || {},
      }),
    });

    const result = await response.json() as {
      success: boolean;
      audio_url?: string;
      duration_seconds?: number;
      metadata?: {
        provider?: string;
        voice_id?: string;
        model_id?: string;
      };
      error?: string;
    };

    if (!result.success) {
      throw new Error(result.error || 'Audio synthesis failed');
    }

    return {
      success: true,
      request_id,
      audio_url: result.audio_url,
      duration_seconds: result.duration_seconds,
      provider: result.metadata?.provider,
      voice_id: result.metadata?.voice_id,
      model_id: result.metadata?.model_id,
      duration_ms: Date.now() - startTime,
    };
  }

  /**
   * Send callback to caller with result
   */
  private async sendCallback(
    callbackUrl: string,
    result: AudioGenerationResult
  ): Promise<void> {
    console.log(`[AudioGenerationWorkflow] Sending callback to ${callbackUrl}`);

    const response = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Passphrase': this.env.NEXUS_PASSPHRASE || '',
      },
      body: JSON.stringify({
        request_id: result.request_id,
        status: result.success ? 'completed' : 'failed',
        content_type: 'audio_url',
        content: result.audio_url,
        duration_seconds: result.duration_seconds,
        provider: result.provider,
        voice_id: result.voice_id,
        model_id: result.model_id,
        error: result.error,
        duration_ms: result.duration_ms,
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[AudioGenerationWorkflow] Callback failed (${response.status}): ${errorText}`);
      throw new Error(`Callback failed: ${response.status}`);
    }

    console.log('[AudioGenerationWorkflow] Callback sent successfully');
  }

  /**
   * Create error result
   */
  private createErrorResult(
    request_id: string,
    error: string | undefined,
    startTime: number
  ): AudioGenerationResult {
    return {
      success: false,
      request_id,
      error: error || 'Unknown error',
      duration_ms: Date.now() - startTime,
    };
  }
}
