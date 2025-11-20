/**
 * R2 Metadata Management
 * Utilities for handling image metadata
 */

import type { ImageMetadata } from './types';

/**
 * Generate metadata object for an image
 */
export function generateMetadata(
  instanceId: string,
  provider: string,
  model: string,
  prompt: string,
  projectId?: string,
  additionalMetadata?: Record<string, string>
): ImageMetadata {
  const metadata: ImageMetadata = {
    instance_id: instanceId,
    provider,
    model,
    prompt: truncatePrompt(prompt),
    generation_timestamp: new Date().toISOString(),
  };

  if (projectId) {
    metadata.project_id = projectId;
  }

  // Add any additional metadata
  if (additionalMetadata) {
    Object.assign(metadata, additionalMetadata);
  }

  return metadata;
}

/**
 * Truncate prompt to fit in R2 metadata limits
 * R2 custom metadata has size limits
 */
export function truncatePrompt(prompt: string, maxLength: number = 512): string {
  if (prompt.length <= maxLength) {
    return prompt;
  }

  return prompt.substring(0, maxLength - 3) + '...';
}

/**
 * Extract metadata from R2 object
 */
export function parseMetadata(
  customMetadata: Record<string, string>
): ImageMetadata | null {
  if (!customMetadata.instance_id) {
    return null;
  }

  return {
    instance_id: customMetadata.instance_id,
    project_id: customMetadata.project_id,
    provider: customMetadata.provider || 'unknown',
    model: customMetadata.model || 'unknown',
    prompt: customMetadata.prompt || '',
    generation_timestamp: customMetadata.generation_timestamp || new Date().toISOString(),
    ...customMetadata,
  };
}

/**
 * Validate metadata before storage
 */
export function validateMetadata(metadata: ImageMetadata): boolean {
  if (!metadata.instance_id || metadata.instance_id.trim() === '') {
    return false;
  }

  if (!metadata.provider || metadata.provider.trim() === '') {
    return false;
  }

  return true;
}

/**
 * Serialize metadata to R2-compatible format
 */
export function serializeMetadata(
  metadata: ImageMetadata
): Record<string, string> {
  const serialized: Record<string, string> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined && value !== null) {
      serialized[key] = String(value);
    }
  }

  return serialized;
}
