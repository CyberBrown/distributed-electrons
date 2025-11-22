import { Env, ModelConfig, CreateModelConfigRequest, UpdateModelConfigRequest } from '../types';
import {
  errorResponse,
  successResponse,
  parseJsonBody,
  validateRequiredFields,
  generateRequestId,
} from '../utils';

/**
 * Get a model config by config_id or model_id
 * GET /model-config/{id}
 */
export async function getModelConfig(
  id: string,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    // Try to find by config_id first, then model_id
    const result = await env.DB.prepare(
      'SELECT * FROM model_configs WHERE config_id = ? OR model_id = ?'
    )
      .bind(id, id)
      .first<any>();

    if (!result) {
      return errorResponse('Model config not found', 404, requestId);
    }

    // Parse JSON fields for response
    const modelConfig: ModelConfig = {
      ...result,
      capabilities: JSON.parse(result.capabilities),
      pricing: result.pricing ? JSON.parse(result.pricing) : undefined,
      rate_limits: result.rate_limits ? JSON.parse(result.rate_limits) : undefined,
      payload_mapping: JSON.parse(result.payload_mapping),
    };

    return successResponse(modelConfig, requestId);
  } catch (error) {
    console.error('Error fetching model config:', error);
    return errorResponse('Database error', 500, requestId);
  }
}

/**
 * List all model configs, optionally filtered by provider_id or status
 * GET /model-config?provider_id={provider_id}&status={status}
 */
export async function listModelConfigs(
  providerId: string | null,
  status: string | null,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    let query = 'SELECT * FROM model_configs';
    const conditions: string[] = [];
    const params: string[] = [];

    if (providerId) {
      conditions.push('provider_id = ?');
      params.push(providerId);
    }

    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY provider_id, display_name';

    const stmt = env.DB.prepare(query);
    const result = params.length > 0
      ? await stmt.bind(...params).all<any>()
      : await stmt.all<any>();

    const modelConfigs: ModelConfig[] = result.results.map(config => ({
      ...config,
      capabilities: JSON.parse(config.capabilities),
      pricing: config.pricing ? JSON.parse(config.pricing) : undefined,
      rate_limits: config.rate_limits ? JSON.parse(config.rate_limits) : undefined,
      payload_mapping: JSON.parse(config.payload_mapping),
    }));

    return successResponse({ configs: modelConfigs, total: modelConfigs.length }, requestId);
  } catch (error) {
    console.error('Error listing model configs:', error);
    return errorResponse('Database error', 500, requestId);
  }
}

/**
 * Create a new model config
 * POST /model-config
 */
