/**
 * OAuth Credential Handlers
 * Manages Claude OAuth credentials for sandbox-executor
 * Supports automatic token refresh - human only needed if refresh token expires
 */

import { Env } from '../types';
import {
  errorResponse,
  successResponse,
  parseJsonBody,
  generateRequestId,
} from '../utils';

const OAUTH_KV_KEY = 'oauth:claude_max';
const ANTHROPIC_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'; // Claude Code's public client ID

/**
 * Encrypt a value using AES-GCM
 */
async function encrypt(plaintext: string, keyString: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyData = Uint8Array.from(atob(keyString), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    encoded
  );

  const ivBase64 = btoa(String.fromCharCode(...iv));
  const ciphertextBase64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));

  return `${ivBase64}:${ciphertextBase64}`;
}

/**
 * Decrypt a value using AES-GCM
 */
async function decrypt(encrypted: string, keyString: string): Promise<string> {
  const [ivBase64, ciphertextBase64] = encrypted.split(':');

  const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(ciphertextBase64), c => c.charCodeAt(0));
  const keyData = Uint8Array.from(atob(keyString), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Validate API key from request
 * Checks against the internal_api_key stored in KV
 */
async function validateApiKey(request: Request, env: Env): Promise<boolean> {
  const authHeader = request.headers.get('Authorization');
  const apiKeyHeader = request.headers.get('X-API-Key');
  const internalKeyHeader = request.headers.get('X-Internal-Key');

  const apiKey = authHeader?.replace('Bearer ', '') || apiKeyHeader || internalKeyHeader;

  if (!apiKey) return false;

  // Check against internal API key stored in KV
  if (env.PROVIDER_KEYS) {
    const storedKey = await env.PROVIDER_KEYS.get('internal_api_key');
    if (storedKey && storedKey === apiKey) {
      return true;
    }
  }

  return false;
}

interface StoreOAuthRequest {
  credentials_json: string; // Full .credentials.json content
}

interface OAuthCredentials {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  claudeAiOauth?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
    accountUuid?: string;
  };
}

/**
 * Store Claude OAuth credentials
 * POST /oauth/claude
 */
export async function storeOAuthCredentials(
  request: Request,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    // Validate API key
    const isValid = await validateApiKey(request, env);
    if (!isValid) {
      return errorResponse('Unauthorized - valid API key required', 401, requestId);
    }

    if (!env.PROVIDER_KEYS) {
      return errorResponse('Credential storage not configured', 500, requestId);
    }

    const body = await parseJsonBody<StoreOAuthRequest>(request);

    if (!body.credentials_json) {
      return errorResponse('credentials_json is required', 400, requestId);
    }

    // Parse and validate credentials structure
    let creds: OAuthCredentials;
    let expiresAt: string | undefined;
    try {
      creds = JSON.parse(body.credentials_json);
      // Handle both old format (accessToken at root) and new format (claudeAiOauth nested)
      if (creds.claudeAiOauth?.accessToken) {
        expiresAt = creds.claudeAiOauth.expiresAt;
      } else if (creds.accessToken) {
        expiresAt = creds.expiresAt;
      } else {
        throw new Error('Invalid credentials structure - no accessToken found');
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Invalid JSON format';
      return errorResponse(`Invalid credentials JSON: ${errMsg}`, 400, requestId);
    }

    // Encrypt credentials
    let valueToStore = body.credentials_json;
    if (env.ENCRYPTION_KEY) {
      valueToStore = await encrypt(body.credentials_json, env.ENCRYPTION_KEY);
    } else {
      console.warn('ENCRYPTION_KEY not set, storing plaintext (not recommended)');
    }

    // Store in KV with metadata
    const now = new Date().toISOString();
    await env.PROVIDER_KEYS.put(OAUTH_KV_KEY, valueToStore, {
      metadata: {
        expires_at: expiresAt,
        updated_at: now,
        provider: 'claude_max',
      },
    });

    return successResponse({
      stored: true,
      expires_at: expiresAt,
      updated_at: now,
    }, requestId);
  } catch (error) {
    console.error('Error storing OAuth credentials:', error);
    if ((error as Error).message === 'Invalid JSON body') {
      return errorResponse('Invalid JSON body', 400, requestId);
    }
    return errorResponse('Failed to store credentials', 500, requestId);
  }
}

