/**
 * Replicate Provider Adapter
 * For FLUX, video models, and other community models
 * Routes through AI Gateway when available
 */

import type {
  AdapterContext,
  MediaOptions,
  ImageResult,
  VideoResult,
  ImageOptions,
  VideoOptions,
} from '../types';
import { BaseAdapter } from './base';

// AI Gateway endpoint for Replicate
const GATEWAY_REPLICATE_URL = 'https://gateway.ai.cloudflare.com/v1/52b1c60ff2a24fb21c1ef9a429e63261/de-gateway/replicate';

export class ReplicateAdapter extends BaseAdapter {
  readonly providerId = 'replicate';
  readonly supportedWorkers = ['image-gen', 'video-gen'];

  private getBaseUrl(context: AdapterContext): string {
    // Use AI Gateway if token is available
    if (context.gatewayToken) {
      return GATEWAY_REPLICATE_URL;
    }
    // Fall back to direct API
    return 'https://api.replicate.com';
  }

  private getHeaders(context: AdapterContext): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (context.gatewayToken) {
      // AI Gateway handles the API key via BYOK
      headers['cf-aig-authorization'] = `Bearer ${context.gatewayToken}`;
    } else {
      // Direct API call
      headers['Authorization'] = `Bearer ${context.apiKey}`;
    }

    return headers;
  }

  async execute(
    prompt: string,
    options: MediaOptions,
    context: AdapterContext
  ): Promise<ImageResult | VideoResult> {
    if (context.model.worker_id === 'image-gen') {
      return this.generateImage(prompt, options as ImageOptions, context);
    }
    if (context.model.worker_id === 'video-gen') {
      return this.generateVideo(prompt, options as VideoOptions, context);
    }
    throw new Error(`Unsupported worker: ${context.model.worker_id}`);
  }

  private async generateImage(
    prompt: string,
    options: ImageOptions,
    context: AdapterContext
  ): Promise<ImageResult> {
    const { model } = context;

    // Replicate uses versioned model IDs
    const input: Record<string, any> = {
      prompt,
    };

    // FLUX specific options
    if (model.model_id.includes('flux')) {
      if (options.aspect_ratio) {
        input.aspect_ratio = options.aspect_ratio;
      }
      if (options.num_images) {
        input.num_outputs = options.num_images;
      }
      input.output_format = 'webp';
      input.output_quality = 90;
    }

    // Create prediction
    const response = await this.makeRequest(
      `${this.getBaseUrl(context)}/v1/predictions`,
      {
        method: 'POST',
        headers: this.getHeaders(context),
        body: JSON.stringify({
          model: model.model_id,
          input,
        }),
      }
    );

    const prediction = (await response.json()) as {
      id: string;
      status: string;
      output?: string | string[];
      urls: { get: string };
    };

    // Poll for completion
    const result = await this.pollPrediction(prediction.urls.get, context);

    const outputUrl = Array.isArray(result.output)
      ? result.output[0]
      : result.output;

    return {
      url: outputUrl,
      provider: this.providerId,
      model: model.model_id,
    };
  }

  private async generateVideo(
    prompt: string,
    options: VideoOptions,
    context: AdapterContext
  ): Promise<VideoResult> {
    const { model } = context;

    const input: Record<string, any> = {
      prompt,
    };

    if (options.duration) {
      input.duration = options.duration;
    }

    if (options.aspect_ratio) {
      input.aspect_ratio = options.aspect_ratio;
    }

    // Create prediction
    const response = await this.makeRequest(
      `${this.getBaseUrl(context)}/v1/predictions`,
      {
        method: 'POST',
        headers: this.getHeaders(context),
        body: JSON.stringify({
          model: model.model_id,
          input,
        }),
      }
    );

    const prediction = (await response.json()) as {
      id: string;
      status: string;
      output?: string;
      urls: { get: string };
    };

    // Poll for completion (videos take longer)
    const result = await this.pollPrediction(
      prediction.urls.get,
      context,
      300000 // 5 minute timeout for video
    );

    return {
      url: result.output as string,
      provider: this.providerId,
      model: model.model_id,
      duration_ms: (options.duration || 4) * 1000,
    };
  }

  private async pollPrediction(
    url: string,
    context: AdapterContext,
    timeout: number = 60000
  ): Promise<{ output: string | string[]; status: string }> {
    const startTime = Date.now();

    // Build headers for polling
    const headers: Record<string, string> = {};
    if (context.gatewayToken) {
      headers['cf-aig-authorization'] = `Bearer ${context.gatewayToken}`;
    } else {
      headers['Authorization'] = `Bearer ${context.apiKey}`;
    }

    while (Date.now() - startTime < timeout) {
      const response = await fetch(url, { headers });

      const data = (await response.json()) as {
        status: string;
        output?: string | string[];
        error?: string;
      };

      if (data.status === 'succeeded') {
        return { output: data.output!, status: data.status };
      }

      if (data.status === 'failed') {
        throw new Error(`Replicate prediction failed: ${data.error}`);
      }

      if (data.status === 'canceled') {
        throw new Error('Replicate prediction was canceled');
      }

      // Wait before polling again
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error('Replicate prediction timed out');
  }

  async checkHealth(context: AdapterContext): Promise<boolean> {
    try {
      const headers: Record<string, string> = {};
      if (context.gatewayToken) {
        headers['cf-aig-authorization'] = `Bearer ${context.gatewayToken}`;
      } else {
        headers['Authorization'] = `Bearer ${context.apiKey}`;
      }

      const response = await fetch(`${this.getBaseUrl(context)}/v1/account`, {
        headers,
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
