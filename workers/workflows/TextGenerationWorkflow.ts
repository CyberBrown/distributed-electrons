/**
 * TextGenerationWorkflow
 *
 * Cloudflare Workflow for text generation with opportunistic runner usage.
 * Uses a waterfall approach to find the best available provider:
 *
 * 1. Claude-runner on Spark (if idle - not queued with code tasks)
 * 2. Gemini-runner on Spark (if idle)
 * 3. Nemotron on Spark (local vLLM - always available if server is up)
 * 4. z.ai API
 * 5. Anthropic API
 * 6. Gemini API
 * 7. OpenAI API
 *
 * The key insight: we opportunistically use runners for simple text tasks
 * when they're not busy with code execution, avoiding API costs.
 */

import { WorkflowEntrypoint, WorkflowStep, type WorkflowEvent } from 'cloudflare:workers';
import type {
  TextGenerationParams,
  TextGenerationResult,
  TextGenerationEnv,
  TextProvider,
  ProviderStatus,
} from './types';

// Default URLs
const DEFAULT_SPARK_VLLM_URL = 'https://vllm.shiftaltcreate.com';
const DEFAULT_CLAUDE_RUNNER_URL = 'https://claude-runner.shiftaltcreate.com';
const DEFAULT_GEMINI_RUNNER_URL = 'https://gemini.spark.distributedelectrons.com';

// Queue depth threshold - skip runners if more than this many tasks queued
const DEFAULT_QUEUE_THRESHOLD = 3;

// Provider waterfall order
const PROVIDER_WATERFALL: TextProvider[] = [
  'claude-runner',
  'gemini-runner',
  'nemotron',
  'zai',
  'anthropic',
  'gemini',
  'openai',
];

