import { describe, it, expect, beforeEach } from 'vitest';
import { MockD1Database } from '../mocks/d1-mock';
import worker from '../../../infrastructure/config-service/index';
import { Env } from '../../../infrastructure/config-service/types';

// Mock ExecutionContext for worker.fetch calls
const mockCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as ExecutionContext;

describe('Config Service API Integration Tests', () => {
  let mockDB: MockD1Database;
  let env: Env;

  beforeEach(() => {
    mockDB = new MockD1Database();
    env = { DB: mockDB as any };
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const request = new Request('http://localhost/health');
      const response = await worker.fetch(request, env, mockCtx);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(200);
      expect(data.status).toBe('healthy');
      expect(data.service).toBe('config-service');
    });

    it('should handle root path', async () => {
      const request = new Request('http://localhost/');
      const response = await worker.fetch(request, env, mockCtx);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(200);
      expect(data.status).toBe('healthy');
    });
  });

  describe('CORS', () => {
    it('should handle OPTIONS preflight request', async () => {
      const request = new Request('http://localhost/instance', {
        method: 'OPTIONS',
      });
      const response = await worker.fetch(request, env, mockCtx);

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    it('should include CORS headers in response', async () => {
      const request = new Request('http://localhost/health');
      const response = await worker.fetch(request, env, mockCtx);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('Instance API Flow', () => {
    it('should create, get, update, and delete an instance', async () => {
      // 1. Create instance
      const createRequest = new Request('http://localhost/instance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: 'org-123',
          name: 'production',
          rate_limits: { requests_per_minute: 100 },
        }),
      });

      const createResponse = await worker.fetch(createRequest, env, mockCtx);
      const createData = await createResponse.json() as Record<string, any>;

      expect(createResponse.status).toBe(200);
      expect(createData.data.instance_id).toBeDefined();

      const instanceId = createData.data.instance_id;

      // 2. Get instance
      const getRequest = new Request(`http://localhost/instance/${instanceId}`);
      const getResponse = await worker.fetch(getRequest, env, mockCtx);
      const getData = await getResponse.json() as Record<string, any>;

      expect(getResponse.status).toBe(200);
      expect(getData.data.instance_id).toBe(instanceId);
      expect(getData.data.name).toBe('production');

      // 3. Update instance
      const updateRequest = new Request(`http://localhost/instance/${instanceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'production-updated',
        }),
      });

      const updateResponse = await worker.fetch(updateRequest, env, mockCtx);
      expect(updateResponse.status).toBe(200);

      // 4. Delete instance
      const deleteRequest = new Request(`http://localhost/instance/${instanceId}`, {
        method: 'DELETE',
      });

      const deleteResponse = await worker.fetch(deleteRequest, env, mockCtx);
      const deleteData = await deleteResponse.json() as Record<string, any>;

      expect(deleteResponse.status).toBe(200);
      expect(deleteData.data.deleted).toBe(true);

      // 5. Verify deletion
      const verifyRequest = new Request(`http://localhost/instance/${instanceId}`);
      const verifyResponse = await worker.fetch(verifyRequest, env, mockCtx);

      expect(verifyResponse.status).toBe(404);
    });

    it('should list instances filtered by org_id', async () => {
      // Create instances for different orgs
      await worker.fetch(
        new Request('http://localhost/instance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ org_id: 'org-1', name: 'instance-1' }),
        }),
        env,
        mockCtx
      );

      await worker.fetch(
        new Request('http://localhost/instance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ org_id: 'org-2', name: 'instance-2' }),
        }),
        env,
        mockCtx
      );

      // List all
      const listAllRequest = new Request('http://localhost/instance');
      const listAllResponse = await worker.fetch(listAllRequest, env, mockCtx);
      const listAllData = await listAllResponse.json() as Record<string, any>;

      expect(listAllResponse.status).toBe(200);
      expect(listAllData.data).toHaveLength(2);

      // List filtered
      const listFilteredRequest = new Request('http://localhost/instance?org_id=org-1');
      const listFilteredResponse = await worker.fetch(listFilteredRequest, env, mockCtx);
      const listFilteredData = await listFilteredResponse.json() as Record<string, any>;

      expect(listFilteredResponse.status).toBe(200);
      expect(listFilteredData.data).toHaveLength(1);
      expect(listFilteredData.data[0].org_id).toBe('org-1');
    });
  });

  describe('User API Flow', () => {
    it('should create, get, update, and delete a user', async () => {
      // 1. Create user
      const createRequest = new Request('http://localhost/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: 'org-123',
          email: 'test@example.com',
          name: 'Test User',
          role: 'admin',
        }),
      });

      const createResponse = await worker.fetch(createRequest, env, mockCtx);
      const createData = await createResponse.json() as Record<string, any>;

      expect(createResponse.status).toBe(200);
      expect(createData.data.user_id).toBeDefined();

      const userId = createData.data.user_id;

      // 2. Get user
      const getRequest = new Request(`http://localhost/user/${userId}`);
      const getResponse = await worker.fetch(getRequest, env, mockCtx);
      const getData = await getResponse.json() as Record<string, any>;

      expect(getResponse.status).toBe(200);
      expect(getData.data.user_id).toBe(userId);
      expect(getData.data.email).toBe('test@example.com');

      // 3. Get user by email
      const getByEmailRequest = new Request('http://localhost/user/email/test@example.com');
      const getByEmailResponse = await worker.fetch(getByEmailRequest, env, mockCtx);
      const getByEmailData = await getByEmailResponse.json() as Record<string, any>;

      expect(getByEmailResponse.status).toBe(200);
      expect(getByEmailData.data.user_id).toBe(userId);

      // 4. Update user
      const updateRequest = new Request(`http://localhost/user/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Updated User',
        }),
      });

      const updateResponse = await worker.fetch(updateRequest, env, mockCtx);
      expect(updateResponse.status).toBe(200);

      // 5. Delete user
      const deleteRequest = new Request(`http://localhost/user/${userId}`, {
        method: 'DELETE',
      });

      const deleteResponse = await worker.fetch(deleteRequest, env, mockCtx);
      const deleteData = await deleteResponse.json() as Record<string, any>;

      expect(deleteResponse.status).toBe(200);
      expect(deleteData.data.deleted).toBe(true);
    });

    it('should prevent duplicate email addresses', async () => {
      // Create first user
      await worker.fetch(
        new Request('http://localhost/user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            org_id: 'org-123',
            email: 'duplicate@example.com',
            name: 'User 1',
          }),
        }),
        env,
        mockCtx
      );

      // Try to create second user with same email
      const duplicateRequest = new Request('http://localhost/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: 'org-123',
          email: 'duplicate@example.com',
          name: 'User 2',
        }),
      });

      const duplicateResponse = await worker.fetch(duplicateRequest, env, mockCtx);
      const duplicateData = await duplicateResponse.json() as Record<string, any>;

      expect(duplicateResponse.status).toBe(409);
      expect(duplicateData.error).toBe('User with this email already exists');
    });
  });

  describe('Project API Flow', () => {
    let instanceId: string;

    beforeEach(async () => {
      // Create an instance for projects
      const createInstanceRequest = new Request('http://localhost/instance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: 'org-123',
          name: 'test-instance',
        }),
      });

      const createInstanceResponse = await worker.fetch(createInstanceRequest, env, mockCtx);
      const createInstanceData = await createInstanceResponse.json() as Record<string, any>;
      instanceId = createInstanceData.data.instance_id;
    });

    it('should create, get, update, and delete a project', async () => {
      // 1. Create project
      const createRequest = new Request('http://localhost/project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instance_id: instanceId,
          name: 'My Project',
          description: 'Test project',
          config: { setting1: 'value1' },
        }),
      });

      const createResponse = await worker.fetch(createRequest, env, mockCtx);
      const createData = await createResponse.json() as Record<string, any>;

      expect(createResponse.status).toBe(200);
      expect(createData.data.project_id).toBeDefined();

      const projectId = createData.data.project_id;

      // 2. Get project
      const getRequest = new Request(`http://localhost/project/${projectId}`);
      const getResponse = await worker.fetch(getRequest, env, mockCtx);
      const getData = await getResponse.json() as Record<string, any>;

      expect(getResponse.status).toBe(200);
      expect(getData.data.project_id).toBe(projectId);
      expect(getData.data.name).toBe('My Project');
      expect(getData.data.config).toEqual({ setting1: 'value1' });

      // 3. Update project
      const updateRequest = new Request(`http://localhost/project/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Updated Project',
          config: { setting1: 'new-value' },
        }),
      });

      const updateResponse = await worker.fetch(updateRequest, env, mockCtx);
      expect(updateResponse.status).toBe(200);

      // 4. Delete project
      const deleteRequest = new Request(`http://localhost/project/${projectId}`, {
        method: 'DELETE',
      });

      const deleteResponse = await worker.fetch(deleteRequest, env, mockCtx);
      const deleteData = await deleteResponse.json() as Record<string, any>;

      expect(deleteResponse.status).toBe(200);
      expect(deleteData.data.deleted).toBe(true);
    });

    it('should list projects filtered by instance_id', async () => {
      // Create projects
      await worker.fetch(
        new Request('http://localhost/project', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instance_id: instanceId,
            name: 'Project 1',
          }),
        }),
        env,
        mockCtx
      );

      await worker.fetch(
        new Request('http://localhost/project', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instance_id: instanceId,
            name: 'Project 2',
          }),
        }),
        env,
        mockCtx
      );

      // List filtered by instance
      const listRequest = new Request(`http://localhost/project?instance_id=${instanceId}`);
      const listResponse = await worker.fetch(listRequest, env, mockCtx);
      const listData = await listResponse.json() as Record<string, any>;

      expect(listResponse.status).toBe(200);
      expect(listData.data).toHaveLength(2);
      expect(listData.data[0].instance_id).toBe(instanceId);
    });

    it('should return 404 when creating project with non-existent instance', async () => {
      const createRequest = new Request('http://localhost/project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instance_id: 'non-existent',
          name: 'My Project',
        }),
      });

      const createResponse = await worker.fetch(createRequest, env, mockCtx);
      const createData = await createResponse.json() as Record<string, any>;

      expect(createResponse.status).toBe(404);
      expect(createData.error).toBe('Instance not found');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const request = new Request('http://localhost/unknown-route');
      const response = await worker.fetch(request, env, mockCtx);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(404);
      expect(data.error).toBe('Route not found');
      expect(data.request_id).toBeDefined();
    });

    it('should return 404 for unsupported HTTP methods', async () => {
      const request = new Request('http://localhost/instance/123', {
        method: 'PATCH',
      });
      const response = await worker.fetch(request, env, mockCtx);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(404);
      expect(data.error).toBe('Route not found');
    });

    it('should include request_id in all error responses', async () => {
      const request = new Request('http://localhost/instance/non-existent');
      const response = await worker.fetch(request, env, mockCtx);
      const data = await response.json() as Record<string, any>;

      expect(data.request_id).toBeDefined();
      expect(typeof data.request_id).toBe('string');
    });
  });
});
