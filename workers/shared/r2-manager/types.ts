/**
 * R2 Storage Manager Types
 */

export interface StorageOptions {
  instanceId: string;
  projectId?: string;
  filename: string;
  metadata: Record<string, string>;
}

export interface UploadResult {
  r2_path: string;
  cdn_url: string;
  bucket: string;
  size_bytes: number;
  uploaded_at: string;
}

export interface R2ManagerEnv {
  R2_BUCKET?: R2Bucket;
  CDN_URL?: string;
}

export interface ImageMetadata {
  instance_id: string;
  project_id?: string;
  provider: string;
  model: string;
  prompt: string;
  generation_timestamp: string;
  [key: string]: string | undefined;
}
