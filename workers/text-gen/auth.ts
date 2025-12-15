/**
 * Authentication module for Text Generation Worker
 * Validates instance API keys and retrieves instance configuration
 */

import type { Env, AuthResult } from './types';

/**
 * Validate API key format
 */
function isValidKeyFormat(apiKey: string): boolean {
  if (!apiKey.startsWith('sk_live_') && !apiKey.startsWith('sk_test_')) {
    return false;
  }
  const keyPart = apiKey.split('_')[2];
  if (!keyPart) return false;
  const hexPattern = /^[0-9a-f]{64}$/i;
  return hexPattern.test(keyPart);
}

/**
 * Hash an API key using SHA-256
 */
async function hashApiKey(apiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Extract API key from Authorization header
 */
export function extractApiKey(authHeader: string | null): string | null {
  if (!authHeader) return null;

  const key = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  return isValidKeyFormat(key) ? key : null;
}

/**
 * Authenticate request using instance API key
 * Returns the instance_id if valid, or an error
 */
export async function authenticateRequest(
  request: Request,
  env: Env
): Promise<AuthResult> {
  // Extract API key from Authorization header
  const authHeader = request.headers.get('Authorization');
  const apiKey = extractApiKey(authHeader);

  if (!apiKey) {
    return {
      authorized: false,
      error: 'Valid API key required. Format: sk_live_* or sk_test_*',
    };
  }

  try {
    // Hash the API key for database lookup
    const keyHash = await hashApiKey(apiKey);

    // Check if DB is available
    if (!env.DB) {
      return {
        authorized: false,
        error: 'Database not configured',
      };
    }

    // Look up the API key in the database
    // The api_keys table links keys to users/projects, and users have instance access
    const result = await env.DB.prepare(`
      SELECT
        ak.key_id,
        ak.user_id,
        ak.project_id,
        COALESCE(
          (SELECT instance_id FROM user_instance_access WHERE user_id = ak.user_id LIMIT 1),
          (SELECT instance_id FROM projects WHERE project_id = ak.project_id)
        ) as instance_id
      FROM api_keys ak
      WHERE ak.key_hash = ?
      AND (ak.expires_at IS NULL OR ak.expires_at > datetime('now'))
    `).bind(keyHash).first<{
      key_id: string;
      user_id: string | null;
      project_id: string | null;
      instance_id: string | null;
    }>();

    if (!result) {
      return {
        authorized: false,
        error: 'Invalid or expired API key',
      };
    }

    if (!result.instance_id) {
      return {
        authorized: false,
        error: 'No instance associated with this API key',
      };
    }

    return {
      authorized: true,
      instance_id: result.instance_id,
      user_id: result.user_id || result.project_id || undefined,
    };
  } catch (error) {
    console.error('Authentication error:', error);
    return {
      authorized: false,
      error: 'Authentication failed',
    };
  }
}

/**
 * Create unauthorized response
 */
export function unauthorizedResponse(error: string, requestId: string): Response {
  return Response.json(
    {
      error,
      error_code: 'UNAUTHORIZED',
      request_id: requestId,
    },
    {
      status: 401,
      headers: {
        'X-Request-ID': requestId,
        'WWW-Authenticate': 'Bearer',
      },
    }
  );
}
