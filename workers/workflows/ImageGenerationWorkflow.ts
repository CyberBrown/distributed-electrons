/**
 * ImageGenerationWorkflow
 *
 * Cloudflare Workflow for durable image generation.
 * Wraps the image-gen worker with:
 * - Validation and early error detection
 * - Provider fallback (Ideogram → DALL-E → Stability)
 * - Automatic retries with exponential backoff
 * - R2 storage for generated images
 * - Callback notifications
 *
 * Steps:
 * 1. validate-request: Validate prompt and parameters
 * 2. generate-image: Call image provider with fallback
 * 3. store-image: Upload to R2 (if not already done by provider)
 * 4. send-callback: Notify caller of result
 */

import { WorkflowEntrypoint, WorkflowStep, type WorkflowEvent } from 'cloudflare:workers';
import type { NexusEnv } from './types';

// Default image-gen worker URL
const DEFAULT_IMAGE_GEN_URL = 'https://image-gen.solamp.workers.dev';

export interface ImageGenerationParams {
  /** Unique request identifier */
  request_id: string;

  /** The prompt describing the image to generate */
  prompt: string;

  /** Model ID (e.g., 'ideogram-v2', 'dall-e-3') */
  model_id?: string;

  /** Generation options */
  options?: {
    aspect_ratio?: string;
    style?: string;
    negative_prompt?: string;
    seed?: number;
  };

  /** Optional callback URL for completion notification */
  callback_url?: string;

  /** Execution timeout in milliseconds (default: 120000 = 2 minutes) */
  timeout_ms?: number;
}

export interface ImageGenerationResult {
  success: boolean;
  request_id: string;
  image_url?: string;
  r2_path?: string;
  provider?: string;
  model?: string;
  error?: string;
  duration_ms: number;
}

interface ImageGenEnv extends NexusEnv {
  IMAGE_GEN_URL?: string;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

export class ImageGenerationWorkflow extends WorkflowEntrypoint<ImageGenEnv, ImageGenerationParams> {
  /**
   * Main workflow execution
   */
  override async run(event: WorkflowEvent<ImageGenerationParams>, step: WorkflowStep) {
    const {
      request_id,
      prompt,
      model_id,
      options,
      callback_url,
      timeout_ms = 120000, // 2 minutes default
    } = event.payload;

    const startTime = Date.now();

    console.log(`[ImageGenerationWorkflow] Starting for request ${request_id}`);
    console.log(`[ImageGenerationWorkflow] Prompt: ${prompt.substring(0, 100)}...`);

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
      console.error(`[ImageGenerationWorkflow] Validation failed: ${validation.error}`);
      return this.createErrorResult(request_id, validation.error, startTime);
    }

    // Step 2: Generate image via image-gen worker
    let result: ImageGenerationResult;
    try {
      result = await step.do(
        'generate-image',
        {
          retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' },
          timeout: `${Math.ceil(timeout_ms / 1000)} seconds`,
        },
        async () => {
          return this.generateImage(request_id, prompt, model_id, options);
        }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[ImageGenerationWorkflow] Generation failed: ${errorMessage}`);
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
        console.log(`[ImageGenerationWorkflow] Completed request ${request_id}`);
        console.log(`[ImageGenerationWorkflow] Result: success=${result.success}, provider=${result.provider}`);
        return { logged: true };
      }
    );

    return result;
  }

  /**
   * Validate request parameters
   */
  private validateRequest(params: ImageGenerationParams): ValidationResult {
    if (!params.request_id) {
      return { valid: false, error: 'Missing request_id' };
    }

    if (!params.prompt || params.prompt.trim() === '') {
      return { valid: false, error: 'Missing or empty prompt' };
    }

    if (params.prompt.length > 10000) {
      return { valid: false, error: 'Prompt exceeds maximum length of 10000 characters' };
    }

    return { valid: true };
  }

  /**
   * Generate image via image-gen worker
   */
  private async generateImage(
    request_id: string,
    prompt: string,
    model_id?: string,
    options?: ImageGenerationParams['options']
  ): Promise<ImageGenerationResult> {
    const imageGenUrl = this.env.IMAGE_GEN_URL || DEFAULT_IMAGE_GEN_URL;
    const startTime = Date.now();

    console.log(`[ImageGenerationWorkflow] Calling image-gen at ${imageGenUrl}/generate`);

    const response = await fetch(`${imageGenUrl}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        model_id: model_id || 'ideogram-v2',
        options: options || {},
      }),
    });

    const result = await response.json() as {
      success: boolean;
      image_url?: string;
      r2_path?: string;
      metadata?: {
        provider?: string;
        model?: string;
      };
      error?: string;
    };

    if (!result.success) {
      throw new Error(result.error || 'Image generation failed');
    }

    return {
      success: true,
      request_id,
      image_url: result.image_url,
      r2_path: result.r2_path,
      provider: result.metadata?.provider,
      model: result.metadata?.model,
      duration_ms: Date.now() - startTime,
    };
  }

  /**
   * Send callback to caller with result
   */
  private async sendCallback(
    callbackUrl: string,
    result: ImageGenerationResult
  ): Promise<void> {
    console.log(`[ImageGenerationWorkflow] Sending callback to ${callbackUrl}`);

    const response = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Passphrase': this.env.NEXUS_PASSPHRASE || '',
      },
      body: JSON.stringify({
        request_id: result.request_id,
        status: result.success ? 'completed' : 'failed',
        content_type: 'image_url',
        content: result.image_url,
        provider: result.provider,
        model: result.model,
        error: result.error,
        duration_ms: result.duration_ms,
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ImageGenerationWorkflow] Callback failed (${response.status}): ${errorText}`);
      throw new Error(`Callback failed: ${response.status}`);
    }

    console.log('[ImageGenerationWorkflow] Callback sent successfully');
  }

  /**
   * Create error result
   */
  private createErrorResult(
    request_id: string,
    error: string | undefined,
    startTime: number
  ): ImageGenerationResult {
    return {
      success: false,
      request_id,
      error: error || 'Unknown error',
      duration_ms: Date.now() - startTime,
    };
  }
}
