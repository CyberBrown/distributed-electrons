/**
 * Provider API Key Handlers
 * Manages encrypted storage and retrieval of provider API keys
 */

import { Env, ProviderKeyRequest, ProviderKeyResponse } from '../types';
import {
  errorResponse,
  successResponse,
  parseJsonBody,
  validateRequiredFields,
  generateRequestId,
} from '../utils';

// Supported providers
const SUPPORTED_PROVIDERS = ['openai', 'anthropic', 'google', 'ideogram', 'stability'];

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
 * Store a provider API key
 * POST /provider-key
 */
export async function storeProviderKey(
  request: Request,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    if (!env.PROVIDER_KEYS) {
      return errorResponse('Provider key storage not configured', 500, requestId);
    }

    const body = await parseJsonBody<ProviderKeyRequest>(request);

    const validation = validateRequiredFields(body, ['instance_id', 'provider', 'api_key']);
    if (!validation.valid) {
      return errorResponse(
        `Missing required fields: ${validation.missing?.join(', ')}`,
        400,
        requestId
      );
    }

    // Validate provider
    if (!SUPPORTED_PROVIDERS.includes(body.provider.toLowerCase())) {
      return errorResponse(
        `Unsupported provider: ${body.provider}. Supported: ${SUPPORTED_PROVIDERS.join(', ')}`,
        400,
        requestId
      );
    }

    // Verify instance exists
    const instance = await env.DB.prepare(
      'SELECT instance_id FROM instances WHERE instance_id = ?'
    )
      .bind(body.instance_id)
      .first();

    if (!instance) {
      return errorResponse('Instance not found', 404, requestId);
    }

    // Build KV key
    const kvKey = `provider_keys:${body.instance_id}:${body.provider.toLowerCase()}`;

    // Encrypt if we have an encryption key
    let valueToStore = body.api_key;
    if (env.ENCRYPTION_KEY) {
      valueToStore = await encrypt(body.api_key, env.ENCRYPTION_KEY);
    } else {
      console.warn('ENCRYPTION_KEY not set, storing plaintext (not recommended)');
    }

    // Store in KV
    await env.PROVIDER_KEYS.put(kvKey, valueToStore, {
      metadata: {
        instance_id: body.instance_id,
        provider: body.provider.toLowerCase(),
        updated_at: new Date().toISOString(),
      },
    });

    const response: ProviderKeyResponse = {
      instance_id: body.instance_id,
      provider: body.provider.toLowerCase(),
      configured: true,
      updated_at: new Date().toISOString(),
    };

    return successResponse(response, requestId);
  } catch (error) {
    console.error('Error storing provider key:', error);
    if ((error as Error).message === 'Invalid JSON body') {
      return errorResponse('Invalid JSON body', 400, requestId);
    }
    return errorResponse('Failed to store provider key', 500, requestId);
  }
}

/**
 * Check if a provider key is configured
 * GET /provider-key/{instance_id}/{provider}
 */
export async function getProviderKeyStatus(
  instanceId: string,
  provider: string,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    if (!env.PROVIDER_KEYS) {
      return errorResponse('Provider key storage not configured', 500, requestId);
    }

    const kvKey = `provider_keys:${instanceId}:${provider.toLowerCase()}`;
    const result = await env.PROVIDER_KEYS.getWithMetadata(kvKey);

    const response: ProviderKeyResponse = {
      instance_id: instanceId,
      provider: provider.toLowerCase(),
      configured: !!result.value,
      updated_at: (result.metadata as any)?.updated_at || '',
    };

    return successResponse(response, requestId);
  } catch (error) {
    console.error('Error checking provider key:', error);
    return errorResponse('Failed to check provider key status', 500, requestId);
  }
}

/**
 * Delete a provider key
 * DELETE /provider-key/{instance_id}/{provider}
 */
export async function deleteProviderKey(
  instanceId: string,
  provider: string,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    if (!env.PROVIDER_KEYS) {
      return errorResponse('Provider key storage not configured', 500, requestId);
    }

    const kvKey = `provider_keys:${instanceId}:${provider.toLowerCase()}`;
    await env.PROVIDER_KEYS.delete(kvKey);

    return successResponse({
      deleted: true,
      instance_id: instanceId,
      provider: provider.toLowerCase(),
    }, requestId);
  } catch (error) {
    console.error('Error deleting provider key:', error);
    return errorResponse('Failed to delete provider key', 500, requestId);
  }
}

/**
 * List configured providers for an instance
 * GET /provider-key/{instance_id}
 */
export async function listProviderKeys(
  instanceId: string,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    if (!env.PROVIDER_KEYS) {
      return errorResponse('Provider key storage not configured', 500, requestId);
    }

    // List all keys for this instance
    const prefix = `provider_keys:${instanceId}:`;
    const list = await env.PROVIDER_KEYS.list({ prefix });

    const providers = list.keys.map(key => ({
      provider: key.name.replace(prefix, ''),
      configured: true,
      updated_at: (key.metadata as any)?.updated_at || '',
    }));

    return successResponse({
      instance_id: instanceId,
      providers,
    }, requestId);
  } catch (error) {
    console.error('Error listing provider keys:', error);
    return errorResponse('Failed to list provider keys', 500, requestId);
  }
}
