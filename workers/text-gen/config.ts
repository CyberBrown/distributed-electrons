/**
 * Configuration module for Text Generation Worker
 * Fetches instance config and model configs from Config Service
 * Retrieves encrypted provider API keys from KV
 */

import type { Env, InstanceConfig, ModelConfig } from './types';

/**
 * Decrypt a value using AES-GCM
 */
async function decrypt(encryptedData: string, keyString: string): Promise<string> {
  try {
    // Parse the encrypted data (format: iv:ciphertext, both base64)
    const [ivBase64, ciphertextBase64] = encryptedData.split(':');
    if (!ivBase64 || !ciphertextBase64) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));
    const ciphertext = Uint8Array.from(atob(ciphertextBase64), c => c.charCodeAt(0));

    // Import the encryption key
    const keyData = Uint8Array.from(atob(keyString), c => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Encrypt a value using AES-GCM
 */
export async function encrypt(plaintext: string, keyString: string): Promise<string> {
  try {
    // Generate random IV
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Import the encryption key
    const keyData = Uint8Array.from(atob(keyString), c => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );

    // Encrypt
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      encoded
    );

    // Return as iv:ciphertext (both base64)
    const ivBase64 = btoa(String.fromCharCode(...iv));
    const ciphertextBase64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));

    return `${ivBase64}:${ciphertextBase64}`;
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Get provider API key from KV storage
 * Keys are stored encrypted with format: provider_keys:{instance_id}:{provider}
 */
export async function getProviderApiKey(
  instanceId: string,
  provider: string,
  env: Env
): Promise<string | null> {
  const kvKey = `provider_keys:${instanceId}:${provider}`;

  try {
    const encryptedKey = await env.PROVIDER_KEYS.get(kvKey);

    if (!encryptedKey) {
      // Fallback to environment variable for development
      const envKey = getEnvApiKey(provider, env);
      if (envKey) {
        console.log(`Using fallback env API key for ${provider}`);
        return envKey;
      }
      return null;
    }

    // If we have an encryption key, decrypt
    if (env.ENCRYPTION_KEY) {
      return await decrypt(encryptedKey, env.ENCRYPTION_KEY);
    }

    // If no encryption key, assume the value is stored plaintext (development mode)
    console.warn('ENCRYPTION_KEY not set, using plaintext key storage');
    return encryptedKey;
  } catch (error) {
    console.error(`Error retrieving API key for ${provider}:`, error);

    // Fallback to environment variable
    const envKey = getEnvApiKey(provider, env);
    if (envKey) {
      console.log(`Using fallback env API key for ${provider} after error`);
      return envKey;
    }
    return null;
  }
}

/**
 * Store provider API key in KV storage (encrypted)
 */
export async function storeProviderApiKey(
  instanceId: string,
  provider: string,
  apiKey: string,
  env: Env
): Promise<void> {
  const kvKey = `provider_keys:${instanceId}:${provider}`;

  let valueToStore = apiKey;

  // Encrypt if we have an encryption key
  if (env.ENCRYPTION_KEY) {
    valueToStore = await encrypt(apiKey, env.ENCRYPTION_KEY);
  } else {
    console.warn('ENCRYPTION_KEY not set, storing plaintext key (not recommended for production)');
  }

  await env.PROVIDER_KEYS.put(kvKey, valueToStore);
}

/**
 * Get fallback API key from environment
 */
function getEnvApiKey(provider: string, env: Env): string | undefined {
  const keyMap: Record<string, keyof Env> = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
  };

  const key = keyMap[provider.toLowerCase()];
  return key ? (env[key] as string | undefined) : undefined;
}

/**
 * Fetch instance configuration from Config Service
 */
export async function getInstanceConfig(
  instanceId: string,
  env: Env
): Promise<InstanceConfig | null> {
  const configServiceUrl = env.CONFIG_SERVICE_URL || 'https://api.your-domain.com';

  try {
    const response = await fetch(`${configServiceUrl}/instance/${instanceId}`, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      console.error(`Config service error: ${response.status} ${response.statusText}`);
      return null;
    }

    const result = await response.json() as { data?: InstanceConfig };
    return result.data || null;
  } catch (error) {
    console.error('Error fetching instance config:', error);
    return null;
  }
}

/**
 * Fetch model configuration from Config Service
 */
export async function getModelConfig(
  modelId: string,
  env: Env
): Promise<ModelConfig | null> {
  const configServiceUrl = env.CONFIG_SERVICE_URL || 'https://api.your-domain.com';

  try {
    const response = await fetch(`${configServiceUrl}/model-config/${modelId}`, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`Model config not found for ${modelId}`);
        return null;
      }
      console.error(`Config service error: ${response.status} ${response.statusText}`);
      return null;
    }

    const result = await response.json() as { data?: ModelConfig };
    return result.data || null;
  } catch (error) {
    console.error(`Error fetching model config for ${modelId}:`, error);
    return null;
  }
}

/**
 * List available models from Config Service
 */
export async function listModels(
  env: Env,
  filters?: { provider_id?: string; status?: string }
): Promise<ModelConfig[]> {
  const configServiceUrl = env.CONFIG_SERVICE_URL || 'https://api.your-domain.com';

  try {
    const params = new URLSearchParams();
    if (filters?.provider_id) params.set('provider_id', filters.provider_id);
    if (filters?.status) params.set('status', filters.status);

    const url = `${configServiceUrl}/model-config${params.toString() ? '?' + params.toString() : ''}`;

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`Config service error: ${response.status} ${response.statusText}`);
      return [];
    }

    const result = await response.json() as { data?: { configs: ModelConfig[] } };
    return result.data?.configs || [];
  } catch (error) {
    console.error('Error listing models:', error);
    return [];
  }
}
