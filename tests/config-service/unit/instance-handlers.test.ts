import { describe, it, expect, beforeEach } from 'vitest';
import { MockD1Database } from '../mocks/d1-mock';
import {
  getInstance,
  listInstances,
  createInstance,
  updateInstance,
  deleteInstance,
} from '../../../infrastructure/config-service/handlers/instance-handlers';
import { Env } from '../../../infrastructure/config-service/types';

describe('Instance Handlers', () => {
  let mockDB: MockD1Database;
  let env: Env;

  beforeEach(() => {
    mockDB = new MockD1Database();
    env = { DB: mockDB as any };
  });

  describe('createInstance', () => {
    it('should create a new instance', async () => {
      const requestBody = {
        org_id: 'org-123',
        name: 'production',
        api_keys: ['key1', 'key2'],
        rate_limits: { requests_per_minute: 100 },
      };

      const request = new Request('http://localhost/instance', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await createInstance(request, env);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(200);
      expect(data.data).toBeDefined();
      expect(data.data.org_id).toBe('org-123');
      expect(data.data.name).toBe('production');
      expect(data.data.instance_id).toBeDefined();
      expect(data.request_id).toBeDefined();
    });

    it('should return 400 for missing required fields', async () => {
      const requestBody = {
        org_id: 'org-123',
        // Missing 'name' field
      };

      const request = new Request('http://localhost/instance', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await createInstance(request, env);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(400);
      expect(data.error).toContain('Missing required fields');
      expect(data.request_id).toBeDefined();
    });

    it('should return 400 for invalid JSON', async () => {
      const request = new Request('http://localhost/instance', {
        method: 'POST',
        body: 'invalid json',
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await createInstance(request, env);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid JSON body');
    });
  });

  describe('getInstance', () => {
    it('should return an instance by ID', async () => {
      // Setup: Create an instance first
      const testInstance = {
        instance_id: 'inst-123',
        org_id: 'org-123',
        name: 'production',
        api_keys: JSON.stringify(['key1']),
        rate_limits: JSON.stringify({ requests_per_minute: 100 }),
        worker_urls: JSON.stringify({ main: 'https://main.example.com' }),
        r2_bucket: 'bucket-123',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockDB._setData('instances', [testInstance]);

      const response = await getInstance('inst-123', env);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(200);
      expect(data.data.instance_id).toBe('inst-123');
      expect(data.data.org_id).toBe('org-123');
      expect(data.data.name).toBe('production');
    });

    it('should return 404 for non-existent instance', async () => {
      const response = await getInstance('non-existent', env);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(404);
      expect(data.error).toBe('Instance not found');
      expect(data.request_id).toBeDefined();
    });
  });

  describe('listInstances', () => {
    it('should list all instances', async () => {
      const testInstances = [
        {
          instance_id: 'inst-1',
          org_id: 'org-123',
          name: 'production',
          api_keys: JSON.stringify([]),
          rate_limits: JSON.stringify({}),
          worker_urls: JSON.stringify({}),
          r2_bucket: 'bucket-1',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          instance_id: 'inst-2',
          org_id: 'org-456',
          name: 'staging',
          api_keys: JSON.stringify([]),
          rate_limits: JSON.stringify({}),
          worker_urls: JSON.stringify({}),
          r2_bucket: 'bucket-2',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      mockDB._setData('instances', testInstances);

      const response = await listInstances(null, env);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(200);
      expect(data.data).toHaveLength(2);
    });

    it('should filter instances by org_id', async () => {
      const testInstances = [
        {
          instance_id: 'inst-1',
          org_id: 'org-123',
          name: 'production',
          api_keys: JSON.stringify([]),
          rate_limits: JSON.stringify({}),
          worker_urls: JSON.stringify({}),
          r2_bucket: 'bucket-1',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          instance_id: 'inst-2',
          org_id: 'org-456',
          name: 'staging',
          api_keys: JSON.stringify([]),
          rate_limits: JSON.stringify({}),
          worker_urls: JSON.stringify({}),
          r2_bucket: 'bucket-2',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      mockDB._setData('instances', testInstances);

      const response = await listInstances('org-123', env);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(200);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].org_id).toBe('org-123');
    });
  });

  describe('updateInstance', () => {
    it('should update an existing instance', async () => {
      const testInstance = {
        instance_id: 'inst-123',
        org_id: 'org-123',
        name: 'production',
        api_keys: JSON.stringify(['key1']),
        rate_limits: JSON.stringify({ requests_per_minute: 100 }),
        worker_urls: JSON.stringify({}),
        r2_bucket: 'bucket-123',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockDB._setData('instances', [testInstance]);

      const requestBody = {
        name: 'production-updated',
        rate_limits: { requests_per_minute: 200 },
      };

      const request = new Request('http://localhost/instance/inst-123', {
        method: 'PUT',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await updateInstance('inst-123', request, env);
      expect(response.status).toBe(200);
    });

    it('should return 404 for non-existent instance', async () => {
      const requestBody = {
        name: 'updated',
      };

      const request = new Request('http://localhost/instance/non-existent', {
        method: 'PUT',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await updateInstance('non-existent', request, env);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(404);
      expect(data.error).toBe('Instance not found');
    });

    it('should return 400 when no fields to update', async () => {
      const testInstance = {
        instance_id: 'inst-123',
        org_id: 'org-123',
        name: 'production',
        api_keys: JSON.stringify([]),
        rate_limits: JSON.stringify({}),
        worker_urls: JSON.stringify({}),
        r2_bucket: 'bucket-123',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockDB._setData('instances', [testInstance]);

      const request = new Request('http://localhost/instance/inst-123', {
        method: 'PUT',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await updateInstance('inst-123', request, env);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(400);
      expect(data.error).toBe('No fields to update');
    });
  });

  describe('deleteInstance', () => {
    it('should delete an existing instance', async () => {
      const testInstance = {
        instance_id: 'inst-123',
        org_id: 'org-123',
        name: 'production',
        api_keys: JSON.stringify([]),
        rate_limits: JSON.stringify({}),
        worker_urls: JSON.stringify({}),
        r2_bucket: 'bucket-123',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockDB._setData('instances', [testInstance]);

      const response = await deleteInstance('inst-123', env);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(200);
      expect(data.data.deleted).toBe(true);
      expect(data.data.instance_id).toBe('inst-123');
    });

    it('should return 404 for non-existent instance', async () => {
      const response = await deleteInstance('non-existent', env);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(404);
      expect(data.error).toBe('Instance not found');
    });
  });
});