export class TextGenerationWorkflow extends WorkflowEntrypoint<TextGenerationEnv, TextGenerationParams> {
  /**
   * Main workflow execution
   */
  override async run(event: WorkflowEvent<TextGenerationParams>, step: WorkflowStep) {
    const {
      request_id,
      prompt,
      system_prompt,
      max_tokens = 4096,
      temperature = 0.7,
      callback_url,
      timeout_ms = 60000,
    } = event.payload;

    console.log(`[TextGenWorkflow] Starting for request ${request_id}`);

    const attemptedProviders: TextProvider[] = [];
    let result: TextGenerationResult | null = null;

    // Step 1: Check provider availability
    const availability = await step.do(
      'check-availability',
      {
        retries: { limit: 1, delay: '1 second', backoff: 'constant' },
        timeout: '10 seconds',
      },
      async () => {
        return this.checkProviderAvailability();
      }
    );

    console.log(`[TextGenWorkflow] Provider availability:`, JSON.stringify(availability));

    // Step 2: Try providers in waterfall order
    for (const provider of PROVIDER_WATERFALL) {
      const status = availability.find(a => a.provider === provider);

      // Skip unavailable providers
      if (!status?.available) {
        console.log(`[TextGenWorkflow] Skipping ${provider}: ${status?.reason || 'unavailable'}`);
        continue;
      }

      attemptedProviders.push(provider);
      console.log(`[TextGenWorkflow] Trying provider: ${provider}`);

      try {
        result = await step.do(
          `try-${provider}`,
          {
            retries: { limit: 1, delay: '2 seconds', backoff: 'constant' },
            timeout: `${Math.ceil(timeout_ms / 1000)} seconds`,
          },
          async () => {
            const startTime = Date.now();
            const response = await this.callProvider(provider, {
              prompt,
              system_prompt,
              max_tokens,
              temperature,
            });

            return {
              success: true,
              request_id,
              provider,
              text: response.text,
              tokens_used: response.tokens_used,
              duration_ms: Date.now() - startTime,
              attempted_providers: attemptedProviders,
            };
          }
        );

        // Success! Exit the waterfall
        console.log(`[TextGenWorkflow] Success with ${provider}`);
        break;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[TextGenWorkflow] ${provider} failed: ${errorMessage}`);
        // Continue to next provider
      }
    }

    // If all providers failed
    if (!result) {
      result = {
        success: false,
        request_id,
        provider: 'openai', // Last attempted
        error: 'All providers failed',
        duration_ms: 0,
        attempted_providers: attemptedProviders,
      };
    }

    // Step 3: Send callback if configured
    if (callback_url) {
      await step.do(
        'send-callback',
        {
          retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' },
          timeout: '30 seconds',
        },
        async () => {
          await this.sendCallback(callback_url, result!);
          return { sent: true };
        }
      );
    }

    console.log(`[TextGenWorkflow] Completed for request ${request_id}`);
    return result;
  }

  /**
   * Check availability of all providers
   * Runners are only available if they're not busy with code tasks
   */
  private async checkProviderAvailability(): Promise<ProviderStatus[]> {
    const results: ProviderStatus[] = [];
    const queueThreshold = parseInt(this.env.QUEUE_DEPTH_THRESHOLD || String(DEFAULT_QUEUE_THRESHOLD), 10);

    // Check queue depth from Nexus (for runner availability)
    let runnerQueueDepth = 0;
    if (this.env.NEXUS_API_URL) {
      try {
        const response = await fetch(`${this.env.NEXUS_API_URL}/api/queue/stats`, {
          headers: { 'Content-Type': 'application/json' },
        });
        if (response.ok) {
          const data = await response.json() as {
            by_executor?: {
              'claude-code'?: { queued?: number; claimed?: number; dispatched?: number };
            };
          };
          const codeQueue = data.by_executor?.['claude-code'];
          if (codeQueue) {
            runnerQueueDepth = (codeQueue.queued || 0) + (codeQueue.claimed || 0) + (codeQueue.dispatched || 0);
          }
        }
      } catch (error) {
        console.warn('[TextGenWorkflow] Failed to fetch queue stats:', error);
      }
    }

    console.log(`[TextGenWorkflow] Runner queue depth: ${runnerQueueDepth} (threshold: ${queueThreshold})`);

    // 1. Claude-runner - available if queue is not too deep
    const claudeRunnerUrl = this.env.CLAUDE_RUNNER_URL || DEFAULT_CLAUDE_RUNNER_URL;
    if (runnerQueueDepth < queueThreshold) {
      const claudeHealthy = await this.checkRunnerHealth(claudeRunnerUrl);
      results.push({
        provider: 'claude-runner',
        available: claudeHealthy,
        queue_depth: runnerQueueDepth,
        reason: claudeHealthy ? 'idle and healthy' : 'unhealthy or unreachable',
      });
    } else {
      results.push({
        provider: 'claude-runner',
        available: false,
        queue_depth: runnerQueueDepth,
        reason: `queue depth ${runnerQueueDepth} exceeds threshold ${queueThreshold}`,
      });
    }

    // 2. Gemini-runner - available if queue is not too deep
    const geminiRunnerUrl = this.env.GEMINI_RUNNER_URL || DEFAULT_GEMINI_RUNNER_URL;
    if (runnerQueueDepth < queueThreshold) {
      const geminiHealthy = await this.checkRunnerHealth(geminiRunnerUrl);
      results.push({
        provider: 'gemini-runner',
        available: geminiHealthy,
        queue_depth: runnerQueueDepth,
        reason: geminiHealthy ? 'idle and healthy' : 'unhealthy or unreachable',
      });
    } else {
      results.push({
        provider: 'gemini-runner',
        available: false,
        queue_depth: runnerQueueDepth,
        reason: `queue depth ${runnerQueueDepth} exceeds threshold ${queueThreshold}`,
      });
    }

    // 3. Nemotron - check if Spark vLLM is up
    const sparkUrl = this.env.SPARK_VLLM_URL || DEFAULT_SPARK_VLLM_URL;
    const nemotronHealthy = await this.checkSparkHealth(sparkUrl);
    results.push({
      provider: 'nemotron',
      available: nemotronHealthy,
      reason: nemotronHealthy ? 'healthy' : 'unreachable',
    });

    // 4. z.ai - available if API key configured
    results.push({
      provider: 'zai',
      available: !!this.env.ZAI_API_KEY,
      reason: this.env.ZAI_API_KEY ? 'API key configured' : 'no API key',
    });

    // 5. Anthropic - available if API key configured
    results.push({
      provider: 'anthropic',
      available: !!this.env.ANTHROPIC_API_KEY,
      reason: this.env.ANTHROPIC_API_KEY ? 'API key configured' : 'no API key',
    });

    // 6. Gemini API - available if API key configured
    results.push({
      provider: 'gemini',
      available: !!this.env.GEMINI_API_KEY,
      reason: this.env.GEMINI_API_KEY ? 'API key configured' : 'no API key',
    });

    // 7. OpenAI - available if API key configured
    results.push({
      provider: 'openai',
      available: !!this.env.OPENAI_API_KEY,
      reason: this.env.OPENAI_API_KEY ? 'API key configured' : 'no API key',
    });

    return results;
  }

  /**
   * Check if a runner is healthy
   */
  private async checkRunnerHealth(url: string): Promise<boolean> {
    try {
      const headers: Record<string, string> = {};

      // Add Cloudflare Access headers if configured
      if (this.env.CF_ACCESS_CLIENT_ID && this.env.CF_ACCESS_CLIENT_SECRET) {
        headers['CF-Access-Client-Id'] = this.env.CF_ACCESS_CLIENT_ID;
        headers['CF-Access-Client-Secret'] = this.env.CF_ACCESS_CLIENT_SECRET;
      }

      const response = await fetch(`${url}/health`, {
        method: 'GET',
        headers,
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Check if Spark vLLM is healthy
   */
  private async checkSparkHealth(url: string): Promise<boolean> {
    try {
      const response = await fetch(`${url}/health`);
      return response.ok;
    } catch {
      // Try models endpoint as fallback
      try {
        const response = await fetch(`${url}/v1/models`);
        return response.ok;
      } catch {
        return false;
      }
    }
  }

  /**
   * Call a specific provider
   */
  private async callProvider(
    provider: TextProvider,
    params: {
      prompt: string;
      system_prompt?: string;
      max_tokens: number;
      temperature: number;
    }
  ): Promise<{ text: string; tokens_used?: number }> {
    switch (provider) {
      case 'claude-runner':
        return this.callClaudeRunner(params);
      case 'gemini-runner':
        return this.callGeminiRunner(params);
      case 'nemotron':
        return this.callNemotron(params);
      case 'zai':
        return this.callZai(params);
      case 'anthropic':
        return this.callAnthropic(params);
      case 'gemini':
        return this.callGeminiApi(params);
      case 'openai':
        return this.callOpenAI(params);
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * Call Claude runner for text generation
   */
  private async callClaudeRunner(params: {
    prompt: string;
    system_prompt?: string;
    max_tokens: number;
    temperature: number;
  }): Promise<{ text: string; tokens_used?: number }> {
    const url = this.env.CLAUDE_RUNNER_URL || DEFAULT_CLAUDE_RUNNER_URL;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.env.RUNNER_SECRET) {
      headers['X-Runner-Secret'] = this.env.RUNNER_SECRET;
    }
    if (this.env.CF_ACCESS_CLIENT_ID && this.env.CF_ACCESS_CLIENT_SECRET) {
      headers['CF-Access-Client-Id'] = this.env.CF_ACCESS_CLIENT_ID;
      headers['CF-Access-Client-Secret'] = this.env.CF_ACCESS_CLIENT_SECRET;
    }

    // Use a simple text prompt format for runners
    const fullPrompt = params.system_prompt
      ? `${params.system_prompt}\n\n${params.prompt}`
      : params.prompt;

    const response = await fetch(`${url}/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        task: fullPrompt,
        options: { max_tokens: params.max_tokens },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Claude runner error: ${error}`);
    }

    const data = await response.json() as { success: boolean; output?: string; error?: string };
    if (!data.success) {
      throw new Error(data.error || 'Claude runner failed');
    }

    return { text: data.output || '' };
  }

  /**
   * Call Gemini runner for text generation
   */
  private async callGeminiRunner(params: {
    prompt: string;
    system_prompt?: string;
    max_tokens: number;
    temperature: number;
  }): Promise<{ text: string; tokens_used?: number }> {
    const url = this.env.GEMINI_RUNNER_URL || DEFAULT_GEMINI_RUNNER_URL;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.env.GEMINI_RUNNER_SECRET) {
      headers['X-Runner-Secret'] = this.env.GEMINI_RUNNER_SECRET;
    }
    if (this.env.CF_ACCESS_CLIENT_ID && this.env.CF_ACCESS_CLIENT_SECRET) {
      headers['CF-Access-Client-Id'] = this.env.CF_ACCESS_CLIENT_ID;
      headers['CF-Access-Client-Secret'] = this.env.CF_ACCESS_CLIENT_SECRET;
    }

    const fullPrompt = params.system_prompt
      ? `${params.system_prompt}\n\n${params.prompt}`
      : params.prompt;

    const response = await fetch(`${url}/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        task: fullPrompt,
        options: { max_tokens: params.max_tokens },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini runner error: ${error}`);
    }

    const data = await response.json() as { success: boolean; output?: string; error?: string };
    if (!data.success) {
      throw new Error(data.error || 'Gemini runner failed');
    }

    return { text: data.output || '' };
  }

  /**
   * Call Nemotron on Spark via vLLM
   */
  private async callNemotron(params: {
    prompt: string;
    system_prompt?: string;
    max_tokens: number;
    temperature: number;
  }): Promise<{ text: string; tokens_used?: number }> {
    const url = this.env.SPARK_VLLM_URL || DEFAULT_SPARK_VLLM_URL;

    const messages: Array<{ role: string; content: string }> = [];
    if (params.system_prompt) {
      messages.push({ role: 'system', content: params.system_prompt });
    }
    messages.push({ role: 'user', content: params.prompt });

    const response = await fetch(`${url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'nvidia/Llama-3.1-Nemotron-70B-Instruct-HF',
        messages,
        max_tokens: params.max_tokens,
        temperature: params.temperature,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Nemotron error: ${error}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content?: string; reasoning?: string } }>;
      usage?: { total_tokens: number };
    };

    // Nemotron sometimes returns content in 'reasoning' field
    const message = data.choices[0]?.message;
    const text = message?.content || message?.reasoning || '';

    return {
      text,
      tokens_used: data.usage?.total_tokens,
    };
  }