/**
 * Get OAuth credentials status (not the actual credentials)
 * GET /oauth/claude/status
 * Note: This endpoint is public since it only returns status, not credentials
 */
export async function getOAuthStatus(
  request: Request,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    // Status endpoint is public - it only shows whether credentials exist
    // and their expiration status, not the actual credentials

    if (!env.PROVIDER_KEYS) {
      return errorResponse('Credential storage not configured', 500, requestId);
    }

    const result = await env.PROVIDER_KEYS.getWithMetadata(OAUTH_KV_KEY);

    if (!result.value) {
      return successResponse({
        configured: false,
        expired: true,
        message: 'No OAuth credentials configured',
      }, requestId);
    }

    const metadata = result.metadata as {
      expires_at?: string;
      updated_at?: string;
      provider?: string;
    };

    let hoursRemaining = -1;
    let expired = true;

    if (metadata.expires_at) {
      const expiresAt = new Date(metadata.expires_at);
      const now = new Date();
      hoursRemaining = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);
      expired = hoursRemaining <= 0;
    }

    return successResponse({
      configured: true,
      expired,
      expires_at: metadata.expires_at,
      hours_remaining: Math.max(0, Math.round(hoursRemaining * 10) / 10),
      updated_at: metadata.updated_at,
      needs_refresh: hoursRemaining <= 2, // Warn when < 2 hours remaining
    }, requestId);
  } catch (error) {
    console.error('Error getting OAuth status:', error);
    return errorResponse('Failed to get status', 500, requestId);
  }
}

/**
 * Get OAuth credentials (for sandbox-executor to fetch)
 * GET /oauth/claude
 * Internal API - requires X-Internal-Key header
 */
export async function getOAuthCredentials(
  request: Request,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    // Check for internal API key or regular API key
    const internalKey = request.headers.get('X-Internal-Key');
    const hasInternalAccess = internalKey && env.PROVIDER_KEYS &&
      await env.PROVIDER_KEYS.get('internal_api_key') === internalKey;

    // Also allow regular API key auth for CLI usage
    const hasApiKeyAccess = await validateApiKey(request, env);

    if (!hasInternalAccess && !hasApiKeyAccess) {
      return errorResponse('Forbidden', 403, requestId);
    }

    if (!env.PROVIDER_KEYS) {
      return errorResponse('Credential storage not configured', 500, requestId);
    }

    const result = await env.PROVIDER_KEYS.get(OAUTH_KV_KEY);

    if (!result) {
      return errorResponse('No OAuth credentials configured', 404, requestId);
    }

    // Decrypt if encrypted
    let credentials = result;
    if (env.ENCRYPTION_KEY && result.includes(':')) {
      try {
        credentials = await decrypt(result, env.ENCRYPTION_KEY);
      } catch (e) {
        console.error('Decryption failed, returning as-is');
      }
    }

    return successResponse({ credentials_json: credentials }, requestId);
  } catch (error) {
    console.error('Error getting OAuth credentials:', error);
    return errorResponse('Failed to get credentials', 500, requestId);
  }
}

/**
 * Delete OAuth credentials
 * DELETE /oauth/claude
 */
export async function deleteOAuthCredentials(
  request: Request,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    // Validate API key
    const isValid = await validateApiKey(request, env);
    if (!isValid) {
      return errorResponse('Unauthorized - valid API key required', 401, requestId);
    }

    if (!env.PROVIDER_KEYS) {
      return errorResponse('Credential storage not configured', 500, requestId);
    }

    await env.PROVIDER_KEYS.delete(OAUTH_KV_KEY);

    return successResponse({
      deleted: true,
    }, requestId);
  } catch (error) {
    console.error('Error deleting OAuth credentials:', error);
    return errorResponse('Failed to delete credentials', 500, requestId);
  }
}

/**
 * Refresh OAuth tokens automatically using the refresh token
 * POST /oauth/claude/refresh
 * Internal API - called by sandbox-executor when access token expires
 *
 * Returns:
 * - 200: Successfully refreshed, new credentials stored
 * - 401: Refresh token is invalid/expired (human intervention needed)
 * - 404: No credentials stored
 * - 500: Other errors
 */
