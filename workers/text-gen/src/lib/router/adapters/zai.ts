/**
 * z.ai Provider Adapter (PRIMARY LLM — GLM-4.7)
 * Routes through AI Gateway as custom provider (slug: custom-zai)
 * Uses OpenAI-compatible API format
 */

import type { AdapterContext, MediaOptions, TextResult, TextOptions } from '../types';
import { TextAdapter } from './base';

export class ZaiAdapter extends TextAdapter {
  readonly providerId = 'zai';

  private getBaseUrl(context: AdapterContext): string {
    if (context.gatewayToken) {
      // Route through AI Gateway (BYOK handles auth)
      return `${context.gatewayUrl}/custom-zai/api/paas`;
    }
    return 'https://api.z.ai/api/paas';
  }

  private getHeaders(context: AdapterContext): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (context.gatewayToken) {
      headers['cf-aig-authorization'] = `Bearer ${context.gatewayToken}`;
    } else {
      headers['Authorization'] = `Bearer ${context.apiKey}`;
    }
    return headers;
  }

  async execute(
    prompt: string,
    options: MediaOptions,
    context: AdapterContext
  ): Promise<TextResult> {
    const textOptions = options as TextOptions;
    const { model } = context;

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

    // z.ai uses /v4 API version (not /v1)
    const response = await this.makeRequest(
      `${this.getBaseUrl(context)}/v4/chat/completions`,
      {
        method: 'POST',
        headers: this.getHeaders(context),
        body: JSON.stringify(requestBody),
      }
    );

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          content?: string;
          reasoning_content?: string;  // z.ai returns content here
        }
      }>;
      model: string;
      usage?: { total_tokens: number };
    };

    // z.ai returns content in 'reasoning_content' field
    const message = data.choices[0]?.message;
    const text = message?.content || message?.reasoning_content || '';

    return {
      text,
      provider: this.providerId,
      model: data.model || model.model_id,
      tokens_used: data.usage?.total_tokens || 0,
    };
  }

  async checkHealth(context: AdapterContext): Promise<boolean> {
    try {
      const response = await fetch(`${this.getBaseUrl(context)}/v4/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${context.apiKey}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