  /**
   * Call z.ai API
   */
  private async callZai(params: {
    prompt: string;
    system_prompt?: string;
    max_tokens: number;
    temperature: number;
  }): Promise<{ text: string; tokens_used?: number }> {
    const messages: Array<{ role: string; content: string }> = [];
    if (params.system_prompt) {
      messages.push({ role: 'system', content: params.system_prompt });
    }
    messages.push({ role: 'user', content: params.prompt });

    const response = await fetch('https://api.z.ai/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.env.ZAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-reasoner',
        messages,
        max_tokens: params.max_tokens,
        temperature: params.temperature,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`z.ai error: ${error}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content?: string; reasoning_content?: string } }>;
      usage?: { total_tokens: number };
    };

    const message = data.choices[0]?.message;
    const text = message?.content || message?.reasoning_content || '';

    return {
      text,
      tokens_used: data.usage?.total_tokens,
    };
  }

  /**
   * Call Anthropic API
   */
  private async callAnthropic(params: {
    prompt: string;
    system_prompt?: string;
    max_tokens: number;
    temperature: number;
  }): Promise<{ text: string; tokens_used?: number }> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: params.max_tokens,
        system: params.system_prompt,
        messages: [{ role: 'user', content: params.prompt }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic error: ${error}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };

    const text = data.content.find(c => c.type === 'text')?.text || '';

    return {
      text,
      tokens_used: data.usage ? data.usage.input_tokens + data.usage.output_tokens : undefined,
    };
  }

  /**
   * Call Gemini API
   */
  private async callGeminiApi(params: {
    prompt: string;
    system_prompt?: string;
    max_tokens: number;
    temperature: number;
  }): Promise<{ text: string; tokens_used?: number }> {
    const fullPrompt = params.system_prompt
      ? `${params.system_prompt}\n\n${params.prompt}`
      : params.prompt;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: {
            maxOutputTokens: params.max_tokens,
            temperature: params.temperature,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${error}`);
    }

