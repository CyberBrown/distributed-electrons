/**
 * Stock Media Worker Types
 */

export interface SearchRequest {
  keywords: string[];
  duration?: number;
  orientation?: 'landscape' | 'portrait' | 'square';
  size?: 'large' | 'medium' | 'small';
  instance_id?: string;
  project_id?: string;
  options?: {
    per_page?: number;
    page?: number;
    min_width?: number;
    min_height?: number;
    min_duration?: number;
    max_duration?: number;
  };
}

export interface MediaItem {
  id: string;
  type: 'video' | 'image';
  url: string;
  preview_url: string;
  duration?: number;
  width: number;
  height: number;
  provider: string;
  photographer?: string;
  photographer_url?: string;
}

export interface SearchResponse {
  success: boolean;
  media: MediaItem[];
  total_results: number;
  page: number;
  per_page: number;
  metadata: {
    provider: string;
    query: string;
    search_time_ms: number;
  };
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
  RATE_LIMITER?: DurableObjectNamespace;

  // Environment variables
  DEFAULT_INSTANCE_ID?: string;

  // API Keys (from secrets)
  PEXELS_API_KEY?: string;
}

export interface InstanceConfig {
  instance_id: string;
  org_id: string;
  api_keys: Record<string, string>;
  rate_limits: Record<string, { rpm: number }>;
}
