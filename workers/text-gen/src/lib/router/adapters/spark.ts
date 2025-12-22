/**
 * Spark Local (Nemotron) Provider Adapter
 * Routes to on-prem vLLM server via Cloudflare Tunnel
 */

import type { AdapterContext, MediaOptions, TextResult, TextOptions } from '../types';
import { TextAdapter } from './base';

export class SparkAdapter extends TextAdapter {
  readonly providerId = 'spark-local';

  async execute(
    prompt: string,
    options: MediaOptions,
    context: AdapterContext
  ): Promise<TextResult> {
    const textOptions = options as TextOptions;
    const { model, baseUrl } = context;

    if (!baseUrl) {
      throw new Error('Spark local URL not configured');
    }

    // Build messages array (OpenAI-compatible format)
    const messages: Array<{ role: string; content: string }> = [];

    if (textOptions.system_prompt) {
      messages.push({ role: 'system', content: textOptions.system_prompt });
    }
    messages.push({ role: 'user', content: prompt });

    const requestBody: Record<string, any> = {
      model: model.model_id,
      messages,
      max_tokens: textOptions.max_tokens || 4096,
    };

    if (textOptions.temperature !== undefined) {
      requestBody.temperature = textOptions.temperature;
    }

    if (textOptions.top_p !== undefined) {
      requestBody.top_p = textOptions.top_p;
    }

    if (textOptions.stop_sequences?.length) {
      requestBody.stop = textOptions.stop_sequences;
    }

    const response = await this.makeRequest(
      `${baseUrl}/v1/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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
      model: data.model || model.model_id,
      tokens_used: data.usage?.total_tokens || 0,
    };
  }

  async checkHealth(context: AdapterContext): Promise<boolean> {
    if (!context.baseUrl) return false;

    try {
      const response = await fetch(`${context.baseUrl}/health`);
      return response.ok;
    } catch {
      // Try models endpoint as fallback
      try {
        const response = await fetch(`${context.baseUrl}/v1/models`);
        return response.ok;
      } catch {
        return false;
      }
    }
  }
}
