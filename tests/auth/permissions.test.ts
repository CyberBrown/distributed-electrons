/**
 * Permissions Tests
 *
 * Tests for permission checking functions
 */

import { describe, it, expect } from 'vitest';
import {
  AuthContext,
  User,
  InstanceAccess,
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
} from '@/infrastructure/auth/types';

// Helper function to create mock user
function createMockUser(id: string): User {
  return {
    id,
    email: `user${id}@example.com`,
    name: `User ${id}`,
    apiKeyHash: 'hash123',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isActive: true,
  };
}

// Helper function to create mock instance access
function createMockAccess(
  userId: string,
  instanceId: string,
  role: string
): InstanceAccess {
  return {
    userId,
    instanceId,
    role: role as 'owner' | 'admin' | 'user' | 'readonly',
    grantedAt: new Date().toISOString(),
  };
}

// Helper function to create auth context
function createAuthContext(
  userId: string,
  accesses: Array<{ instanceId: string; role: string }>
): AuthContext {
  const user = createMockUser(userId);
  const instances = accesses.map(a =>
    createMockAccess(userId, a.instanceId, a.role)
  );
  const permissions = new Map<string, PermissionLevel>();

  instances.forEach(access => {
    permissions.set(access.instanceId, access.role as PermissionLevel);
  });

  return { user, instances, permissions };
}