    const data = await response.json() as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      usageMetadata?: { totalTokenCount: number };
    };

    const text = data.candidates[0]?.content?.parts[0]?.text || '';

    return {
      text,
      tokens_used: data.usageMetadata?.totalTokenCount,
    };
  }

  /**
   * Call OpenAI API
   */
  private async callOpenAI(params: {
    prompt: string;
    system_prompt?: string;
    max_tokens: number;
    temperature: number;
  }): Promise<{ text: string; tokens_used?: number }> {
    const messages: Array<{ role: string; content: string }> = [];
    if (params.system_prompt) {
      messages.push({ role: 'system', content: params.system_prompt });
    }
    messages.push({ role: 'user', content: params.prompt });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        max_tokens: params.max_tokens,
        temperature: params.temperature,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI error: ${error}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      usage?: { total_tokens: number };
    };

    return {
      text: data.choices[0]?.message?.content || '',
      tokens_used: data.usage?.total_tokens,
    };
  }

  /**
   * Send callback with result
   */
  private async sendCallback(callbackUrl: string, result: TextGenerationResult): Promise<void> {
    const response = await fetch(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_id: result.request_id,
        success: result.success,
        provider: result.provider,
        text: result.text,
        error: result.error,
        tokens_used: result.tokens_used,
        duration_ms: result.duration_ms,
        attempted_providers: result.attempted_providers,
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Callback failed: ${error}`);
    }
  }
}
