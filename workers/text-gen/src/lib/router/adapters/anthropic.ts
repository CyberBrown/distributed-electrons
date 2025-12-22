/**
 * Anthropic Provider Adapter
 */

import type { AdapterContext, MediaOptions, TextResult, TextOptions } from '../types';
import { TextAdapter } from './base';

export class AnthropicAdapter extends TextAdapter {
  readonly providerId = 'anthropic';

  async execute(
    prompt: string,
    options: MediaOptions,
    context: AdapterContext
  ): Promise<TextResult> {
    const textOptions = options as TextOptions;
    const { model, apiKey } = context;

    const requestBody: Record<string, any> = {
      model: model.model_id,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: textOptions.max_tokens || 4096,
    };

    if (textOptions.system_prompt) {
      requestBody.system = textOptions.system_prompt;
    }

    if (textOptions.temperature !== undefined) {
      requestBody.temperature = textOptions.temperature;
    }

    if (textOptions.top_p !== undefined) {
      requestBody.top_p = textOptions.top_p;
    }

    if (textOptions.stop_sequences?.length) {
      requestBody.stop_sequences = textOptions.stop_sequences;
    }

    const response = await this.makeRequest(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(requestBody),
      }
    );

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
      model: string;
      usage?: { input_tokens: number; output_tokens: number };
    };

    const textContent = data.content.find((c) => c.type === 'text');

    return {
      text: textContent?.text || '',
      provider: this.providerId,
      model: data.model,
      tokens_used:
        (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    };
  }

  async checkHealth(context: AdapterContext): Promise<boolean> {
    try {
      // Anthropic doesn't have a simple health endpoint, so we just check auth
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': context.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1,
        }),
      });

      // 200 = working, 400 = auth working but bad request, 401/403 = auth failed
      return response.ok || response.status === 400;
    } catch {
      return false;
    }
  }
}
