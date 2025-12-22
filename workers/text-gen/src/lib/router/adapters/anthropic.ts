/**
 * Anthropic Provider Adapter
 * Routes through AI Gateway when available
 */

import type { AdapterContext, MediaOptions, TextResult, TextOptions } from '../types';
import { TextAdapter } from './base';

// AI Gateway endpoint for Anthropic
const GATEWAY_ANTHROPIC_URL = 'https://gateway.ai.cloudflare.com/v1/52b1c60ff2a24fb21c1ef9a429e63261/de-gateway/anthropic';

export class AnthropicAdapter extends TextAdapter {
  readonly providerId = 'anthropic';

  private getEndpoint(context: AdapterContext): string {
    // Use AI Gateway if token is available
    if (context.gatewayToken) {
      return `${GATEWAY_ANTHROPIC_URL}/v1/messages`;
    }
    // Fall back to direct API
    return 'https://api.anthropic.com/v1/messages';
  }

  private getHeaders(context: AdapterContext): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };

    if (context.gatewayToken) {
      // AI Gateway handles the API key via BYOK
      headers['cf-aig-authorization'] = `Bearer ${context.gatewayToken}`;
    } else {
      // Direct API call
      headers['x-api-key'] = context.apiKey;
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
      this.getEndpoint(context),
      {
        method: 'POST',
        headers: this.getHeaders(context),
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
      const response = await fetch(this.getEndpoint(context), {
        method: 'POST',
        headers: this.getHeaders(context),
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
