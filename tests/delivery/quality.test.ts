/**
 * Tests for Delivery Quality Assessment
 */

import { describe, it, expect } from 'vitest';
import {
  assessTextQuality,
  assessImageQuality,
  assessAudioQuality,
  assessQuality,
  shouldAutoApprove,
  shouldAutoReject,
} from '../../workers/delivery/quality';

describe('Quality Assessment', () => {
  describe('assessTextQuality', () => {
    it('should pass quality check for good content', () => {
      const result = assessTextQuality(
        'This is a well-written response that provides comprehensive information about the topic at hand.'
      );
      expect(result.passed).toBe(true);
      expect(result.score).toBeGreaterThan(0.5);
    });

    it('should fail for empty content', () => {
      const result = assessTextQuality('');
      expect(result.passed).toBe(false);
      expect(result.score).toBe(0);
      expect(result.issues).toContain('Content is empty');
    });

    it('should fail for whitespace-only content', () => {
      const result = assessTextQuality('   \n\t   ');
      expect(result.passed).toBe(false);
      expect(result.score).toBe(0);
    });

    it('should penalize very short content', () => {
      const result = assessTextQuality('Hi');
      expect(result.score).toBeLessThan(1);
      expect(result.issues).toContain('Content is too short');
    });

    it('should detect potential error responses', () => {
      const result = assessTextQuality('Sorry, I cannot help with that request.');
      expect(result.issues.some(i => i.includes('error response'))).toBe(true);
      expect(result.score).toBeLessThan(1);
    });

    it('should detect high repetition', () => {
      const result = assessTextQuality(
        'word word word word word word word word word word word word word word word word word word word word word word word word word word'
      );
      expect(result.issues.some(i => i.includes('repetition'))).toBe(true);
    });

    it('should detect truncated content', () => {
      const result = assessTextQuality('This is some content that appears to be...');
      expect(result.issues.some(i => i.includes('truncated'))).toBe(true);
    });

    it('should include metadata', () => {
      const result = assessTextQuality('This is a test response with some words.');
      expect(result.metadata).toHaveProperty('length');
      expect(result.metadata).toHaveProperty('word_count');
      expect(result.metadata).toHaveProperty('unique_word_ratio');
    });
  });

  describe('assessImageQuality', () => {
    it('should pass for valid HTTPS image URL', () => {
      const result = assessImageQuality('https://example.com/images/photo.png');
      expect(result.passed).toBe(true);
      expect(result.score).toBeGreaterThan(0.5);
    });

    it('should fail for empty URL', () => {
      const result = assessImageQuality('');
      expect(result.passed).toBe(false);
      expect(result.score).toBe(0);
    });

    it('should fail for invalid URL', () => {
      const result = assessImageQuality('not-a-url');
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('Invalid URL format');
    });

    it('should penalize HTTP (non-HTTPS) URLs', () => {
      const result = assessImageQuality('http://example.com/image.png');
      expect(result.issues.some(i => i.includes('HTTPS'))).toBe(true);
      expect(result.score).toBeLessThan(1);
    });

    it('should detect error image patterns', () => {
      const result = assessImageQuality('https://example.com/error/placeholder.png');
      expect(result.issues.some(i => i.includes('error') || i.includes('placeholder'))).toBe(true);
    });

    it('should accept various image extensions', () => {
      const extensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
      for (const ext of extensions) {
        const result = assessImageQuality(`https://example.com/image${ext}`);
        expect(result.passed).toBe(true);
      }
    });
  });

  describe('assessAudioQuality', () => {
    it('should pass for valid HTTPS audio URL', () => {
      const result = assessAudioQuality('https://example.com/audio/speech.mp3');
      expect(result.passed).toBe(true);
    });

    it('should fail for empty URL', () => {
      const result = assessAudioQuality('');
      expect(result.passed).toBe(false);
    });

    it('should accept various audio extensions', () => {
      const extensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac'];
      for (const ext of extensions) {
        const result = assessAudioQuality(`https://example.com/audio${ext}`);
        expect(result.passed).toBe(true);
      }
    });
  });

  describe('assessQuality', () => {
    it('should route to correct assessor based on content_type', () => {
      const textResult = assessQuality({
        request_id: 'test',
        success: true,
        content_type: 'text',
        content: 'Good text content here.',
      });
      expect(textResult.metadata).toHaveProperty('word_count');

      const imageResult = assessQuality({
        request_id: 'test',
        success: true,
        content_type: 'image_url',
        content: 'https://example.com/image.png',
      });
      expect(imageResult.metadata).toHaveProperty('url');
    });

    it('should validate JSON content type', () => {
      const validJson = assessQuality({
        request_id: 'test',
        success: true,
        content_type: 'json',
        content: '{"key": "value"}',
      });
      expect(validJson.passed).toBe(true);

      const invalidJson = assessQuality({
        request_id: 'test',
        success: true,
        content_type: 'json',
        content: 'not valid json',
      });
      expect(invalidJson.passed).toBe(false);
    });

    it('should handle unknown content types', () => {
      const result = assessQuality({
        request_id: 'test',
        success: true,
        content_type: 'unknown_type' as any,
        content: 'some content',
      });
      expect(result.passed).toBe(true);
      expect(result.issues.some(i => i.includes('Unknown'))).toBe(true);
    });
  });

  describe('shouldAutoApprove', () => {
    it('should auto-approve high quality with no issues', () => {
      expect(shouldAutoApprove({
        score: 0.9,
        passed: true,
        issues: [],
        metadata: {},
      })).toBe(true);
    });

    it('should not auto-approve if score is below threshold', () => {
      expect(shouldAutoApprove({
        score: 0.7,
        passed: true,
        issues: [],
        metadata: {},
      })).toBe(false);
    });

    it('should not auto-approve if there are issues', () => {
      expect(shouldAutoApprove({
        score: 0.9,
        passed: true,
        issues: ['Some warning'],
        metadata: {},
      })).toBe(false);
    });
  });

  describe('shouldAutoReject', () => {
    it('should auto-reject very low scores', () => {
      expect(shouldAutoReject({
        score: 0.2,
        passed: false,
        issues: ['Critical issue'],
        metadata: {},
      })).toBe(true);
    });

    it('should not auto-reject moderate scores', () => {
      expect(shouldAutoReject({
        score: 0.5,
        passed: false,
        issues: ['Some issue'],
        metadata: {},
      })).toBe(false);
    });

    it('should not auto-reject passing content', () => {
      expect(shouldAutoReject({
        score: 0.6,
        passed: true,
        issues: [],
        metadata: {},
      })).toBe(false);
    });
  });
});
