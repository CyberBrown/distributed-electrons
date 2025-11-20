/**
 * Authentication Middleware
 *
 * Validates API keys, loads user context, and attaches authentication
 * information to the request context for use by downstream handlers.
 */

import {
  extractApiKey,
  hashApiKey,
  sanitizeKeyForLogging,
} from './key-manager';
import {
  AuthResult,
  AuthContext,
  User,
  InstanceAccess,
  PermissionLevel,
} from './types';

/**
 * Cloudflare environment bindings
 */
export interface Env {
  DB: D1Database;
  // Add other bindings as needed
  ENVIRONMENT?: string;
}

/**
 * Authentication middleware options
 */
export interface AuthMiddlewareOptions {
  /**
   * Allow test keys in non-production environments
   */
  allowTestKeys?: boolean;

  /**
   * Custom error messages
   */
  errorMessages?: {
    noAuth?: string;
    invalidKey?: string;
    inactiveUser?: string;
  };
}

/**
 * Default error messages
 */
const DEFAULT_ERROR_MESSAGES = {
  noAuth: 'Authorization header required',
  invalidKey: 'Invalid API key',
  inactiveUser: 'User account is inactive',
};

/**
 * Main authentication middleware function
 *
 * @param request - Incoming HTTP request
 * @param env - Cloudflare environment bindings
 * @param options - Middleware configuration options
 * @returns Authentication result with user context
 */
export async function authMiddleware(
  request: Request,
  env: Env,
  options: AuthMiddlewareOptions = {}
): Promise<AuthResult> {
  const errorMessages = { ...DEFAULT_ERROR_MESSAGES, ...options.errorMessages };

  try {
    // Extract Authorization header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return {
        authorized: false,
        error: errorMessages.noAuth,
      };
    }

    // Extract and validate API key format
    const apiKey = extractApiKey(authHeader);
    if (!apiKey) {
      return {
        authorized: false,
        error: errorMessages.invalidKey,
      };
    }

    // Check if test keys are allowed in this environment
    if (apiKey.startsWith('sk_test_')) {
      const isProd = env.ENVIRONMENT === 'production';
      if (isProd && !options.allowTestKeys) {
        return {
          authorized: false,
          error: 'Test keys not allowed in production',
        };
      }
    }

    // Hash the API key for database lookup
    const keyHash = await hashApiKey(apiKey);

    // Look up user by API key hash
    const user = await findUserByKeyHash(env.DB, keyHash);
    if (!user) {
      // Log failed attempt (with sanitized key)
      console.warn(
        `Failed auth attempt with key: ${sanitizeKeyForLogging(apiKey)}`
      );

      return {
        authorized: false,
        error: errorMessages.invalidKey,
      };
    }

    // Check if user is active
    if (!user.isActive) {
      console.warn(`Inactive user attempted access: ${user.id}`);

      return {
        authorized: false,
        error: errorMessages.inactiveUser,
      };
    }

    // Load user's instance access
    const instances = await loadUserInstances(env.DB, user.id);

    // Build permissions map
    const permissions = buildPermissionsMap(instances);

    // Return successful authentication
    return {
      authorized: true,
      user,
      instances,
      permissions,
    };
  } catch (error) {
    // Log error but don't expose details to client
    console.error('Authentication error:', error);

    return {
      authorized: false,
      error: 'Authentication failed',
    };
  }
}

/**
 * Find user by API key hash in database
 */
async function findUserByKeyHash(
  db: D1Database,
  keyHash: string
): Promise<User | null> {
  const result = await db
    .prepare(
      `
      SELECT
        id,
        email,
        name,
        api_key_hash as apiKeyHash,
        created_at as createdAt,
        updated_at as updatedAt,
        is_active as isActive
      FROM users
      WHERE api_key_hash = ?
      LIMIT 1
    `
    )
    .bind(keyHash)
    .first<User>();

  return result || null;
}

/**
 * Load all instances the user has access to
 */
async function loadUserInstances(
  db: D1Database,
  userId: string
): Promise<InstanceAccess[]> {
  const result = await db
    .prepare(
      `
      SELECT
        user_id as userId,
        instance_id as instanceId,
        role,
        granted_at as grantedAt
      FROM instance_access
      WHERE user_id = ?
      ORDER BY granted_at DESC
    `
    )
    .bind(userId)
    .all<InstanceAccess>();

  return result.results || [];
}

/**
 * Build a permissions map from instance access records
 */
function buildPermissionsMap(
  instances: InstanceAccess[]
): Map<string, PermissionLevel> {
  const permissionsMap = new Map<string, PermissionLevel>();

  for (const access of instances) {
    permissionsMap.set(access.instanceId, access.role as PermissionLevel);
  }

  return permissionsMap;
}

/**
 * Helper function to create an authenticated context
 * Useful for testing or when auth is already verified
 */
export function createAuthContext(
  user: User,
  instances: InstanceAccess[]
): AuthContext {
  return {
    user,
    instances,
    permissions: buildPermissionsMap(instances),
  };
}

/**
 * Middleware wrapper for Cloudflare Workers fetch handler
 * Returns both the auth result and a Response if authentication fails
 */
export async function authMiddlewareWrapper(
  request: Request,
  env: Env,
  options: AuthMiddlewareOptions = {}
): Promise<{ auth: AuthResult; response?: Response }> {
  const auth = await authMiddleware(request, env, options);

  if (!auth.authorized) {
    return {
      auth,
      response: new Response(
        JSON.stringify({
          error: auth.error || 'Unauthorized',
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      ),
    };
  }

  return { auth };
}

/**
 * Extract auth context from a successful auth result
 * Throws if not authorized
 */
export function requireAuth(authResult: AuthResult): AuthContext {
  if (!authResult.authorized || !authResult.user || !authResult.instances) {
    throw new Error('Authentication required');
  }

  return {
    user: authResult.user,
    instances: authResult.instances,
    permissions: authResult.permissions || new Map(),
  };
}
