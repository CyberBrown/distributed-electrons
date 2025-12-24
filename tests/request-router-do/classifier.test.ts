/**
 * Tests for Request Router Classifier
 */

import { describe, it, expect } from 'vitest';
import {
  classifyQuery,
  classifyWithType,
  getEstimatedProcessingTime,
} from '../../workers/shared/request-router-do/classifier';

describe('Task Classifier', () => {
  describe('classifyQuery', () => {
    describe('Image detection', () => {
      it('should classify "draw" requests as image', () => {
        const result = classifyQuery('Draw me a picture of a cat');
        expect(result.task_type).toBe('image');
        expect(result.confidence).toBeGreaterThan(0);
      });

      it('should classify "paint" requests as image', () => {
        const result = classifyQuery('Paint a sunset over the ocean');
        expect(result.task_type).toBe('image');
      });

      it('should classify "generate image" requests as image', () => {
        const result = classifyQuery('Generate an image of a futuristic city');
        expect(result.task_type).toBe('image');
      });

      it('should classify "photo" requests as image', () => {
        const result = classifyQuery('Create a photo of a mountain landscape');
        expect(result.task_type).toBe('image');
      });

      it('should detect illustration subtask', () => {
        const result = classifyQuery('Draw a cartoon illustration of a dog');
        expect(result.task_type).toBe('image');
        expect(result.subtask).toBe('illustration');
        expect(result.provider).toBe('gemini');
      });

      it('should detect photo-realistic subtask', () => {
        const result = classifyQuery('Create a realistic photo of a sports car');
        expect(result.task_type).toBe('image');
        expect(result.subtask).toBe('photo-realistic');
        expect(result.provider).toBe('ideogram');
      });
    });

    describe('Text detection', () => {
      it('should classify "write" requests as text', () => {
        const result = classifyQuery('Write a blog post about AI');
        expect(result.task_type).toBe('text');
      });

      it('should classify "explain" requests as text', () => {
        const result = classifyQuery('Explain how photosynthesis works');
        expect(result.task_type).toBe('text');
      });

      it('should classify "summarize" requests as text', () => {
        const result = classifyQuery('Summarize the main points of this article');
        expect(result.task_type).toBe('text');
      });

      it('should detect fast subtask', () => {
        const result = classifyQuery('Give me a quick answer about the weather');
        expect(result.task_type).toBe('text');
        expect(result.subtask).toBe('fast');
        // Fast subtask now routes to sandbox-executor (Claude Code with OAuth)
        expect(result.model).toBe('claude-code');
      });

      it('should use sandbox-executor as default text provider', () => {
        const result = classifyQuery('Help me write an email');
        expect(result.task_type).toBe('text');
        // Text tasks now route to sandbox-executor to use Claude.ai Max subscription
        expect(result.provider).toBe('sandbox-executor');
      });
    });

    describe('Audio detection', () => {
      it('should classify "speak" requests as audio', () => {
        const result = classifyQuery('Speak this text aloud');
        expect(result.task_type).toBe('audio');
      });

      it('should classify "text to speech" requests as audio', () => {
        const result = classifyQuery('Convert this to text-to-speech');
        expect(result.task_type).toBe('audio');
      });

      it('should classify "narrate" requests as audio', () => {
        const result = classifyQuery('Narrate this story for me');
        expect(result.task_type).toBe('audio');
      });

      it('should use elevenlabs as audio provider', () => {
        const result = classifyQuery('Read this article aloud');
        expect(result.task_type).toBe('audio');
        expect(result.provider).toBe('elevenlabs');
      });
    });

    describe('Video detection', () => {
      it('should classify "render video" requests as video', () => {
        const result = classifyQuery('Render a video from these clips');
        expect(result.task_type).toBe('video');
      });

      it('should classify "animation" requests as video', () => {
        const result = classifyQuery('Create an animation of a bouncing ball');
        expect(result.task_type).toBe('video');
      });

      it('should use shotstack as video provider', () => {
        const result = classifyQuery('Make a video compilation');
        expect(result.task_type).toBe('video');
        expect(result.provider).toBe('shotstack');
      });
    });

    describe('Context detection', () => {
      it('should classify context queries', () => {
        const result = classifyQuery('Search in the codebase for auth handlers');
        expect(result.task_type).toBe('context');
      });

      it('should classify "from context" queries', () => {
        const result = classifyQuery('From the context, find all API endpoints');
        expect(result.task_type).toBe('context');
      });

      it('should use gemini as context provider', () => {
        const result = classifyQuery('Look up the documentation for this feature');
        expect(result.task_type).toBe('context');
        expect(result.provider).toBe('gemini');
      });
    });

    describe('Default behavior', () => {
      it('should default to text for ambiguous queries', () => {
        const result = classifyQuery('Hello, how are you?');
        expect(result.task_type).toBe('text');
      });

      it('should have low confidence for ambiguous queries', () => {
        const result = classifyQuery('Something random here');
        expect(result.confidence).toBeLessThanOrEqual(0.5);
      });
    });
  });

  describe('classifyWithType', () => {
    it('should use provided task type', () => {
      const result = classifyWithType('Make something cool', 'image');
      expect(result.task_type).toBe('image');
      expect(result.confidence).toBe(1);
    });

    it('should still detect subtasks within type', () => {
      const result = classifyWithType('Create a cartoon character', 'image');
      expect(result.task_type).toBe('image');
      expect(result.subtask).toBe('illustration');
    });

    it('should use default routing for type without subtask match', () => {
      const result = classifyWithType('Generate something', 'text');
      expect(result.task_type).toBe('text');
      // Text tasks now route to sandbox-executor (Claude Code with OAuth)
      expect(result.provider).toBe('sandbox-executor');
      expect(result.model).toBe('claude-code');
    });
  });

  describe('getEstimatedProcessingTime', () => {
    it('should return estimate for anthropic text', () => {
      const time = getEstimatedProcessingTime('text', 'anthropic');
      expect(time).toBe(2000);
    });

    it('should return estimate for ideogram image', () => {
      const time = getEstimatedProcessingTime('image', 'ideogram');
      expect(time).toBe(15000);
    });

    it('should return estimate for elevenlabs audio', () => {
      const time = getEstimatedProcessingTime('audio', 'elevenlabs');
      expect(time).toBe(5000);
    });

    it('should return estimate for shotstack video', () => {
      const time = getEstimatedProcessingTime('video', 'shotstack');
      expect(time).toBe(60000);
    });

    it('should return default for unknown combinations', () => {
      const time = getEstimatedProcessingTime('unknown', 'unknown');
      expect(time).toBe(5000);
    });
  });
});
