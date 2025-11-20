/**
 * R2 Storage Manager Module
 * Handles image uploads to R2 and CDN URL generation
 */

export {
  uploadImage,
  downloadImage,
  deleteImage,
  getImageMetadata,
  listImages,
  generatePath,
  sanitizeFilename,
  getContentType,
  generateCdnUrl,
} from './storage';

export {
  generateMetadata,
  truncatePrompt,
  parseMetadata,
  validateMetadata,
  serializeMetadata,
} from './metadata';

export type {
  StorageOptions,
  UploadResult,
  R2ManagerEnv,
  ImageMetadata,
} from './types';
