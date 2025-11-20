/**
 * API Key Manager
 *
 * Handles API key generation, hashing, and validation for secure authentication.
 * Uses Web Crypto API (crypto.subtle) for cryptographic operations.
 */

/**
 * Generate a random API key
 * Format: sk_live_[32 random bytes in hex]
 */
export async function generateApiKey(): Promise<string> {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);

  const hexString = Array.from(randomBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return `sk_live_${hexString}`;
}

/**
 * Generate a test/development API key
 * Format: sk_test_[32 random bytes in hex]
 */
export async function generateTestApiKey(): Promise<string> {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);

  const hexString = Array.from(randomBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return `sk_test_${hexString}`;
}

/**
 * Validate API key format
 */
export function isValidKeyFormat(apiKey: string): boolean {
  // Check for valid prefix
  if (!apiKey.startsWith('sk_live_') && !apiKey.startsWith('sk_test_')) {
    return false;
  }

  // Extract the key part after prefix
  const keyPart = apiKey.split('_')[2];
  if (!keyPart) {
    return false;
  }

  // Should be 64 hex characters (32 bytes)
  const hexPattern = /^[0-9a-f]{64}$/i;
  return hexPattern.test(keyPart);
}

/**
 * Hash an API key using SHA-256
 * Returns hex-encoded hash string
 */
export async function hashApiKey(apiKey: string): Promise<string> {
  // Validate format before hashing
  if (!isValidKeyFormat(apiKey)) {
    throw new Error('Invalid API key format');
  }

  // Convert string to Uint8Array
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);

  // Hash using SHA-256
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}

/**
 * Verify an API key against a stored hash
 */
export async function verifyApiKey(
  apiKey: string,
  storedHash: string
): Promise<boolean> {
  try {
    // Hash the provided key
    const keyHash = await hashApiKey(apiKey);

    // Constant-time comparison to prevent timing attacks
    return constantTimeCompare(keyHash, storedHash);
  } catch (error) {
    // Invalid format or hashing error
    return false;
  }
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function constantTimeCompare(a: string, b: string): boolean {
  // If lengths differ, they're not equal
  // But still compare to maintain constant time
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Check if an API key is a test key
 */
export function isTestKey(apiKey: string): boolean {
  return apiKey.startsWith('sk_test_');
}

/**
 * Check if an API key is a live/production key
 */
export function isLiveKey(apiKey: string): boolean {
  return apiKey.startsWith('sk_live_');
}

/**
 * Extract API key from Authorization header
 * Supports both "Bearer {key}" and "{key}" formats
 */
export function extractApiKey(authHeader: string): string | null {
  if (!authHeader) {
    return null;
  }

  // Remove "Bearer " prefix if present
  const key = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  // Validate and return
  return isValidKeyFormat(key) ? key : null;
}

/**
 * Sanitize API key for logging (show only prefix and last 4 chars)
 */
export function sanitizeKeyForLogging(apiKey: string): string {
  if (!apiKey || apiKey.length < 12) {
    return '***';
  }

  const parts = apiKey.split('_');
  if (parts.length < 3) {
    return '***';
  }

  const prefix = `${parts[0]}_${parts[1]}`;
  const suffix = apiKey.slice(-4);

  return `${prefix}_...${suffix}`;
}

/**
 * Generate a key pair (key and its hash) for new users
 */
export async function generateKeyPair(): Promise<{
  apiKey: string;
  hash: string;
}> {
  const apiKey = await generateApiKey();
  const hash = await hashApiKey(apiKey);

  return { apiKey, hash };
}
