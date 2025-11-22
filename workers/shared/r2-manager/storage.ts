/**
 * R2 Storage Manager
 * Handles uploading images to R2 and generating CDN URLs
 */

import type {
  StorageOptions,
  UploadResult,
  R2ManagerEnv,
} from './types';
import { generateMetadata, truncatePrompt } from './metadata';

/**
 * Upload an image to R2 storage
 */
export async function uploadImage(
  imageData: ArrayBuffer | ReadableStream,
  options: StorageOptions,
  env: R2ManagerEnv
): Promise<UploadResult> {
  if (!env.R2_BUCKET) {
    throw new Error('R2_BUCKET binding not configured');
  }

  // Generate unique path
  const path = generatePath(
    options.instanceId,
    options.projectId,
    options.filename
  );

  // Prepare metadata
  const metadata = prepareMetadata(options.metadata);

  // Upload to R2
  const uploaded = await env.R2_BUCKET.put(path, imageData, {
    httpMetadata: {
      contentType: getContentType(options.filename),
    },
    customMetadata: metadata,
  });

  // Calculate size
  const size = await getUploadSize(uploaded);

  // Generate CDN URL
  const cdnUrl = generateCdnUrl(path, env);

  return {
    r2_path: path,
    cdn_url: cdnUrl,
    bucket: env.R2_BUCKET.name || 'default',
    size_bytes: size,
    uploaded_at: new Date().toISOString(),
  };
}

/**
 * Generate a unique R2 path for the image
 * Format: {instance_id}/{project_id}/{timestamp}_{filename}
 */
export function generatePath(
  instanceId: string,
  projectId: string | undefined,
  filename: string
): string {
  const timestamp = Date.now();
  const sanitizedFilename = sanitizeFilename(filename);

  if (projectId) {
    return `${instanceId}/${projectId}/${timestamp}_${sanitizedFilename}`;
  }

  return `${instanceId}/${timestamp}_${sanitizedFilename}`;
}

/**
 * Sanitize filename to remove unsafe characters
 */
export function sanitizeFilename(filename: string): string {
  // Remove path traversal attempts
  let sanitized = filename.replace(/\.\./g, '');

  // Remove path separators (security: prevent directory traversal)
  sanitized = sanitized.replace(/\//g, '');
  sanitized = sanitized.replace(/\\/g, '');

  // Replace unsafe characters with underscores (keep only ., _, -, alphanumeric)
  sanitized = sanitized.replace(/[^a-zA-Z0-9._-]/g, '_');

  // Ensure it has an extension
  if (!sanitized.includes('.')) {
    sanitized += '.png';
  }

  return sanitized;
}

/**
 * Get content type based on file extension
 */
export function getContentType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();

  const contentTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  };

  return contentTypes[ext || 'png'] || 'image/png';
}

/**
 * Prepare metadata for R2 storage
 */
export function prepareMetadata(
  metadata: Record<string, string>
): Record<string, string> {
  const prepared: Record<string, string> = {};

  // R2 metadata values must be strings
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined && value !== null) {
      // Truncate long values
      const stringValue = String(value);
      prepared[key] = stringValue.length > 1024
        ? stringValue.substring(0, 1021) + '...'
        : stringValue;
    }
  }

  return prepared;
}

/**
 * Generate CDN URL for the uploaded image
 */
export function generateCdnUrl(path: string, env: R2ManagerEnv): string {
  // Use custom CDN URL if configured (worker URL)
  if (env.CDN_URL) {
    return `${env.CDN_URL}/images/${path}`;
  }

  // Fallback - should not reach here in production
  return `https://storage.example.com/${path}`;
}

/**
 * Get the size of the uploaded object
 */
async function getUploadSize(object: R2Object | null): Promise<number> {
  if (!object) {
    return 0;
  }

  return object.size;
}

/**
 * Download an image from R2
 */
export async function downloadImage(
  path: string,
  env: R2ManagerEnv
): Promise<ArrayBuffer | null> {
  if (!env.R2_BUCKET) {
    throw new Error('R2_BUCKET binding not configured');
  }

  const object = await env.R2_BUCKET.get(path);

  if (!object) {
    return null;
  }

  return await object.arrayBuffer();
}

/**
 * Delete an image from R2
 */
export async function deleteImage(
  path: string,
  env: R2ManagerEnv
): Promise<void> {
  if (!env.R2_BUCKET) {
    throw new Error('R2_BUCKET binding not configured');
  }

  await env.R2_BUCKET.delete(path);
}

/**
 * Get metadata for an image
 */
export async function getImageMetadata(
  path: string,
  env: R2ManagerEnv
): Promise<Record<string, string> | null> {
  if (!env.R2_BUCKET) {
    throw new Error('R2_BUCKET binding not configured');
  }

  const object = await env.R2_BUCKET.head(path);

  if (!object) {
    return null;
  }

  return object.customMetadata || {};
}

/**
 * List images in a specific instance or project
 */
export async function listImages(
  instanceId: string,
  projectId?: string,
  env?: R2ManagerEnv,
  limit: number = 100
): Promise<string[]> {
  if (!env?.R2_BUCKET) {
    throw new Error('R2_BUCKET binding not configured');
  }

  const prefix = projectId
    ? `${instanceId}/${projectId}/`
    : `${instanceId}/`;

  const listed = await env.R2_BUCKET.list({
    prefix,
    limit,
  });

  return listed.objects.map(obj => obj.key);
}
