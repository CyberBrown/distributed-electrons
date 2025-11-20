import { Env, Project } from '../types';
import {
  errorResponse,
  successResponse,
  parseJsonBody,
  validateRequiredFields,
  generateRequestId,
} from '../utils';

/**
 * Get a project by ID
 * GET /project/{id}
 */
export async function getProject(
  projectId: string,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    const result = await env.DB.prepare(
      'SELECT * FROM projects WHERE project_id = ?'
    )
      .bind(projectId)
      .first<Project>();

    if (!result) {
      return errorResponse('Project not found', 404, requestId);
    }

    // Parse JSON config field
    const project = {
      ...result,
      config: JSON.parse(result.config || '{}'),
    };

    return successResponse(project, requestId);
  } catch (error) {
    console.error('Error fetching project:', error);
    return errorResponse('Database error', 500, requestId);
  }
}

/**
 * List all projects for an instance
 * GET /project?instance_id={instance_id}
 */
export async function listProjects(
  instanceId: string | null,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    let query = 'SELECT * FROM projects';
    const params: string[] = [];

    if (instanceId) {
      query += ' WHERE instance_id = ?';
      params.push(instanceId);
    }

    query += ' ORDER BY created_at DESC';

    const stmt = env.DB.prepare(query);
    const result = params.length > 0
      ? await stmt.bind(...params).all<Project>()
      : await stmt.all<Project>();

    const projects = result.results.map(project => ({
      ...project,
      config: JSON.parse(project.config || '{}'),
    }));

    return successResponse(projects, requestId);
  } catch (error) {
    console.error('Error listing projects:', error);
    return errorResponse('Database error', 500, requestId);
  }
}

/**
 * Create a new project
 * POST /project
 */
export async function createProject(
  request: Request,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    const body = await parseJsonBody<{
      instance_id: string;
      name: string;
      description?: string;
      config?: any;
    }>(request);

    const validation = validateRequiredFields(body, ['instance_id', 'name']);
    if (!validation.valid) {
      return errorResponse(
        `Missing required fields: ${validation.missing?.join(', ')}`,
        400,
        requestId
      );
    }

    // Verify instance exists
    const instanceExists = await env.DB.prepare(
      'SELECT instance_id FROM instances WHERE instance_id = ?'
    )
      .bind(body.instance_id)
      .first();

    if (!instanceExists) {
      return errorResponse('Instance not found', 404, requestId);
    }

    const projectId = crypto.randomUUID();
    const now = new Date().toISOString();
    const config = JSON.stringify(body.config || {});

    await env.DB.prepare(
      `INSERT INTO projects (
        project_id, instance_id, name, description, config, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        projectId,
        body.instance_id,
        body.name,
        body.description || null,
        config,
        now,
        now
      )
      .run();

    const project = {
      project_id: projectId,
      instance_id: body.instance_id,
      name: body.name,
      description: body.description || null,
      config: JSON.parse(config),
      created_at: now,
      updated_at: now,
    };

    return successResponse(project, requestId);
  } catch (error) {
    console.error('Error creating project:', error);
    if ((error as Error).message === 'Invalid JSON body') {
      return errorResponse('Invalid JSON body', 400, requestId);
    }
    return errorResponse('Database error', 500, requestId);
  }
}

/**
 * Update an existing project
 * PUT /project/{id}
 */
export async function updateProject(
  projectId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    // Check if project exists
    const existing = await env.DB.prepare(
      'SELECT * FROM projects WHERE project_id = ?'
    )
      .bind(projectId)
      .first<Project>();

    if (!existing) {
      return errorResponse('Project not found', 404, requestId);
    }

    const body = await parseJsonBody<{
      name?: string;
      description?: string;
      config?: any;
    }>(request);

    const updates: string[] = [];
    const params: any[] = [];

    if (body.name !== undefined) {
      updates.push('name = ?');
      params.push(body.name);
    }
    if (body.description !== undefined) {
      updates.push('description = ?');
      params.push(body.description);
    }
    if (body.config !== undefined) {
      updates.push('config = ?');
      params.push(JSON.stringify(body.config));
    }

    if (updates.length === 0) {
      return errorResponse('No fields to update', 400, requestId);
    }

    const now = new Date().toISOString();
    updates.push('updated_at = ?');
    params.push(now);
    params.push(projectId);

    await env.DB.prepare(
      `UPDATE projects SET ${updates.join(', ')} WHERE project_id = ?`
    )
      .bind(...params)
      .run();

    // Fetch and return updated project
    const updated = await env.DB.prepare(
      'SELECT * FROM projects WHERE project_id = ?'
    )
      .bind(projectId)
      .first<Project>();

    const project = {
      ...updated!,
      config: JSON.parse(updated!.config || '{}'),
    };

    return successResponse(project, requestId);
  } catch (error) {
    console.error('Error updating project:', error);
    if ((error as Error).message === 'Invalid JSON body') {
      return errorResponse('Invalid JSON body', 400, requestId);
    }
    return errorResponse('Database error', 500, requestId);
  }
}

/**
 * Delete a project
 * DELETE /project/{id}
 */
export async function deleteProject(
  projectId: string,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    // Check if project exists
    const existing = await env.DB.prepare(
      'SELECT * FROM projects WHERE project_id = ?'
    )
      .bind(projectId)
      .first<Project>();

    if (!existing) {
      return errorResponse('Project not found', 404, requestId);
    }

    await env.DB.prepare('DELETE FROM projects WHERE project_id = ?')
      .bind(projectId)
      .run();

    return successResponse({ deleted: true, project_id: projectId }, requestId);
  } catch (error) {
    console.error('Error deleting project:', error);
    return errorResponse('Database error', 500, requestId);
  }
}
