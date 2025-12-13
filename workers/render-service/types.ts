/**
 * Render Service Worker Types
 */

export interface RenderRequest {
  timeline: Timeline;
  output?: {
    format?: 'mp4' | 'gif' | 'mp3';
    resolution?: 'hd' | 'sd' | '1080' | '720' | '480';
    fps?: number;
    quality?: 'high' | 'medium' | 'low';
  };
  instance_id?: string;
  project_id?: string;
  callback_url?: string;
}

export interface Timeline {
  soundtrack?: {
    src: string;
    effect?: 'fadeIn' | 'fadeOut' | 'fadeInFadeOut';
    volume?: number;
  };
  tracks: Track[];
}

export interface Track {
  clips: Clip[];
}

export interface Clip {
  asset: Asset;
  start: number;
  length: number;
  fit?: 'crop' | 'cover' | 'contain' | 'none';
  scale?: number;
  position?: 'top' | 'topRight' | 'right' | 'bottomRight' | 'bottom' | 'bottomLeft' | 'left' | 'topLeft' | 'center';
  offset?: { x: number; y: number };
  transition?: {
    in?: string;
    out?: string;
  };
  effect?: string;
  filter?: string;
  opacity?: number;
}

export interface Asset {
  type: 'video' | 'image' | 'audio' | 'title' | 'html';
  src?: string;
  text?: string;
  html?: string;
  css?: string;
  width?: number;
  height?: number;
  background?: string;
  color?: string;
  trim?: number;
  volume?: number;
  crop?: { top: number; bottom: number; left: number; right: number };
}

export interface RenderResponse {
  success: boolean;
  render_id: string;
  status: 'queued' | 'rendering' | 'done' | 'failed';
  url?: string;
  metadata: {
    provider: string;
    format: string;
    resolution: string;
    duration_seconds?: number;
    file_size_bytes?: number;
  };
  request_id: string;
  timestamp: string;
}

export interface RenderStatusResponse {
  success: boolean;
  render_id: string;
  status: 'queued' | 'fetching' | 'rendering' | 'saving' | 'done' | 'failed';
  progress?: number;
  url?: string;
  error?: string;
  request_id: string;
  timestamp: string;
}

export interface ErrorResponse {
  error: string;
  error_code: string;
  request_id: string;
  details?: Record<string, any>;
}

export interface Env {
  // Bindings
  RENDER_STORAGE: R2Bucket;
  RATE_LIMITER?: DurableObjectNamespace;

  // Environment variables
  DEFAULT_INSTANCE_ID?: string;

  // API Keys (from secrets)
  SHOTSTACK_API_KEY?: string;
  SHOTSTACK_ENV?: 'v1' | 'stage';
}

export interface InstanceConfig {
  instance_id: string;
  org_id: string;
  api_keys: Record<string, string>;
  rate_limits: Record<string, { rpm: number }>;
}
