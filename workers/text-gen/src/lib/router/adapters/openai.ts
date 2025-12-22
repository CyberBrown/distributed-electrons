/**
 * OpenAI Provider Adapter
 */

import type {
  AdapterContext,
  MediaOptions,
  TextResult,
  ImageResult,
  AudioResult,
  TextOptions,
  ImageOptions,
  AudioOptions,
} from '../types';
import { BaseAdapter } from './base';

export class OpenAIAdapter extends BaseAdapter {
  readonly providerId = 'openai';
  readonly supportedWorkers = ['text-gen', 'image-gen', 'audio-gen', 'embedding-gen'];

  async execute(
    prompt: string,
    options: MediaOptions,
    context: AdapterContext
  ): Promise<TextResult | ImageResult | AudioResult> {
    switch (context.provider.id) {
      case 'openai':
        if (context.model.worker_id === 'text-gen') {
          return this.generateText(prompt, options as TextOptions, context);
        }
        if (context.model.worker_id === 'image-gen') {
          return this.generateImage(prompt, options as ImageOptions, context);
        }
        if (context.model.worker_id === 'audio-gen') {
          return this.generateAudio(prompt, options as AudioOptions, context);
        }
        throw new Error(`Unsupported worker: ${context.model.worker_id}`);
      default:
        throw new Error(`Unsupported provider: ${context.provider.id}`);
    }
  }

  private async generateText(
    prompt: string,
    options: TextOptions,
    context: AdapterContext
  ): Promise<TextResult> {
    const { model, apiKey } = context;

    const messages: Array<{ role: string; content: string }> = [];

    if (options.system_prompt) {
      messages.push({ role: 'system', content: options.system_prompt });
    }
    messages.push({ role: 'user', content: prompt });

    const requestBody: Record<string, any> = {
      model: model.model_id,
      messages,
      max_tokens: options.max_tokens || 4096,
    };

    if (options.temperature !== undefined) {
      requestBody.temperature = options.temperature;
    }

    if (options.top_p !== undefined) {
      requestBody.top_p = options.top_p;
    }

    if (options.stop_sequences?.length) {
      requestBody.stop = options.stop_sequences;
    }

    const response = await this.makeRequest(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      }
    );

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      model: string;
      usage?: { total_tokens: number };
    };

    return {
      text: data.choices[0].message.content,
      provider: this.providerId,
      model: data.model,
      tokens_used: data.usage?.total_tokens || 0,
    };
  }

  private async generateImage(
    prompt: string,
    options: ImageOptions,
    context: AdapterContext
  ): Promise<ImageResult> {
    const { model, apiKey } = context;

    const requestBody: Record<string, any> = {
      model: model.model_id,
      prompt,
      n: options.num_images || 1,
      response_format: 'url',
    };

    // DALL-E 3 specific options
    if (model.model_id === 'dall-e-3') {
      requestBody.size = this.mapSize(options);
      requestBody.quality = options.style === 'hd' ? 'hd' : 'standard';
    }

    const response = await this.makeRequest(
      'https://api.openai.com/v1/images/generations',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      }
    );

    const data = (await response.json()) as {
      data: Array<{ url: string; revised_prompt?: string }>;
    };

    return {
      url: data.data[0].url,
      provider: this.providerId,
      model: model.model_id,
    };
  }

  private async generateAudio(
    prompt: string,
    options: AudioOptions,
    context: AdapterContext
  ): Promise<AudioResult> {
    const { model, apiKey } = context;

    const requestBody: Record<string, any> = {
      model: model.model_id,
      input: prompt,
      voice: options.voice_id || 'alloy',
      response_format: options.output_format || 'mp3',
    };

    if (options.speed !== undefined) {
      requestBody.speed = options.speed;
    }

    const response = await this.makeRequest(
      'https://api.openai.com/v1/audio/speech',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      }
    );

    // Response is audio data, convert to base64
    const audioBuffer = await response.arrayBuffer();
    const base64 = btoa(
      String.fromCharCode(...new Uint8Array(audioBuffer))
    );

    return {
      base64,
      provider: this.providerId,
      model: model.model_id,
    };
  }

  private mapSize(options: ImageOptions): string {
    if (options.aspect_ratio === '16:9' || options.width === 1792) {
      return '1792x1024';
    }
    if (options.aspect_ratio === '9:16' || options.height === 1792) {
      return '1024x1792';
    }
    return '1024x1024';
  }
}
