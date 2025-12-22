/**
 * Replicate Provider Adapter
 * For FLUX, video models, and other community models
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

export class ReplicateAdapter extends BaseAdapter {
  readonly providerId = 'replicate';
  readonly supportedWorkers = ['image-gen', 'video-gen'];

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
    const { model, apiKey } = context;

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
      'https://api.replicate.com/v1/predictions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
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
    const result = await this.pollPrediction(prediction.urls.get, apiKey);

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
    const { model, apiKey } = context;

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
      'https://api.replicate.com/v1/predictions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
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
      apiKey,
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
    apiKey: string,
    timeout: number = 60000
  ): Promise<{ output: string | string[]; status: string }> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

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
      const response = await fetch('https://api.replicate.com/v1/account', {
        headers: {
          Authorization: `Bearer ${context.apiKey}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
