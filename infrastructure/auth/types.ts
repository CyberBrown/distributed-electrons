/**
 * Authentication Types
 *
 * Core type definitions for the authentication system including
 * user context, permissions, and instance access control.
 */

/**
 * User entity from database
 */
export interface User {
  id: string;
  email: string;
  name: string;
  apiKeyHash: string;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
}

/**
 * Instance access record for a user
 */
export interface InstanceAccess {
  userId: string;
  instanceId: string;
  role: 'owner' | 'admin' | 'user' | 'readonly';
  grantedAt: string;
}

/**
 * Permission level enum
 */
export enum PermissionLevel {
  READONLY = 'readonly',
  USER = 'user',
  ADMIN = 'admin',
  OWNER = 'owner',
}

/**
 * Authentication context attached to requests
 */
export interface AuthContext {
  user: User;
  instances: InstanceAccess[];
  permissions: Map<string, PermissionLevel>;
}

/**
 * Result of authentication attempt
 */
export interface AuthResult {
  authorized: boolean;
  user?: User;
  instances?: InstanceAccess[];
  permissions?: Map<string, PermissionLevel>;
  error?: string;
}

/**
 * Permission hierarchy levels
 */
const PERMISSION_HIERARCHY: Record<PermissionLevel, number> = {
  [PermissionLevel.READONLY]: 1,
  [PermissionLevel.USER]: 2,
  [PermissionLevel.ADMIN]: 3,
  [PermissionLevel.OWNER]: 4,
};

/**
 * Check if user has access to a specific instance
 */
export function hasInstanceAccess(
  auth: AuthContext,
  instanceId: string
): boolean {
  return auth.instances.some(access => access.instanceId === instanceId);
}

/**
 * Get user's permission level for a specific instance
 */
export function getPermissionLevel(
  auth: AuthContext,
  instanceId: string
): PermissionLevel | null {
  const access = auth.instances.find(
    access => access.instanceId === instanceId
  );
  return access ? (access.role as PermissionLevel) : null;
}

/**
 * Check if user has at least the required permission level for an instance
 */
export function hasPermission(
  auth: AuthContext,
  instanceId: string,
  requiredLevel: PermissionLevel
): boolean {
  const userLevel = getPermissionLevel(auth, instanceId);
  if (!userLevel) {
    return false;
  }

  return (
    PERMISSION_HIERARCHY[userLevel] >= PERMISSION_HIERARCHY[requiredLevel]
  );
}

/**
 * Check if user is owner of an instance
 */
export function isOwner(auth: AuthContext, instanceId: string): boolean {
  return hasPermission(auth, instanceId, PermissionLevel.OWNER);
}

/**
 * Check if user is admin or owner of an instance
 */
export function isAdmin(auth: AuthContext, instanceId: string): boolean {
  return hasPermission(auth, instanceId, PermissionLevel.ADMIN);
}

/**
 * Check if user can read from an instance (any permission level)
 */
export function canRead(auth: AuthContext, instanceId: string): boolean {
  return hasPermission(auth, instanceId, PermissionLevel.READONLY);
}

/**
 * Check if user can write to an instance (user level or higher)
 */
export function canWrite(auth: AuthContext, instanceId: string): boolean {
  return hasPermission(auth, instanceId, PermissionLevel.USER);
}

/**
 * Get all instances user has access to
 */
export function getUserInstances(auth: AuthContext): string[] {
  return auth.instances.map(access => access.instanceId);
}

/**
 * Get all instances where user has at least the specified permission level
 */
export function getInstancesWithPermission(
  auth: AuthContext,
  minLevel: PermissionLevel
): string[] {
  return auth.instances
    .filter(access => {
      const level = access.role as PermissionLevel;
      return PERMISSION_HIERARCHY[level] >= PERMISSION_HIERARCHY[minLevel];
    })
    .map(access => access.instanceId);
}