describe('Permission Functions', () => {
  describe('hasInstanceAccess', () => {
    it('should return true when user has access to instance', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'user' },
      ]);

      expect(hasInstanceAccess(auth, 'inst1')).toBe(true);
    });

    it('should return false when user does not have access', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'user' },
      ]);

      expect(hasInstanceAccess(auth, 'inst2')).toBe(false);
    });

    it('should work with multiple instances', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'owner' },
        { instanceId: 'inst2', role: 'admin' },
        { instanceId: 'inst3', role: 'user' },
      ]);

      expect(hasInstanceAccess(auth, 'inst1')).toBe(true);
      expect(hasInstanceAccess(auth, 'inst2')).toBe(true);
      expect(hasInstanceAccess(auth, 'inst3')).toBe(true);
      expect(hasInstanceAccess(auth, 'inst4')).toBe(false);
    });
  });

  describe('getPermissionLevel', () => {
    it('should return correct permission level for owner', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'owner' },
      ]);

      expect(getPermissionLevel(auth, 'inst1')).toBe(PermissionLevel.OWNER);
    });

    it('should return correct permission level for admin', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'admin' },
      ]);

      expect(getPermissionLevel(auth, 'inst1')).toBe(PermissionLevel.ADMIN);
    });

    it('should return correct permission level for user', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'user' },
      ]);

      expect(getPermissionLevel(auth, 'inst1')).toBe(PermissionLevel.USER);
    });

    it('should return correct permission level for readonly', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'readonly' },
      ]);

      expect(getPermissionLevel(auth, 'inst1')).toBe(
        PermissionLevel.READONLY
      );
    });

    it('should return null for non-existent instance', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'user' },
      ]);

      expect(getPermissionLevel(auth, 'inst2')).toBeNull();
    });
  });

  describe('hasPermission', () => {
    it('should allow owner to access owner-level resources', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'owner' },
      ]);

      expect(hasPermission(auth, 'inst1', PermissionLevel.OWNER)).toBe(true);
    });

    it('should allow owner to access lower-level resources', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'owner' },
      ]);

      expect(hasPermission(auth, 'inst1', PermissionLevel.ADMIN)).toBe(true);
      expect(hasPermission(auth, 'inst1', PermissionLevel.USER)).toBe(true);
      expect(hasPermission(auth, 'inst1', PermissionLevel.READONLY)).toBe(
        true
      );
    });

    it('should not allow admin to access owner-level resources', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'admin' },
      ]);

      expect(hasPermission(auth, 'inst1', PermissionLevel.OWNER)).toBe(false);
    });

    it('should allow admin to access admin and lower-level resources', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'admin' },
      ]);

      expect(hasPermission(auth, 'inst1', PermissionLevel.ADMIN)).toBe(true);
      expect(hasPermission(auth, 'inst1', PermissionLevel.USER)).toBe(true);
      expect(hasPermission(auth, 'inst1', PermissionLevel.READONLY)).toBe(
        true
      );
    });

    it('should not allow user to access admin resources', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'user' },
      ]);

      expect(hasPermission(auth, 'inst1', PermissionLevel.ADMIN)).toBe(false);
      expect(hasPermission(auth, 'inst1', PermissionLevel.OWNER)).toBe(false);
    });

    it('should allow user to access user and readonly resources', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'user' },
      ]);

      expect(hasPermission(auth, 'inst1', PermissionLevel.USER)).toBe(true);
      expect(hasPermission(auth, 'inst1', PermissionLevel.READONLY)).toBe(
        true
      );
    });

    it('should only allow readonly users to access readonly resources', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'readonly' },
      ]);

      expect(hasPermission(auth, 'inst1', PermissionLevel.READONLY)).toBe(
        true
      );
      expect(hasPermission(auth, 'inst1', PermissionLevel.USER)).toBe(false);
      expect(hasPermission(auth, 'inst1', PermissionLevel.ADMIN)).toBe(false);
      expect(hasPermission(auth, 'inst1', PermissionLevel.OWNER)).toBe(false);
    });

    it('should return false for non-existent instance', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'owner' },
      ]);

      expect(hasPermission(auth, 'inst2', PermissionLevel.READONLY)).toBe(
        false
      );
    });
  });

  describe('isOwner', () => {
    it('should return true for owners', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'owner' },
      ]);

      expect(isOwner(auth, 'inst1')).toBe(true);
    });

    it('should return false for non-owners', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'admin' },
        { instanceId: 'inst2', role: 'user' },
        { instanceId: 'inst3', role: 'readonly' },
      ]);

      expect(isOwner(auth, 'inst1')).toBe(false);
      expect(isOwner(auth, 'inst2')).toBe(false);
      expect(isOwner(auth, 'inst3')).toBe(false);
    });
  });

  describe('isAdmin', () => {
    it('should return true for admins', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'admin' },
      ]);

      expect(isAdmin(auth, 'inst1')).toBe(true);
    });

    it('should return true for owners (higher permission)', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'owner' },
      ]);

      expect(isAdmin(auth, 'inst1')).toBe(true);
    });

    it('should return false for users and readonly', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'user' },
        { instanceId: 'inst2', role: 'readonly' },
      ]);

      expect(isAdmin(auth, 'inst1')).toBe(false);
      expect(isAdmin(auth, 'inst2')).toBe(false);
    });
  });

  describe('canRead', () => {
    it('should return true for all permission levels', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'owner' },
        { instanceId: 'inst2', role: 'admin' },
        { instanceId: 'inst3', role: 'user' },
        { instanceId: 'inst4', role: 'readonly' },
      ]);

      expect(canRead(auth, 'inst1')).toBe(true);
      expect(canRead(auth, 'inst2')).toBe(true);
      expect(canRead(auth, 'inst3')).toBe(true);
      expect(canRead(auth, 'inst4')).toBe(true);
    });

    it('should return false for non-existent instance', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'owner' },
      ]);

      expect(canRead(auth, 'inst2')).toBe(false);
    });
  });

  describe('canWrite', () => {
    it('should return true for user, admin, and owner', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'owner' },
        { instanceId: 'inst2', role: 'admin' },
        { instanceId: 'inst3', role: 'user' },
      ]);

      expect(canWrite(auth, 'inst1')).toBe(true);
      expect(canWrite(auth, 'inst2')).toBe(true);
      expect(canWrite(auth, 'inst3')).toBe(true);
    });

    it('should return false for readonly', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'readonly' },
      ]);

      expect(canWrite(auth, 'inst1')).toBe(false);
    });

    it('should return false for non-existent instance', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'owner' },
      ]);

      expect(canWrite(auth, 'inst2')).toBe(false);
    });
  });

  describe('getUserInstances', () => {
    it('should return all instance IDs user has access to', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'owner' },
        { instanceId: 'inst2', role: 'admin' },
        { instanceId: 'inst3', role: 'user' },
      ]);

      const instances = getUserInstances(auth);
      expect(instances).toEqual(['inst1', 'inst2', 'inst3']);
    });

    it('should return empty array for no instances', () => {
      const auth = createAuthContext('user1', []);
      const instances = getUserInstances(auth);
      expect(instances).toEqual([]);
    });
  });

  describe('getInstancesWithPermission', () => {
    it('should return only instances with required permission or higher', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'owner' },
        { instanceId: 'inst2', role: 'admin' },
        { instanceId: 'inst3', role: 'user' },
        { instanceId: 'inst4', role: 'readonly' },
      ]);

      const adminInstances = getInstancesWithPermission(
        auth,
        PermissionLevel.ADMIN
      );
      expect(adminInstances).toEqual(['inst1', 'inst2']);
    });

    it('should return all instances for readonly permission', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'owner' },
        { instanceId: 'inst2', role: 'admin' },
        { instanceId: 'inst3', role: 'user' },
        { instanceId: 'inst4', role: 'readonly' },
      ]);

      const allInstances = getInstancesWithPermission(
        auth,
        PermissionLevel.READONLY
      );
      expect(allInstances).toEqual(['inst1', 'inst2', 'inst3', 'inst4']);
    });

    it('should return only owner instances for owner permission', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'owner' },
        { instanceId: 'inst2', role: 'admin' },
        { instanceId: 'inst3', role: 'owner' },
      ]);

      const ownerInstances = getInstancesWithPermission(
        auth,
        PermissionLevel.OWNER
      );
      expect(ownerInstances).toEqual(['inst1', 'inst3']);
    });

    it('should return empty array when no instances match', () => {
      const auth = createAuthContext('user1', [
        { instanceId: 'inst1', role: 'readonly' },
        { instanceId: 'inst2', role: 'user' },
      ]);

      const adminInstances = getInstancesWithPermission(
        auth,
        PermissionLevel.ADMIN
      );
      expect(adminInstances).toEqual([]);
    });
  });
});