export async function createModelConfig(
  request: Request,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    const body = await parseJsonBody<CreateModelConfigRequest>(request);

    const validation = validateRequiredFields(body, [
      'model_id',
      'provider_id',
      'display_name',
      'capabilities',
      'payload_mapping',
      'status',
    ]);

    if (!validation.valid) {
      return errorResponse(
        `Missing required fields: ${validation.missing?.join(', ')}`,
        400,
        requestId
      );
    }

    // Validate model_id format (lowercase alphanumeric with hyphens)
    if (!/^[a-z0-9-]+$/.test(body.model_id)) {
      return errorResponse(
        'Invalid model_id format. Use lowercase alphanumeric characters and hyphens only.',
        400,
        requestId
      );
    }

    // Validate status
    if (!['active', 'beta', 'deprecated'].includes(body.status)) {
      return errorResponse(
        'Invalid status. Must be one of: active, beta, deprecated',
        400,
        requestId
      );
    }

    // Validate payload mapping structure
    const payloadMapping = body.payload_mapping;
    if (
      !payloadMapping.endpoint ||
      !payloadMapping.method ||
      !payloadMapping.headers ||
      !payloadMapping.body ||
      !payloadMapping.response_mapping
    ) {
      return errorResponse(
        'Invalid payload_mapping. Must include: endpoint, method, headers, body, response_mapping',
        400,
        requestId
      );
    }

    // Validate capabilities (at least one must be true)
    const capabilities = body.capabilities;
    const hasCapability = Object.values(capabilities).some(val => val === true);
    if (!hasCapability) {
      return errorResponse(
        'At least one capability must be true',
        400,
        requestId
      );
    }

    // Check if model_id already exists
    const existing = await env.DB.prepare(
      'SELECT model_id FROM model_configs WHERE model_id = ?'
    )
      .bind(body.model_id)
      .first();

    if (existing) {
      return errorResponse(
        `Model config with model_id "${body.model_id}" already exists`,
        409,
        requestId
      );
    }

    const configId = `cfg_${body.provider_id}_${body.model_id.replace(/-/g, '_')}`;
    const now = new Date().toISOString();

    const capabilitiesJson = JSON.stringify(body.capabilities);
    const pricingJson = body.pricing ? JSON.stringify(body.pricing) : null;
    const rateLimitsJson = body.rate_limits ? JSON.stringify(body.rate_limits) : null;
    const payloadMappingJson = JSON.stringify(body.payload_mapping);

    await env.DB.prepare(
      `INSERT INTO model_configs (
        config_id, model_id, provider_id, display_name, description,
        capabilities, pricing, rate_limits, payload_mapping, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        configId,
        body.model_id,
        body.provider_id,
        body.display_name,
        body.description || null,
        capabilitiesJson,
        pricingJson,
        rateLimitsJson,
        payloadMappingJson,
        body.status,
        now,
        now
      )
      .run();

    const modelConfig: ModelConfig = {
      config_id: configId,
      model_id: body.model_id,
      provider_id: body.provider_id,
      display_name: body.display_name,
      description: body.description,
      capabilities: body.capabilities,
      pricing: body.pricing,
      rate_limits: body.rate_limits,
      payload_mapping: body.payload_mapping,
      status: body.status,
      created_at: now,
      updated_at: now,
    };

    return successResponse(modelConfig, requestId);
  } catch (error) {
    console.error('Error creating model config:', error);
    if ((error as Error).message === 'Invalid JSON body') {
      return errorResponse('Invalid JSON body', 400, requestId);
    }
    return errorResponse('Database error', 500, requestId);
  }
}

/**
 * Update an existing model config
 * PUT /model-config/{id}
 */
export async function updateModelConfig(
  id: string,
  request: Request,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    // Check if config exists (by config_id or model_id)
    const existing = await env.DB.prepare(
      'SELECT * FROM model_configs WHERE config_id = ? OR model_id = ?'
    )
      .bind(id, id)
      .first<any>();

    if (!existing) {
      return errorResponse('Model config not found', 404, requestId);
    }

    const body = await parseJsonBody<UpdateModelConfigRequest>(request);

    const updates: string[] = [];
    const params: any[] = [];

    if (body.display_name !== undefined) {
      updates.push('display_name = ?');
      params.push(body.display_name);
    }

    if (body.description !== undefined) {
      updates.push('description = ?');
      params.push(body.description);
    }

    if (body.capabilities !== undefined) {
      // Validate at least one capability is true
      const hasCapability = Object.values(body.capabilities).some(val => val === true);
      if (!hasCapability) {
        return errorResponse(
          'At least one capability must be true',
          400,
          requestId
        );
      }
      updates.push('capabilities = ?');
      params.push(JSON.stringify(body.capabilities));
    }

    if (body.pricing !== undefined) {
      updates.push('pricing = ?');
      params.push(JSON.stringify(body.pricing));
    }

    if (body.rate_limits !== undefined) {
      updates.push('rate_limits = ?');
      params.push(JSON.stringify(body.rate_limits));
    }

    if (body.payload_mapping !== undefined) {
      // Validate payload mapping structure
      const pm = body.payload_mapping;
      if (
        !pm.endpoint ||
        !pm.method ||
        !pm.headers ||
        !pm.body ||
        !pm.response_mapping
      ) {
        return errorResponse(
          'Invalid payload_mapping. Must include: endpoint, method, headers, body, response_mapping',
          400,
          requestId
        );
      }
      updates.push('payload_mapping = ?');
      params.push(JSON.stringify(body.payload_mapping));
    }

    if (body.status !== undefined) {
      if (!['active', 'beta', 'deprecated'].includes(body.status)) {
        return errorResponse(
          'Invalid status. Must be one of: active, beta, deprecated',
          400,
          requestId
        );
      }
      updates.push('status = ?');
      params.push(body.status);
    }

    if (updates.length === 0) {
      return errorResponse('No fields to update', 400, requestId);
    }

    const now = new Date().toISOString();
    updates.push('updated_at = ?');
    params.push(now);
    params.push(existing.config_id);

    await env.DB.prepare(
      `UPDATE model_configs SET ${updates.join(', ')} WHERE config_id = ?`
    )
      .bind(...params)
      .run();

    // Fetch and return updated config
    const updated = await env.DB.prepare(
      'SELECT * FROM model_configs WHERE config_id = ?'
    )
      .bind(existing.config_id)
      .first<any>();

    const modelConfig: ModelConfig = {
      ...updated!,
      capabilities: JSON.parse(updated!.capabilities),
      pricing: updated!.pricing ? JSON.parse(updated!.pricing) : undefined,
      rate_limits: updated!.rate_limits ? JSON.parse(updated!.rate_limits) : undefined,
      payload_mapping: JSON.parse(updated!.payload_mapping),
    };

    return successResponse(modelConfig, requestId);
  } catch (error) {
    console.error('Error updating model config:', error);
    if ((error as Error).message === 'Invalid JSON body') {
      return errorResponse('Invalid JSON body', 400, requestId);
    }
    return errorResponse('Database error', 500, requestId);
  }
}

/**
 * Delete a model config
 * DELETE /model-config/{id}
 */
export async function deleteModelConfig(
  id: string,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    // Check if config exists (by config_id or model_id)
    const existing = await env.DB.prepare(
      'SELECT * FROM model_configs WHERE config_id = ? OR model_id = ?'
    )
      .bind(id, id)
      .first<any>();

    if (!existing) {
      return errorResponse('Model config not found', 404, requestId);
    }

    await env.DB.prepare('DELETE FROM model_configs WHERE config_id = ?')
      .bind(existing.config_id)
      .run();

    return successResponse({
      deleted: true,
      config_id: existing.config_id,
      model_id: existing.model_id
    }, requestId);
  } catch (error) {
    console.error('Error deleting model config:', error);
    return errorResponse('Database error', 500, requestId);
  }
}
