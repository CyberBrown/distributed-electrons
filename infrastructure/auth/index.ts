/**
 * Authentication Module
 *
 * Central export point for authentication functionality
 */

// Export middleware functions
export {
  authMiddleware,
  authMiddlewareWrapper,
  requireAuth,
  createAuthContext,
  type Env,
  type AuthMiddlewareOptions,
} from './middleware';

// Export key management functions
export {
  generateApiKey,
  generateTestApiKey,
  isValidKeyFormat,
  hashApiKey,
  verifyApiKey,
  isTestKey,
  isLiveKey,
  extractApiKey,
  sanitizeKeyForLogging,
  generateKeyPair,
} from './key-manager';

// Export types and permission functions
export {
  type User,
  type InstanceAccess,
  type AuthContext,
  type AuthResult,
  PermissionLevel,
  hasInstanceAccess,
  getPermissionLevel,
  hasPermission,
  isOwner,
  isAdmin,
  canRead,
  canWrite,
  getUserInstances,
  getInstancesWithPermission,
} from './types';
