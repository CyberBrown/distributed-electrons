/**
 * Middleware Tests
 *
 * Tests for authentication middleware
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  authMiddleware,
  authMiddlewareWrapper,
  requireAuth,
  createAuthContext,
  type Env,
} from '@/infrastructure/auth/middleware';
import { generateApiKey, hashApiKey } from '@/infrastructure/auth/key-manager';
import type { User, InstanceAccess } from '@/infrastructure/auth/types';

// Mock D1 Database
class MockD1Database {
  private users: Map<string, User> = new Map();
  private instanceAccess: Map<string, InstanceAccess[]> = new Map();

  addUser(user: User) {
    this.users.set(user.apiKeyHash, user);
  }

  addInstanceAccess(userId: string, access: InstanceAccess) {
    const existing = this.instanceAccess.get(userId) || [];
    this.instanceAccess.set(userId, [...existing, access]);
  }

  prepare(query: string) {
    return {
      bind: (...params: unknown[]) => {
        return {
          first: async <T>(): Promise<T | null> => {
            // User lookup query
            if (query.includes('FROM users')) {
              const keyHash = params[0] as string;
              return (this.users.get(keyHash) as T) || null;
            }
            return null;
          },
          all: async <T>(): Promise<{ results: T[] }> => {
            // Instance access query
            if (query.includes('FROM instance_access')) {
              const userId = params[0] as string;
              const results = this.instanceAccess.get(userId) || [];
              return { results: results as T[] };
            }
            return { results: [] };
          },
        };
      },
    };
  }
}

describe('Authentication Middleware', () => {
  let mockDb: MockD1Database;
  let env: Env;
  let validApiKey: string;
  let validKeyHash: string;
  let mockUser: User;

  beforeEach(async () => {
    // Setup mock database
    mockDb = new MockD1Database();

    // Generate test API key
    validApiKey = await generateApiKey();
    validKeyHash = await hashApiKey(validApiKey);

    // Create mock user
    mockUser = {
      id: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
      apiKeyHash: validKeyHash,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: true,
    };

    // Add user to mock database
    mockDb.addUser(mockUser);

    // Add instance access
    mockDb.addInstanceAccess(mockUser.id, {
      userId: mockUser.id,
      instanceId: 'instance-1',
      role: 'owner',
      grantedAt: new Date().toISOString(),
    });

    mockDb.addInstanceAccess(mockUser.id, {
      userId: mockUser.id,
      instanceId: 'instance-2',
      role: 'admin',
      grantedAt: new Date().toISOString(),
    });

    // Setup environment
    env = {
      DB: mockDb as unknown as D1Database,
      ENVIRONMENT: 'development',
    };
  });

  describe('authMiddleware', () => {
    it('should authenticate valid API key', async () => {
      const request = new Request('https://example.com/api', {
        headers: {
          Authorization: `Bearer ${validApiKey}`,
        },
      });

      const result = await authMiddleware(request, env);

      expect(result.authorized).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.user?.id).toBe(mockUser.id);
      expect(result.user?.email).toBe(mockUser.email);
      expect(result.instances).toBeDefined();
      expect(result.instances?.length).toBe(2);
    });

    it('should build permissions map correctly', async () => {
      const request = new Request('https://example.com/api', {
        headers: {
          Authorization: `Bearer ${validApiKey}`,
        },
      });

      const result = await authMiddleware(request, env);

      expect(result.permissions).toBeDefined();
      expect(result.permissions?.get('instance-1')).toBe('owner');
      expect(result.permissions?.get('instance-2')).toBe('admin');
    });

    it('should reject request without Authorization header', async () => {
      const request = new Request('https://example.com/api');

      const result = await authMiddleware(request, env);

      expect(result.authorized).toBe(false);
      expect(result.error).toBe('Authorization header required');
    });

    it('should reject invalid API key format', async () => {
      const request = new Request('https://example.com/api', {
        headers: {
          Authorization: 'Bearer invalid-key',
        },
      });

      const result = await authMiddleware(request, env);

      expect(result.authorized).toBe(false);
      expect(result.error).toBe('Invalid API key');
    });

    it('should reject unknown API key', async () => {
      const unknownKey = await generateApiKey();

      const request = new Request('https://example.com/api', {
        headers: {
          Authorization: `Bearer ${unknownKey}`,
        },
      });

      const result = await authMiddleware(request, env);

      expect(result.authorized).toBe(false);
      expect(result.error).toBe('Invalid API key');
    });

    it('should reject inactive user', async () => {
      // Create inactive user
      const inactiveKey = await generateApiKey();
      const inactiveKeyHash = await hashApiKey(inactiveKey);

      const inactiveUser: User = {
        id: 'user-inactive',
        email: 'inactive@example.com',
        name: 'Inactive User',
        apiKeyHash: inactiveKeyHash,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isActive: false, // Inactive
      };

      mockDb.addUser(inactiveUser);

      const request = new Request('https://example.com/api', {
        headers: {
          Authorization: `Bearer ${inactiveKey}`,
        },
      });

      const result = await authMiddleware(request, env);

      expect(result.authorized).toBe(false);
      expect(result.error).toBe('User account is inactive');
    });

    it('should accept API key without Bearer prefix', async () => {
      const request = new Request('https://example.com/api', {
        headers: {
          Authorization: validApiKey,
        },
      });

      const result = await authMiddleware(request, env);

      expect(result.authorized).toBe(true);
    });

    it('should reject test keys in production when not allowed', async () => {
      const testKey = 'sk_test_' + 'a'.repeat(64);

      const prodEnv: Env = {
        DB: mockDb as unknown as D1Database,
        ENVIRONMENT: 'production',
      };

      const request = new Request('https://example.com/api', {
        headers: {
          Authorization: `Bearer ${testKey}`,
        },
      });

      const result = await authMiddleware(request, prodEnv);

      expect(result.authorized).toBe(false);
      expect(result.error).toBe('Test keys not allowed in production');
    });

    it('should allow test keys in production when explicitly allowed', async () => {
      const testKey = 'sk_test_' + 'a'.repeat(64);
      const testKeyHash = await hashApiKey(testKey);

      const testUser: User = {
        id: 'user-test',
        email: 'test@example.com',
        name: 'Test User',
        apiKeyHash: testKeyHash,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isActive: true,
      };

      mockDb.addUser(testUser);

      const prodEnv: Env = {
        DB: mockDb as unknown as D1Database,
        ENVIRONMENT: 'production',
      };

      const request = new Request('https://example.com/api', {
        headers: {
          Authorization: `Bearer ${testKey}`,
        },
      });

      const result = await authMiddleware(request, prodEnv, {
        allowTestKeys: true,
      });

      expect(result.authorized).toBe(true);
    });

    it('should use custom error messages when provided', async () => {
      const request = new Request('https://example.com/api');

      const result = await authMiddleware(request, env, {
        errorMessages: {
          noAuth: 'Custom: No auth header',
        },
      });

      expect(result.authorized).toBe(false);
      expect(result.error).toBe('Custom: No auth header');
    });
  });

  describe('authMiddlewareWrapper', () => {
    it('should return auth result without response for valid auth', async () => {
      const request = new Request('https://example.com/api', {
        headers: {
          Authorization: `Bearer ${validApiKey}`,
        },
      });

      const { auth, response } = await authMiddlewareWrapper(request, env);

      expect(auth.authorized).toBe(true);
      expect(response).toBeUndefined();
    });

    it('should return 401 response for invalid auth', async () => {
      const request = new Request('https://example.com/api');

      const { auth, response } = await authMiddlewareWrapper(request, env);

      expect(auth.authorized).toBe(false);
      expect(response).toBeDefined();
      expect(response?.status).toBe(401);

      const body = await response?.json();
      expect(body).toHaveProperty('error');
    });

    it('should return JSON error response with correct content type', async () => {
      const request = new Request('https://example.com/api');

      const { response } = await authMiddlewareWrapper(request, env);

      expect(response?.headers.get('Content-Type')).toBe('application/json');
    });
  });

  describe('requireAuth', () => {
    it('should return auth context for authorized result', async () => {
      const request = new Request('https://example.com/api', {
        headers: {
          Authorization: `Bearer ${validApiKey}`,
        },
      });

      const authResult = await authMiddleware(request, env);
      const authContext = requireAuth(authResult);

      expect(authContext.user).toBeDefined();
      expect(authContext.instances).toBeDefined();
      expect(authContext.permissions).toBeDefined();
    });

    it('should throw error for unauthorized result', async () => {
      const request = new Request('https://example.com/api');

      const authResult = await authMiddleware(request, env);

      expect(() => requireAuth(authResult)).toThrow('Authentication required');
    });
  });

  describe('createAuthContext', () => {
    it('should create auth context from user and instances', () => {
      const instances: InstanceAccess[] = [
        {
          userId: mockUser.id,
          instanceId: 'inst1',
          role: 'owner',
          grantedAt: new Date().toISOString(),
        },
        {
          userId: mockUser.id,
          instanceId: 'inst2',
          role: 'admin',
          grantedAt: new Date().toISOString(),
        },
      ];

      const authContext = createAuthContext(mockUser, instances);

      expect(authContext.user).toBe(mockUser);
      expect(authContext.instances).toBe(instances);
      expect(authContext.permissions.size).toBe(2);
      expect(authContext.permissions.get('inst1')).toBe('owner');
      expect(authContext.permissions.get('inst2')).toBe('admin');
    });

    it('should create auth context with empty instances', () => {
      const authContext = createAuthContext(mockUser, []);

      expect(authContext.user).toBe(mockUser);
      expect(authContext.instances).toEqual([]);
      expect(authContext.permissions.size).toBe(0);
    });
  });
});
