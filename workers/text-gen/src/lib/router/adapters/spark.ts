/**
 * Spark Local (Nemotron) Provider Adapter
 * Routes to on-prem vLLM server via AI Gateway or direct Cloudflare Tunnel
 *
 * NOTE: Nemotron returns content in the 'reasoning' field, not 'content'.
 * This adapter handles the special response format.
 */

import type { AdapterContext, MediaOptions, TextResult, TextOptions } from '../types';
import { TextAdapter } from './base';

// AI Gateway endpoint for Spark (custom provider must be added in Cloudflare dashboard)
// Custom providers require 'custom-' prefix in the gateway URL
const GATEWAY_SPARK_URL = 'https://gateway.ai.cloudflare.com/v1/52b1c60ff2a24fb21c1ef9a429e63261/de-gateway/custom-spark-local';

// Direct Spark endpoint (via Cloudflare Tunnel)
const DIRECT_SPARK_URL = 'https://vllm.shiftaltcreate.com';

export class SparkAdapter extends TextAdapter {
  readonly providerId = 'spark-local';

  private getBaseUrl(context: AdapterContext): string {
    // Use AI Gateway if token is available
    if (context.gatewayToken) {
      return GATEWAY_SPARK_URL;
    }
    // Fall back to direct URL (context.baseUrl or default)
    return context.baseUrl || DIRECT_SPARK_URL;
  }

  private getHeaders(context: AdapterContext): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (context.gatewayToken) {
      // AI Gateway - no API key needed for Spark (local provider)
      headers['cf-aig-authorization'] = `Bearer ${context.gatewayToken}`;
    }
    // Spark doesn't require auth headers for direct access

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

    const response = await this.makeRequest(
      `${this.getBaseUrl(context)}/v1/chat/completions`,
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
          reasoning?: string;  // Nemotron returns content here
        }
      }>;
      model: string;
      usage?: { total_tokens: number };
    };

    // Nemotron returns content in 'reasoning' field, not 'content'
    const message = data.choices[0]?.message;
    const text = message?.content || message?.reasoning || '';

    return {
      text,
      provider: this.providerId,
      model: data.model || model.model_id,
      tokens_used: data.usage?.total_tokens || 0,
    };
  }

  async checkHealth(context: AdapterContext): Promise<boolean> {
    const baseUrl = this.getBaseUrl(context);

    try {
      const response = await fetch(`${baseUrl}/health`, {
        headers: context.gatewayToken ? {
          'cf-aig-authorization': `Bearer ${context.gatewayToken}`,
        } : {},
      });
      return response.ok;
    } catch {
      // Try models endpoint as fallback
      try {
        const response = await fetch(`${baseUrl}/v1/models`, {
          headers: context.gatewayToken ? {
            'cf-aig-authorization': `Bearer ${context.gatewayToken}`,
          } : {},
        });
        return response.ok;
      } catch {
        return false;
      }
    }
  }
}
