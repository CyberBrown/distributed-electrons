import { describe, it, expect, beforeEach } from 'vitest';
import { MockD1Database } from '../mocks/d1-mock';
import {
  getProject,
  listProjects,
  createProject,
  updateProject,
  deleteProject,
} from '../../../infrastructure/config-service/handlers/project-handlers';
import { Env } from '../../../infrastructure/config-service/types';

describe('Project Handlers', () => {
  let mockDB: MockD1Database;
  let env: Env;

  beforeEach(() => {
    mockDB = new MockD1Database();
    env = { DB: mockDB as any };
  });

  describe('createProject', () => {
    it('should create a new project', async () => {
      // Setup: Add instance to DB
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

      const requestBody = {
        instance_id: 'inst-123',
        name: 'My Project',
        description: 'Test project',
        config: { setting1: 'value1' },
      };

      const request = new Request('http://localhost/project', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await createProject(request, env);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(200);
      expect(data.data).toBeDefined();
      expect(data.data.instance_id).toBe('inst-123');
      expect(data.data.name).toBe('My Project');
      expect(data.data.description).toBe('Test project');
      expect(data.data.config).toEqual({ setting1: 'value1' });
      expect(data.data.project_id).toBeDefined();
      expect(data.request_id).toBeDefined();
    });

    it('should create project without description', async () => {
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

      const requestBody = {
        instance_id: 'inst-123',
        name: 'My Project',
      };

      const request = new Request('http://localhost/project', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await createProject(request, env);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(200);
      expect(data.data.description).toBeNull();
      expect(data.data.config).toEqual({});
    });

    it('should return 400 for missing required fields', async () => {
      const requestBody = {
        instance_id: 'inst-123',
        // Missing 'name'
      };

      const request = new Request('http://localhost/project', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await createProject(request, env);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(400);
      expect(data.error).toContain('Missing required fields');
    });

    it('should return 404 if instance does not exist', async () => {
      const requestBody = {
        instance_id: 'non-existent',
        name: 'My Project',
      };

      const request = new Request('http://localhost/project', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await createProject(request, env);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(404);
      expect(data.error).toBe('Instance not found');
    });
  });

  describe('getProject', () => {
    it('should return a project by ID', async () => {
      const testProject = {
        project_id: 'proj-123',
        instance_id: 'inst-123',
        name: 'My Project',
        description: 'Test project',
        config: JSON.stringify({ setting1: 'value1' }),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockDB._setData('projects', [testProject]);

      const response = await getProject('proj-123', env);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(200);
      expect(data.data.project_id).toBe('proj-123');
      expect(data.data.name).toBe('My Project');
      expect(data.data.config).toEqual({ setting1: 'value1' });
    });

    it('should return 404 for non-existent project', async () => {
      const response = await getProject('non-existent', env);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(404);
      expect(data.error).toBe('Project not found');
    });
  });

  describe('listProjects', () => {
    it('should list all projects', async () => {
      const testProjects = [
        {
          project_id: 'proj-1',
          instance_id: 'inst-123',
          name: 'Project 1',
          description: null,
          config: JSON.stringify({}),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          project_id: 'proj-2',
          instance_id: 'inst-456',
          name: 'Project 2',
          description: 'Description 2',
          config: JSON.stringify({}),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      mockDB._setData('projects', testProjects);

      const response = await listProjects(null, env);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(200);
      expect(data.data).toHaveLength(2);
    });

    it('should filter projects by instance_id', async () => {
      const testProjects = [
        {
          project_id: 'proj-1',
          instance_id: 'inst-123',
          name: 'Project 1',
          description: null,
          config: JSON.stringify({}),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          project_id: 'proj-2',
          instance_id: 'inst-456',
          name: 'Project 2',
          description: 'Description 2',
          config: JSON.stringify({}),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      mockDB._setData('projects', testProjects);

      const response = await listProjects('inst-123', env);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(200);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].instance_id).toBe('inst-123');
    });
  });

  describe('updateProject', () => {
    it('should update an existing project', async () => {
      const testProject = {
        project_id: 'proj-123',
        instance_id: 'inst-123',
        name: 'My Project',
        description: 'Old description',
        config: JSON.stringify({ setting1: 'value1' }),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockDB._setData('projects', [testProject]);

      const requestBody = {
        name: 'Updated Project',
        description: 'New description',
        config: { setting1: 'new-value', setting2: 'value2' },
      };

      const request = new Request('http://localhost/project/proj-123', {
        method: 'PUT',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await updateProject('proj-123', request, env);
      expect(response.status).toBe(200);
    });

    it('should return 404 for non-existent project', async () => {
      const requestBody = {
        name: 'Updated Project',
      };

      const request = new Request('http://localhost/project/non-existent', {
        method: 'PUT',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await updateProject('non-existent', request, env);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(404);
      expect(data.error).toBe('Project not found');
    });

    it('should return 400 when no fields to update', async () => {
      const testProject = {
        project_id: 'proj-123',
        instance_id: 'inst-123',
        name: 'My Project',
        description: null,
        config: JSON.stringify({}),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockDB._setData('projects', [testProject]);

      const request = new Request('http://localhost/project/proj-123', {
        method: 'PUT',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await updateProject('proj-123', request, env);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(400);
      expect(data.error).toBe('No fields to update');
    });
  });

  describe('deleteProject', () => {
    it('should delete an existing project', async () => {
      const testProject = {
        project_id: 'proj-123',
        instance_id: 'inst-123',
        name: 'My Project',
        description: null,
        config: JSON.stringify({}),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockDB._setData('projects', [testProject]);

      const response = await deleteProject('proj-123', env);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(200);
      expect(data.data.deleted).toBe(true);
      expect(data.data.project_id).toBe('proj-123');
    });

    it('should return 404 for non-existent project', async () => {
      const response = await deleteProject('non-existent', env);
      const data = await response.json() as Record<string, any>;

      expect(response.status).toBe(404);
      expect(data.error).toBe('Project not found');
    });
  });
});
