/**
 * Spark Local Provider
 * Proxies requests to on-prem LLM running on Spark server
 * Uses same API format as OpenAI for compatibility
 */

import type { TextResult, GenerateOptions } from './types';

/**
 * Generate text using Spark local LLM
 * The Spark server exposes an OpenAI-compatible API
 */
export async function generateWithSparkLocal(
  model: string,
  prompt: string,
  options: GenerateOptions,
  baseUrl: string,
  apiKey?: string
): Promise<TextResult> {
  // Spark local uses OpenAI-compatible API
  const endpoint = `${baseUrl}/v1/chat/completions`;

  const requestBody: Record<string, any> = {
    model: model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: options.max_tokens || 1000,
    temperature: options.temperature || 0.7,
  };

  if (options.system_prompt) {
    requestBody.messages.unshift({ role: 'system', content: options.system_prompt });
  }

  if (options.top_p !== undefined) {
    requestBody.top_p = options.top_p;
  }

  if (options.stop_sequences?.length) {
    requestBody.stop = options.stop_sequences;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add auth if API key provided
  if (apiKey && apiKey !== 'local') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  console.log(`Calling Spark local at ${endpoint}`);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Spark Local API error (${response.status}): ${error}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
    model: string;
    usage?: { total_tokens: number };
  };

  return {
    text: data.choices[0].message.content,
    provider: 'spark-local',
    model: data.model || model,
    tokens_used: data.usage?.total_tokens || 0,
  };
}

/**
 * Stream text generation using Spark local LLM
 */
export async function streamWithSparkLocal(
  model: string,
  prompt: string,
  options: GenerateOptions,
  baseUrl: string,
  apiKey: string | undefined,
  requestId: string
): Promise<ReadableStream> {
  const endpoint = `${baseUrl}/v1/chat/completions`;

  const requestBody: Record<string, any> = {
    model: model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: options.max_tokens || 1000,
    temperature: options.temperature || 0.7,
    stream: true,
  };

  if (options.system_prompt) {
    requestBody.messages.unshift({ role: 'system', content: options.system_prompt });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey && apiKey !== 'local') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Spark Local API error (${response.status}): ${error}`);
  }

  if (!response.body) {
    throw new Error('No response body from Spark Local');
  }

  // Use OpenAI-style stream transformation (since Spark uses OpenAI format)
  return transformOpenAICompatibleStream(response.body, requestId);
}

/**
 * Transform OpenAI-compatible SSE stream to our standardized format
 */
function transformOpenAICompatibleStream(
  inputStream: ReadableStream,
  requestId: string
): ReadableStream {
  const reader = inputStream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';

  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();

        if (done) {
          const doneEvent = `data: ${JSON.stringify({ text: '', done: true, request_id: requestId })}\n\n`;
          controller.enqueue(encoder.encode(doneEvent));
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();

            if (data === '[DONE]') {
              const doneEvent = `data: ${JSON.stringify({ text: '', done: true, request_id: requestId })}\n\n`;
              controller.enqueue(encoder.encode(doneEvent));
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;

              if (content) {
                const event = `data: ${JSON.stringify({ text: content, done: false, request_id: requestId })}\n\n`;
                controller.enqueue(encoder.encode(event));
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      } catch (error) {
        const errorEvent = `data: ${JSON.stringify({ error: 'Stream error', done: true, request_id: requestId })}\n\n`;
        controller.enqueue(encoder.encode(errorEvent));
        controller.close();
      }
    },
    cancel() {
      reader.cancel();
    },
  });
}

/**
 * Check if Spark local is available
 */
export async function checkSparkHealth(baseUrl: string): Promise<boolean> {
  if (!baseUrl) return false;

  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: 'GET',
    });
    return response.ok;
  } catch {
    return false;
  }
}
