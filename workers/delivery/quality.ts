/**
 * Quality Assessment Module
 * Basic quality control for deliverables
 */

import type { QualityAssessment, ProviderResponse } from './types';

/**
 * Assess quality of a text deliverable
 */
export function assessTextQuality(content: string): QualityAssessment {
  const issues: string[] = [];
  let score = 1.0;

  // Check for empty content
  if (!content || content.trim().length === 0) {
    return {
      score: 0,
      passed: false,
      issues: ['Content is empty'],
      metadata: {},
    };
  }

  // Check minimum length
  if (content.length < 10) {
    issues.push('Content is too short');
    score -= 0.3;
  }

  // Check for error indicators in content
  const errorPatterns = [
    /error/i,
    /failed/i,
    /unable to/i,
    /cannot/i,
    /sorry,? i/i,
  ];

  for (const pattern of errorPatterns) {
    if (pattern.test(content.slice(0, 100))) {
      issues.push('Content may indicate an error response');
      score -= 0.2;
      break;
    }
  }

  // Check for repetition (simple heuristic)
  const words = content.toLowerCase().split(/\s+/);
  const uniqueWords = new Set(words);
  const repetitionRatio = uniqueWords.size / words.length;
  if (repetitionRatio < 0.3 && words.length > 20) {
    issues.push('High content repetition detected');
    score -= 0.2;
  }

  // Check for truncation indicators
  if (content.endsWith('...') || content.endsWith('…')) {
    issues.push('Content may be truncated');
    score -= 0.1;
  }

  score = Math.max(0, Math.min(1, score));

  return {
    score,
    passed: score >= 0.5,
    issues,
    metadata: {
      length: content.length,
      word_count: words.length,
      unique_word_ratio: repetitionRatio,
    },
  };
}

/**
 * Assess quality of an image URL deliverable
 */
export function assessImageQuality(url: string): QualityAssessment {
  const issues: string[] = [];
  let score = 1.0;

  // Check for valid URL
  if (!url || url.trim().length === 0) {
    return {
      score: 0,
      passed: false,
      issues: ['Image URL is empty'],
      metadata: {},
    };
  }

  try {
    const parsed = new URL(url);

    // Check for HTTPS
    if (parsed.protocol !== 'https:') {
      issues.push('URL is not HTTPS');
      score -= 0.1;
    }

    // Check for known error image patterns
    if (parsed.pathname.includes('error') || parsed.pathname.includes('placeholder')) {
      issues.push('URL may be an error or placeholder image');
      score -= 0.3;
    }

    // Check for image file extension
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
    const hasImageExtension = imageExtensions.some(ext =>
      parsed.pathname.toLowerCase().endsWith(ext)
    );

    if (!hasImageExtension && !parsed.pathname.includes('/images/')) {
      issues.push('URL may not be an image');
      score -= 0.1;
    }

  } catch {
    return {
      score: 0,
      passed: false,
      issues: ['Invalid URL format'],
      metadata: { url },
    };
  }

  score = Math.max(0, Math.min(1, score));

  return {
    score,
    passed: score >= 0.5,
    issues,
    metadata: { url },
  };
}

/**
 * Assess quality of an audio URL deliverable
 */
export function assessAudioQuality(url: string): QualityAssessment {
  const issues: string[] = [];
  let score = 1.0;

  if (!url || url.trim().length === 0) {
    return {
      score: 0,
      passed: false,
      issues: ['Audio URL is empty'],
      metadata: {},
    };
  }

  try {
    const parsed = new URL(url);

    if (parsed.protocol !== 'https:') {
      issues.push('URL is not HTTPS');
      score -= 0.1;
    }

    const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac'];
    const hasAudioExtension = audioExtensions.some(ext =>
      parsed.pathname.toLowerCase().endsWith(ext)
    );

    if (!hasAudioExtension && !parsed.pathname.includes('/audio/')) {
      issues.push('URL may not be an audio file');
      score -= 0.1;
    }

  } catch {
    return {
      score: 0,
      passed: false,
      issues: ['Invalid URL format'],
      metadata: { url },
    };
  }

  score = Math.max(0, Math.min(1, score));

  return {
    score,
    passed: score >= 0.5,
    issues,
    metadata: { url },
  };
}

/**
 * Assess quality based on content type
 */
export function assessQuality(response: ProviderResponse): QualityAssessment {
  switch (response.content_type) {
    case 'text':
      return assessTextQuality(response.content);
    case 'image_url':
      return assessImageQuality(response.content);
    case 'audio_url':
      return assessAudioQuality(response.content);
    case 'video_url':
      // Similar to image for now
      return assessImageQuality(response.content);
    case 'json':
      // Basic validation for JSON
      try {
        JSON.parse(response.content);
        return {
          score: 1.0,
          passed: true,
          issues: [],
          metadata: {},
        };
      } catch {
        return {
          score: 0,
          passed: false,
          issues: ['Invalid JSON content'],
          metadata: {},
        };
      }
    default:
      // Unknown content type - pass with warning
      return {
        score: 0.7,
        passed: true,
        issues: ['Unknown content type'],
        metadata: { content_type: response.content_type },
      };
  }
}

/**
 * Check if deliverable should be auto-approved
 */
export function shouldAutoApprove(assessment: QualityAssessment): boolean {
  // Auto-approve if score is high enough and no critical issues
  return assessment.score >= 0.8 && assessment.issues.length === 0;
}

/**
 * Check if deliverable should be auto-rejected
 */
export function shouldAutoReject(assessment: QualityAssessment): boolean {
  // Auto-reject if score is too low
  return assessment.score < 0.3;
}
