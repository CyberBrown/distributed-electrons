import { describe, it, expect, beforeEach } from 'vitest';
import { MockD1Database } from '../mocks/d1-mock';
import {
  getUser,
  listUsers,
  getUserByEmail,
  createUser,
  updateUser,
  deleteUser,
} from '../../../infrastructure/config-service/handlers/user-handlers';
import { Env } from '../../../infrastructure/config-service/types';

describe('User Handlers', () => {
  let mockDB: MockD1Database;
  let env: Env;

  beforeEach(() => {
    mockDB = new MockD1Database();
    env = { DB: mockDB as any };
  });

  describe('createUser', () => {
    it('should create a new user', async () => {
      const requestBody = {
        org_id: 'org-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'admin',
      };

      const request = new Request('http://localhost/user', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await createUser(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toBeDefined();
      expect(data.data.org_id).toBe('org-123');
      expect(data.data.email).toBe('test@example.com');
      expect(data.data.name).toBe('Test User');
      expect(data.data.role).toBe('admin');
      expect(data.data.user_id).toBeDefined();
      expect(data.request_id).toBeDefined();
    });

    it('should default to user role if not specified', async () => {
      const requestBody = {
        org_id: 'org-123',
        email: 'test@example.com',
        name: 'Test User',
      };

      const request = new Request('http://localhost/user', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await createUser(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.role).toBe('user');
    });

    it('should return 400 for missing required fields', async () => {
      const requestBody = {
        org_id: 'org-123',
        // Missing 'email' and 'name'
      };

      const request = new Request('http://localhost/user', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await createUser(request, env);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Missing required fields');
    });

    it('should return 409 if user with email already exists', async () => {
      const existingUser = {
        user_id: 'user-123',
        org_id: 'org-123',
        email: 'test@example.com',
        name: 'Existing User',
        role: 'user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockDB._setData('users', [existingUser]);

      const requestBody = {
        org_id: 'org-123',
        email: 'test@example.com',
        name: 'New User',
      };

      const request = new Request('http://localhost/user', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await createUser(request, env);
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.error).toBe('User with this email already exists');
    });
  });

  describe('getUser', () => {
    it('should return a user by ID', async () => {
      const testUser = {
        user_id: 'user-123',
        org_id: 'org-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'admin',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockDB._setData('users', [testUser]);

      const response = await getUser('user-123', env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.user_id).toBe('user-123');
      expect(data.data.email).toBe('test@example.com');
    });

    it('should return 404 for non-existent user', async () => {
      const response = await getUser('non-existent', env);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('User not found');
    });
  });

  describe('getUserByEmail', () => {
    it('should return a user by email', async () => {
      const testUser = {
        user_id: 'user-123',
        org_id: 'org-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'admin',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockDB._setData('users', [testUser]);

      const response = await getUserByEmail('test@example.com', env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.email).toBe('test@example.com');
      expect(data.data.user_id).toBe('user-123');
    });

    it('should return 404 for non-existent email', async () => {
      const response = await getUserByEmail('nonexistent@example.com', env);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('User not found');
    });
  });

  describe('listUsers', () => {
    it('should list all users', async () => {
      const testUsers = [
        {
          user_id: 'user-1',
          org_id: 'org-123',
          email: 'user1@example.com',
          name: 'User 1',
          role: 'user',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          user_id: 'user-2',
          org_id: 'org-456',
          email: 'user2@example.com',
          name: 'User 2',
          role: 'admin',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      mockDB._setData('users', testUsers);

      const response = await listUsers(null, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toHaveLength(2);
    });

    it('should filter users by org_id', async () => {
      const testUsers = [
        {
          user_id: 'user-1',
          org_id: 'org-123',
          email: 'user1@example.com',
          name: 'User 1',
          role: 'user',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          user_id: 'user-2',
          org_id: 'org-456',
          email: 'user2@example.com',
          name: 'User 2',
          role: 'admin',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      mockDB._setData('users', testUsers);

      const response = await listUsers('org-123', env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].org_id).toBe('org-123');
    });
  });

  describe('updateUser', () => {
    it('should update an existing user', async () => {
      const testUser = {
        user_id: 'user-123',
        org_id: 'org-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockDB._setData('users', [testUser]);

      const requestBody = {
        name: 'Updated User',
        role: 'admin',
      };

      const request = new Request('http://localhost/user/user-123', {
        method: 'PUT',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await updateUser('user-123', request, env);
      expect(response.status).toBe(200);
    });

    it('should return 404 for non-existent user', async () => {
      const requestBody = {
        name: 'Updated User',
      };

      const request = new Request('http://localhost/user/non-existent', {
        method: 'PUT',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await updateUser('non-existent', request, env);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('User not found');
    });

    it('should return 400 when no fields to update', async () => {
      const testUser = {
        user_id: 'user-123',
        org_id: 'org-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockDB._setData('users', [testUser]);

      const request = new Request('http://localhost/user/user-123', {
        method: 'PUT',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await updateUser('user-123', request, env);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('No fields to update');
    });

    it('should return 409 when email is already taken', async () => {
      const testUsers = [
        {
          user_id: 'user-123',
          org_id: 'org-123',
          email: 'test@example.com',
          name: 'Test User',
          role: 'user',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          user_id: 'user-456',
          org_id: 'org-123',
          email: 'other@example.com',
          name: 'Other User',
          role: 'user',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      mockDB._setData('users', testUsers);

      const requestBody = {
        email: 'other@example.com', // Try to use another user's email
      };

      const request = new Request('http://localhost/user/user-123', {
        method: 'PUT',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await updateUser('user-123', request, env);
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.error).toBe('Email already in use by another user');
    });
  });

  describe('deleteUser', () => {
    it('should delete an existing user', async () => {
      const testUser = {
        user_id: 'user-123',
        org_id: 'org-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockDB._setData('users', [testUser]);

      const response = await deleteUser('user-123', env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.deleted).toBe(true);
      expect(data.data.user_id).toBe('user-123');
    });

    it('should return 404 for non-existent user', async () => {
      const response = await deleteUser('non-existent', env);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('User not found');
    });
  });
});