export async function refreshOAuthCredentials(
  request: Request,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    // Check for internal API key or regular API key
    const internalKey = request.headers.get('X-Internal-Key');
    const hasInternalAccess = internalKey && env.PROVIDER_KEYS &&
      await env.PROVIDER_KEYS.get('internal_api_key') === internalKey;
    const hasApiKeyAccess = await validateApiKey(request, env);

    if (!hasInternalAccess && !hasApiKeyAccess) {
      return errorResponse('Forbidden', 403, requestId);
    }

    if (!env.PROVIDER_KEYS) {
      return errorResponse('Credential storage not configured', 500, requestId);
    }

    // Get current credentials
    const storedValue = await env.PROVIDER_KEYS.get(OAUTH_KV_KEY);
    if (!storedValue) {
      return errorResponse('No OAuth credentials configured', 404, requestId);
    }

    // Decrypt if needed
    let credentialsJson = storedValue;
    if (env.ENCRYPTION_KEY && storedValue.includes(':')) {
      try {
        credentialsJson = await decrypt(storedValue, env.ENCRYPTION_KEY);
      } catch (e) {
        console.error('Decryption failed:', e);
        return errorResponse('Failed to decrypt credentials', 500, requestId);
      }
    }

    // Parse credentials
    let creds: OAuthCredentials;
    try {
      creds = JSON.parse(credentialsJson);
    } catch (e) {
      return errorResponse('Invalid stored credentials format', 500, requestId);
    }

    // Extract refresh token (handle both formats)
    const refreshToken = creds.claudeAiOauth?.refreshToken || creds.refreshToken;
    if (!refreshToken) {
      return errorResponse('No refresh token available', 400, requestId);
    }

    // Call Anthropic's token endpoint to refresh
    console.log('Attempting to refresh OAuth token...');
    const tokenResponse = await fetch(ANTHROPIC_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLAUDE_OAUTH_CLIENT_ID,
        refresh_token: refreshToken,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token refresh failed:', tokenResponse.status, errorText);

      // 401/403 means refresh token is invalid - human intervention needed
      if (tokenResponse.status === 401 || tokenResponse.status === 403 ||
          errorText.includes('invalid_grant')) {
        return errorResponse(
          'Refresh token expired or invalid - manual re-authentication required',
          401,
          requestId
        );
      }

      return errorResponse(`Token refresh failed: ${errorText}`, 500, requestId);
    }

    // Parse new tokens
    const newTokens = await tokenResponse.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
    };

    // Calculate new expiration
    const expiresIn = newTokens.expires_in || 28800; // Default 8 hours
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Update credentials with new tokens
    if (creds.claudeAiOauth) {
      creds.claudeAiOauth.accessToken = newTokens.access_token;
      if (newTokens.refresh_token) {
        creds.claudeAiOauth.refreshToken = newTokens.refresh_token;
      }
      creds.claudeAiOauth.expiresAt = expiresAt;
    } else {
      creds.accessToken = newTokens.access_token;
      if (newTokens.refresh_token) {
        creds.refreshToken = newTokens.refresh_token;
      }
      creds.expiresAt = expiresAt;
    }

    // Store updated credentials
    const updatedJson = JSON.stringify(creds);
    let valueToStore = updatedJson;
    if (env.ENCRYPTION_KEY) {
      valueToStore = await encrypt(updatedJson, env.ENCRYPTION_KEY);
    }

    const now = new Date().toISOString();
    await env.PROVIDER_KEYS.put(OAUTH_KV_KEY, valueToStore, {
      metadata: {
        expires_at: expiresAt,
        updated_at: now,
        provider: 'claude_max',
        auto_refreshed: true,
      },
    });

    console.log('OAuth token refreshed successfully, expires at:', expiresAt);

    return successResponse({
      refreshed: true,
      expires_at: expiresAt,
      updated_at: now,
    }, requestId);
  } catch (error) {
    console.error('Error refreshing OAuth credentials:', error);
    return errorResponse('Failed to refresh credentials', 500, requestId);
  }
}
