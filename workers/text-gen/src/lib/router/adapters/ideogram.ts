/**
 * Ideogram Provider Adapter
 * Image generation with excellent text rendering
 */

import type { AdapterContext, MediaOptions, ImageResult, ImageOptions } from '../types';
import { ImageAdapter } from './base';

export class IdeogramAdapter extends ImageAdapter {
  readonly providerId = 'ideogram';

  async execute(
    prompt: string,
    options: MediaOptions,
    context: AdapterContext
  ): Promise<ImageResult> {
    const imageOptions = options as ImageOptions;
    const { model, apiKey } = context;

    const requestBody: Record<string, any> = {
      image_request: {
        prompt,
        model: model.model_id,
        magic_prompt_option: 'AUTO',
      },
    };

    // Map aspect ratio
    if (imageOptions.aspect_ratio) {
      requestBody.image_request.aspect_ratio = this.mapAspectRatio(
        imageOptions.aspect_ratio
      );
    }

    // Map resolution from width/height
    if (imageOptions.width && imageOptions.height) {
      requestBody.image_request.resolution = this.mapResolution(
        imageOptions.width,
        imageOptions.height
      );
    }

    // Style preset
    if (imageOptions.style) {
      requestBody.image_request.style_type = this.mapStyle(imageOptions.style);
    }

    // Negative prompt
    if (imageOptions.negative_prompt) {
      requestBody.image_request.negative_prompt = imageOptions.negative_prompt;
    }

    const response = await this.makeRequest(
      'https://api.ideogram.ai/generate',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Api-Key': apiKey,
        },
        body: JSON.stringify(requestBody),
      }
    );

    const data = (await response.json()) as {
      data: Array<{
        url: string;
        prompt: string;
        resolution: string;
        is_image_safe: boolean;
      }>;
    };

    if (!data.data || data.data.length === 0) {
      throw new Error('Ideogram returned no images');
    }

    const image = data.data[0];
    const [width, height] = image.resolution?.split('x').map(Number) || [
      1024, 1024,
    ];

    return {
      url: image.url,
      provider: this.providerId,
      model: model.model_id,
      width,
      height,
    };
  }

  private mapAspectRatio(ratio: string): string {
    const mapping: Record<string, string> = {
      '1:1': 'ASPECT_1_1',
      '16:9': 'ASPECT_16_9',
      '9:16': 'ASPECT_9_16',
      '4:3': 'ASPECT_4_3',
      '3:4': 'ASPECT_3_4',
      '3:2': 'ASPECT_3_2',
      '2:3': 'ASPECT_2_3',
    };
    return mapping[ratio] || 'ASPECT_1_1';
  }

  private mapResolution(width: number, height: number): string {
    // Ideogram has specific resolution options
    if (width === 1024 && height === 1024) return 'RESOLUTION_1024_1024';
    if (width === 1280 && height === 720) return 'RESOLUTION_1280_720';
    if (width === 720 && height === 1280) return 'RESOLUTION_720_1280';
    // Default to 1024x1024
    return 'RESOLUTION_1024_1024';
  }

  private mapStyle(style: string): string {
    const mapping: Record<string, string> = {
      general: 'GENERAL',
      realistic: 'REALISTIC',
      design: 'DESIGN',
      render_3d: 'RENDER_3D',
      anime: 'ANIME',
    };
    return mapping[style.toLowerCase()] || 'AUTO';
  }

  async checkHealth(context: AdapterContext): Promise<boolean> {
    // Ideogram doesn't have a health endpoint, check auth
    try {
      // Just verify the API key works
      const response = await fetch('https://api.ideogram.ai/manage/api/subscription', {
        method: 'GET',
        headers: {
          'Api-Key': context.apiKey,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
