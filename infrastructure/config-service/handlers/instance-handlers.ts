import { Env, Instance } from '../types';
import {
  errorResponse,
  successResponse,
  parseJsonBody,
  validateRequiredFields,
  generateRequestId,
} from '../utils';

/**
 * Get an instance by ID
 * GET /instance/{id}
 */
export async function getInstance(
  instanceId: string,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    const result = await env.DB.prepare(
      'SELECT * FROM instances WHERE instance_id = ?'
    )
      .bind(instanceId)
      .first<Instance>();

    if (!result) {
      return errorResponse('Instance not found', 404, requestId);
    }

    // Parse JSON fields for response
    const instance = {
      ...result,
      api_keys: JSON.parse(result.api_keys || '[]'),
      rate_limits: JSON.parse(result.rate_limits || '{}'),
      worker_urls: JSON.parse(result.worker_urls || '{}'),
    };

    return successResponse(instance, requestId);
  } catch (error) {
    console.error('Error fetching instance:', error);
    return errorResponse('Database error', 500, requestId);
  }
}

/**
 * List all instances for an organization
 * GET /instance?org_id={org_id}
 */
export async function listInstances(
  orgId: string | null,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    let query = 'SELECT * FROM instances';
    const params: string[] = [];

    if (orgId) {
      query += ' WHERE org_id = ?';
      params.push(orgId);
    }

    query += ' ORDER BY created_at DESC';

    const stmt = env.DB.prepare(query);
    const result = params.length > 0
      ? await stmt.bind(...params).all<Instance>()
      : await stmt.all<Instance>();

    const instances = result.results.map(instance => ({
      ...instance,
      api_keys: JSON.parse(instance.api_keys || '[]'),
      rate_limits: JSON.parse(instance.rate_limits || '{}'),
      worker_urls: JSON.parse(instance.worker_urls || '{}'),
    }));

    return successResponse(instances, requestId);
  } catch (error) {
    console.error('Error listing instances:', error);
    return errorResponse('Database error', 500, requestId);
  }
}

/**
 * Create a new instance
 * POST /instance
 */
export async function createInstance(
  request: Request,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    const body = await parseJsonBody<{
      org_id: string;
      name: string;
      api_keys?: any;
      rate_limits?: any;
      worker_urls?: any;
      r2_bucket?: string;
    }>(request);

    const validation = validateRequiredFields(body, ['org_id', 'name']);
    if (!validation.valid) {
      return errorResponse(
        `Missing required fields: ${validation.missing?.join(', ')}`,
        400,
        requestId
      );
    }

    const instanceId = crypto.randomUUID();
    const now = new Date().toISOString();

    const apiKeys = JSON.stringify(body.api_keys || []);
    const rateLimits = JSON.stringify(body.rate_limits || {
      requests_per_minute: 100,
      requests_per_day: 10000,
    });
    const workerUrls = JSON.stringify(body.worker_urls || {});
    const r2Bucket = body.r2_bucket || `instance-${instanceId}`;

    await env.DB.prepare(
      `INSERT INTO instances (
        instance_id, org_id, name, api_keys, rate_limits,
        worker_urls, r2_bucket, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        instanceId,
        body.org_id,
        body.name,
        apiKeys,
        rateLimits,
        workerUrls,
        r2Bucket,
        now,
        now
      )
      .run();

    const instance = {
      instance_id: instanceId,
      org_id: body.org_id,
      name: body.name,
      api_keys: JSON.parse(apiKeys),
      rate_limits: JSON.parse(rateLimits),
      worker_urls: JSON.parse(workerUrls),
      r2_bucket: r2Bucket,
      created_at: now,
      updated_at: now,
    };

    return successResponse(instance, requestId);
  } catch (error) {
    console.error('Error creating instance:', error);
    if ((error as Error).message === 'Invalid JSON body') {
      return errorResponse('Invalid JSON body', 400, requestId);
    }
    return errorResponse('Database error', 500, requestId);
  }
}

/**
 * Update an existing instance
 * PUT /instance/{id}
 */
export async function updateInstance(
  instanceId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    // Check if instance exists
    const existing = await env.DB.prepare(
      'SELECT * FROM instances WHERE instance_id = ?'
    )
      .bind(instanceId)
      .first<Instance>();

    if (!existing) {
      return errorResponse('Instance not found', 404, requestId);
    }

    const body = await parseJsonBody<{
      name?: string;
      api_keys?: any;
      rate_limits?: any;
      worker_urls?: any;
      r2_bucket?: string;
    }>(request);

    const updates: string[] = [];
    const params: any[] = [];

    if (body.name !== undefined) {
      updates.push('name = ?');
      params.push(body.name);
    }
    if (body.api_keys !== undefined) {
      updates.push('api_keys = ?');
      params.push(JSON.stringify(body.api_keys));
    }
    if (body.rate_limits !== undefined) {
      updates.push('rate_limits = ?');
      params.push(JSON.stringify(body.rate_limits));
    }
    if (body.worker_urls !== undefined) {
      updates.push('worker_urls = ?');
      params.push(JSON.stringify(body.worker_urls));
    }
    if (body.r2_bucket !== undefined) {
      updates.push('r2_bucket = ?');
      params.push(body.r2_bucket);
    }

    if (updates.length === 0) {
      return errorResponse('No fields to update', 400, requestId);
    }

    const now = new Date().toISOString();
    updates.push('updated_at = ?');
    params.push(now);
    params.push(instanceId);

    await env.DB.prepare(
      `UPDATE instances SET ${updates.join(', ')} WHERE instance_id = ?`
    )
      .bind(...params)
      .run();

    // Fetch and return updated instance
    const updated = await env.DB.prepare(
      'SELECT * FROM instances WHERE instance_id = ?'
    )
      .bind(instanceId)
      .first<Instance>();

    const instance = {
      ...updated!,
      api_keys: JSON.parse(updated!.api_keys || '[]'),
      rate_limits: JSON.parse(updated!.rate_limits || '{}'),
      worker_urls: JSON.parse(updated!.worker_urls || '{}'),
    };

    return successResponse(instance, requestId);
  } catch (error) {
    console.error('Error updating instance:', error);
    if ((error as Error).message === 'Invalid JSON body') {
      return errorResponse('Invalid JSON body', 400, requestId);
    }
    return errorResponse('Database error', 500, requestId);
  }
}

/**
 * Delete an instance
 * DELETE /instance/{id}
 */
export async function deleteInstance(
  instanceId: string,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    // Check if instance exists
    const existing = await env.DB.prepare(
      'SELECT * FROM instances WHERE instance_id = ?'
    )
      .bind(instanceId)
      .first<Instance>();

    if (!existing) {
      return errorResponse('Instance not found', 404, requestId);
    }

    await env.DB.prepare('DELETE FROM instances WHERE instance_id = ?')
      .bind(instanceId)
      .run();

    return successResponse({ deleted: true, instance_id: instanceId }, requestId);
  } catch (error) {
    console.error('Error deleting instance:', error);
    return errorResponse('Database error', 500, requestId);
  }
}
