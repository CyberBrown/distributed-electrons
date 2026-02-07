/**
 * Shared AI Gateway routing helper.
 *
 * Consolidates the pattern used across callAnthropic, callGeminiApi, and callOpenAI
 * in TextGenerationWorkflow. Routes requests through Cloudflare AI Gateway when
 * CF_AIG_TOKEN is configured, otherwise falls back to direct provider APIs.
 *
 * NOTE: z.ai (GLM/DeepSeek) is NOT a supported AI Gateway provider.
 * Those calls remain direct — do not add a 'z-ai' provider here.
 */

export type GatewayProvider = 'anthropic' | 'openai' | 'google-ai-studio';

export interface GatewayConfig {
  /** AI Gateway base URL (AI_GATEWAY_URL env var) */
  gatewayBaseUrl: string;
  /** CF AI Gateway token — when set, routes through the gateway */
  cfAigToken?: string;
}

export interface GatewayRequestOptions {
  /** Which AI Gateway provider endpoint to use */
  provider: GatewayProvider;
  /** Path appended after the provider segment, e.g. '/v1/messages' */
  path: string;
  /** Direct-mode API key (used when gateway is not configured) */
  apiKey?: string;
  /** Extra headers merged into the request (provider-specific, e.g. anthropic-version) */
  headers?: Record<string, string>;
  /** Request body (will be JSON-serialized) */
  body: unknown;
}

/** Maps provider to its direct (non-gateway) base URL */
const DIRECT_BASE_URLS: Record<GatewayProvider, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  'google-ai-studio': 'https://generativelanguage.googleapis.com',
};

/** Maps provider to its native auth header name */
const AUTH_HEADERS: Record<GatewayProvider, string> = {
  anthropic: 'x-api-key',
  openai: 'Authorization',
  'google-ai-studio': '', // Google uses query-param auth, handled by caller
};

/**
 * Route a request through AI Gateway (if configured) or directly to the provider.
 *
 * Gateway mode: `${gatewayBaseUrl}/${provider}${path}` with `cf-aig-authorization` header.
 * Direct mode:  `${directBaseUrl}${path}` with provider-native auth header.
 */
export async function callViaGateway(
  config: GatewayConfig,
  options: GatewayRequestOptions,
): Promise<Response> {
  const useGateway = !!config.cfAigToken;

  let url: string;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (useGateway) {
    url = `${config.gatewayBaseUrl}/${options.provider}${options.path}`;
    headers['cf-aig-authorization'] = `Bearer ${config.cfAigToken}`;
  } else {
    url = `${DIRECT_BASE_URLS[options.provider]}${options.path}`;

    // Add provider-native auth header when not going through gateway
    const authHeader = AUTH_HEADERS[options.provider];
    if (authHeader && options.apiKey) {
      if (options.provider === 'anthropic') {
        headers[authHeader] = options.apiKey;
      } else {
        headers[authHeader] = `Bearer ${options.apiKey}`;
      }
    }
  }

  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(options.body),
  });
}
