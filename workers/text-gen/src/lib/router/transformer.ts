/**
 * DE Router Prompt Transformers
 * Provider-specific prompt transformation
 */

import type { PromptTransformer, TransformContext } from './types';

/**
 * Anthropic Transformer
 * - Uses XML tags for structured prompts
 * - Explicit chain-of-thought for reasoning
 */
export class AnthropicTransformer implements PromptTransformer {
  readonly providerId = 'anthropic';

  transform(prompt: string, context: TransformContext): string {
    // Add XML structure for complex tasks
    if (
      context.capabilities_needed?.includes('reasoning') ||
      context.capabilities_needed?.includes('analysis')
    ) {
      return `<task>\n${prompt}\n</task>\n\nThink through this step-by-step before providing your answer.`;
    }

    // Code tasks benefit from explicit formatting
    if (context.capabilities_needed?.includes('code')) {
      return `${prompt}\n\nProvide clean, well-documented code with explanations.`;
    }

    return prompt;
  }

  getSystemPrompt(context: TransformContext): string | null {
    if (context.worker !== 'text-gen') return null;

    if (context.task_type === 'code') {
      return 'You are an expert programmer. Write clean, well-documented, production-ready code.';
    }

    if (context.task_type === 'analysis') {
      return 'You are a thoughtful analyst. Provide thorough, well-reasoned analysis with clear conclusions.';
    }

    return null;
  }
}

/**
 * OpenAI Transformer
 * - More direct prompting style
 * - JSON mode hints when needed
 */
export class OpenAITransformer implements PromptTransformer {
  readonly providerId = 'openai';

  transform(prompt: string, context: TransformContext): string {
    // OpenAI tends to be more direct
    if (context.capabilities_needed?.includes('reasoning')) {
      return `${prompt}\n\nPlease think through this carefully and explain your reasoning.`;
    }

    return prompt;
  }

  getSystemPrompt(context: TransformContext): string | null {
    if (context.worker !== 'text-gen') return null;

    if (context.task_type === 'code') {
      return 'You are a skilled software engineer. Write clean, efficient, well-tested code.';
    }

    return null;
  }
}

/**
 * Spark/Nemotron Transformer
 * - Local model, may need more explicit instructions
 */
export class SparkTransformer implements PromptTransformer {
  readonly providerId = 'spark-local';

  transform(prompt: string, context: TransformContext): string {
    // Local models sometimes benefit from more explicit prompts
    if (context.capabilities_needed?.includes('code')) {
      return `Task: ${prompt}\n\nProvide a complete, working solution with code.`;
    }

    return prompt;
  }

  getSystemPrompt(context: TransformContext): string | null {
    if (context.worker === 'text-gen') {
      return 'You are a helpful AI assistant. Provide clear, accurate, and concise responses.';
    }
    return null;
  }
}

/**
 * Google Transformer
 * - Similar to OpenAI but with Google-specific optimizations
 */
export class GoogleTransformer implements PromptTransformer {
  readonly providerId = 'google';

  transform(prompt: string, _context: TransformContext): string {
    return prompt;
  }

  getSystemPrompt(context: TransformContext): string | null {
    if (context.worker === 'text-gen' && context.task_type === 'code') {
      return 'You are an expert programmer. Provide clean, efficient code with clear explanations.';
    }
    return null;
  }
}

/**
 * Ideogram Transformer
 * - Adds quality boosters for image generation
 * - Style-specific enhancements
 */
export class IdeogramTransformer implements PromptTransformer {
  readonly providerId = 'ideogram';

  transform(prompt: string, _context: TransformContext): string {
    const lowerPrompt = prompt.toLowerCase();

    // Quality boosters
    const qualityTerms = ['high quality', 'detailed', '4k', '8k', 'professional', 'masterpiece'];
    const hasQuality = qualityTerms.some((term) => lowerPrompt.includes(term));

    let enhanced = prompt;

    if (!hasQuality) {
      enhanced = `${prompt}, high quality, detailed`;
    }

    // Add lighting terms if not present
    const lightingTerms = ['lighting', 'lit', 'light', 'illuminated'];
    const hasLighting = lightingTerms.some((term) => lowerPrompt.includes(term));

    if (!hasLighting && !lowerPrompt.includes('logo') && !lowerPrompt.includes('icon')) {
      enhanced = `${enhanced}, professional lighting`;
    }

    return enhanced;
  }

  getSystemPrompt(_context: TransformContext): string | null {
    return null; // Image generation doesn't use system prompts
  }
}

/**
 * Replicate Transformer
 * - Model-specific prompt formatting
 */
export class ReplicateTransformer implements PromptTransformer {
  readonly providerId = 'replicate';

  transform(prompt: string, context: TransformContext): string {
    // FLUX models work well with detailed prompts
    if (context.model?.includes('flux')) {
      const lowerPrompt = prompt.toLowerCase();
      const hasQuality = ['detailed', 'high quality', '4k'].some((t) => lowerPrompt.includes(t));

      if (!hasQuality) {
        return `${prompt}, highly detailed, professional quality`;
      }
    }

    return prompt;
  }

  getSystemPrompt(_context: TransformContext): string | null {
    return null;
  }
}

/**
 * ElevenLabs Transformer
 * - Voice synthesis specific
 */
export class ElevenLabsTransformer implements PromptTransformer {
  readonly providerId = 'elevenlabs';

  transform(prompt: string, _context: TransformContext): string {
    // Clean up text for TTS
    // Remove markdown, code blocks, etc.
    let cleaned = prompt
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/`[^`]+`/g, '') // Remove inline code
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Convert links to text
      .replace(/[#*_~]/g, '') // Remove markdown formatting
      .replace(/\n{3,}/g, '\n\n') // Normalize line breaks
      .trim();

    return cleaned;
  }

  getSystemPrompt(_context: TransformContext): string | null {
    return null;
  }
}

/**
 * Transformer Registry
 */
export class TransformerRegistry {
  private transformers = new Map<string, PromptTransformer>();

  constructor() {
    // Register default transformers
    this.register(new AnthropicTransformer());
    this.register(new OpenAITransformer());
    this.register(new SparkTransformer());
    this.register(new GoogleTransformer());
    this.register(new IdeogramTransformer());
    this.register(new ReplicateTransformer());
    this.register(new ElevenLabsTransformer());
  }

  register(transformer: PromptTransformer): void {
    this.transformers.set(transformer.providerId, transformer);
  }

  get(providerId: string): PromptTransformer | null {
    return this.transformers.get(providerId) || null;
  }

  transform(prompt: string, context: TransformContext): string {
    const transformer = this.get(context.provider);
    if (transformer) {
      return transformer.transform(prompt, context);
    }
    return prompt;
  }

  getSystemPrompt(context: TransformContext): string | null {
    const transformer = this.get(context.provider);
    if (transformer) {
      return transformer.getSystemPrompt(context);
    }
    return null;
  }
}

// Singleton instance
export const transformerRegistry = new TransformerRegistry();
