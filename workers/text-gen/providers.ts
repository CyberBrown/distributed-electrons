/**
 * Provider implementations for Text Generation Worker
 * Handles communication with OpenAI, Anthropic, and other LLM providers
 */

import type { TextGenerationResult, GenerateOptions, ModelConfig, PromptTemplate } from './types';

/**
 * Apply prompt template to user input
 */
function applyPromptTemplate(
  userPrompt: string,
  options: GenerateOptions,
  template?: PromptTemplate
): { systemPrompt?: string; userMessage: string; temperature: number; maxTokens: number } {
  // Default values
  let systemPrompt = options.system_prompt;
  let userMessage = userPrompt;
  let temperature = options.temperature ?? 0.7;
  let maxTokens = options.max_tokens ?? 1000;

  // Apply template if provided
  if (template) {
    // Use template system prompt if no override provided
    if (!systemPrompt && template.system_prompt) {
      systemPrompt = template.system_prompt;
    }

    // Wrap user prompt if template specifies
    if (template.user_prompt_wrapper) {
      userMessage = template.user_prompt_wrapper.replace('{user_prompt}', userPrompt);
    }

    // Use template defaults if not overridden
    if (options.temperature === undefined && template.default_temperature !== undefined) {
      temperature = template.default_temperature;
    }

    if (options.max_tokens === undefined && template.default_max_tokens !== undefined) {
      maxTokens = template.default_max_tokens;
    }
  }

  return { systemPrompt, userMessage, temperature, maxTokens };
}

/**
 * Generate text using OpenAI
 */
export async function generateWithOpenAI(
  model: string,
  prompt: string,
  options: GenerateOptions,
  apiKey: string,
  modelConfig?: ModelConfig
): Promise<TextGenerationResult> {
  const { systemPrompt, userMessage, temperature, maxTokens } = applyPromptTemplate(
    prompt,
    options,
    modelConfig?.prompt_template
  );

  const messages: Array<{ role: string; content: string }> = [];

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: userMessage });

  const requestBody: Record<string, any> = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
  };

  if (options.top_p !== undefined) {
    requestBody.top_p = options.top_p;
  }

  if (options.stop_sequences?.length) {
    requestBody.stop = options.stop_sequences;
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${error}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
    model: string;
    usage?: { total_tokens: number };
  };

  return {
    text: data.choices[0].message.content,
    provider: 'openai',
    model: data.model,
    tokens_used: data.usage?.total_tokens || 0,
  };
}

/**
 * Generate text using Anthropic
 */
export async function generateWithAnthropic(
  model: string,
  prompt: string,
  options: GenerateOptions,
  apiKey: string,
  modelConfig?: ModelConfig
): Promise<TextGenerationResult> {
  const { systemPrompt, userMessage, temperature, maxTokens } = applyPromptTemplate(
    prompt,
    options,
    modelConfig?.prompt_template
  );

  const requestBody: Record<string, any> = {
    model,
    messages: [{ role: 'user', content: userMessage }],
    max_tokens: maxTokens,
    temperature,
  };

  if (systemPrompt) {
    requestBody.system = systemPrompt;
  }

  if (options.stop_sequences?.length) {
    requestBody.stop_sequences = options.stop_sequences;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${error}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    model: string;
    usage?: { input_tokens: number; output_tokens: number };
  };

  const textContent = data.content.find(c => c.type === 'text');

  return {
    text: textContent?.text || '',
    provider: 'anthropic',
    model: data.model,
    tokens_used: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
  };
}

/**
 * Generate text using the specified provider
 */
export async function generateText(
  provider: string,
  model: string,
  prompt: string,
  options: GenerateOptions,
  apiKey: string,
  modelConfig?: ModelConfig
): Promise<TextGenerationResult> {
  switch (provider.toLowerCase()) {
    case 'openai':
      return await generateWithOpenAI(model, prompt, options, apiKey, modelConfig);
    case 'anthropic':
      return await generateWithAnthropic(model, prompt, options, apiKey, modelConfig);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

/**
 * Get default model for a provider
 */
export function getDefaultModel(provider: string): string {
  const defaults: Record<string, string> = {
    openai: 'gpt-4o-mini',
    anthropic: 'claude-3-5-sonnet-20241022',
  };
  return defaults[provider.toLowerCase()] || 'gpt-4o-mini';
}

/**
 * Extract provider from model ID
 * Format: "provider:model" or just "model" (defaults to openai)
 */
export function extractProvider(modelId: string, defaultProvider: string): { provider: string; model: string } {
  if (modelId.includes(':')) {
    const [provider, model] = modelId.split(':');
    return { provider, model };
  }

  // Try to infer provider from model name
  if (modelId.startsWith('gpt-') || modelId.startsWith('o1') || modelId.startsWith('davinci')) {
    return { provider: 'openai', model: modelId };
  }

  if (modelId.startsWith('claude-')) {
    return { provider: 'anthropic', model: modelId };
  }

  // Default provider
  return { provider: defaultProvider, model: modelId };
}
