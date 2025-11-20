import { Env, User } from '../types';
import {
  errorResponse,
  successResponse,
  parseJsonBody,
  validateRequiredFields,
  generateRequestId,
} from '../utils';

/**
 * Get a user by ID
 * GET /user/{id}
 */
export async function getUser(
  userId: string,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    const result = await env.DB.prepare(
      'SELECT * FROM users WHERE user_id = ?'
    )
      .bind(userId)
      .first<User>();

    if (!result) {
      return errorResponse('User not found', 404, requestId);
    }

    return successResponse(result, requestId);
  } catch (error) {
    console.error('Error fetching user:', error);
    return errorResponse('Database error', 500, requestId);
  }
}

/**
 * List all users for an organization
 * GET /user?org_id={org_id}
 */
export async function listUsers(
  orgId: string | null,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    let query = 'SELECT * FROM users';
    const params: string[] = [];

    if (orgId) {
      query += ' WHERE org_id = ?';
      params.push(orgId);
    }

    query += ' ORDER BY created_at DESC';

    const stmt = env.DB.prepare(query);
    const result = params.length > 0
      ? await stmt.bind(...params).all<User>()
      : await stmt.all<User>();

    return successResponse(result.results, requestId);
  } catch (error) {
    console.error('Error listing users:', error);
    return errorResponse('Database error', 500, requestId);
  }
}

/**
 * Get a user by email
 * GET /user/email/{email}
 */
export async function getUserByEmail(
  email: string,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    const result = await env.DB.prepare(
      'SELECT * FROM users WHERE email = ?'
    )
      .bind(email)
      .first<User>();

    if (!result) {
      return errorResponse('User not found', 404, requestId);
    }

    return successResponse(result, requestId);
  } catch (error) {
    console.error('Error fetching user by email:', error);
    return errorResponse('Database error', 500, requestId);
  }
}

/**
 * Create a new user
 * POST /user
 */
export async function createUser(
  request: Request,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    const body = await parseJsonBody<{
      org_id: string;
      email: string;
      name: string;
      role?: string;
    }>(request);

    const validation = validateRequiredFields(body, ['org_id', 'email', 'name']);
    if (!validation.valid) {
      return errorResponse(
        `Missing required fields: ${validation.missing?.join(', ')}`,
        400,
        requestId
      );
    }

    // Check if user with this email already exists
    const existing = await env.DB.prepare(
      'SELECT * FROM users WHERE email = ?'
    )
      .bind(body.email)
      .first<User>();

    if (existing) {
      return errorResponse('User with this email already exists', 409, requestId);
    }

    const userId = crypto.randomUUID();
    const now = new Date().toISOString();
    const role = body.role || 'user';

    await env.DB.prepare(
      `INSERT INTO users (
        user_id, org_id, email, name, role, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(userId, body.org_id, body.email, body.name, role, now, now)
      .run();

    const user: User = {
      user_id: userId,
      org_id: body.org_id,
      email: body.email,
      name: body.name,
      role,
      created_at: now,
      updated_at: now,
    };

    return successResponse(user, requestId);
  } catch (error) {
    console.error('Error creating user:', error);
    if ((error as Error).message === 'Invalid JSON body') {
      return errorResponse('Invalid JSON body', 400, requestId);
    }
    return errorResponse('Database error', 500, requestId);
  }
}

/**
 * Update an existing user
 * PUT /user/{id}
 */
export async function updateUser(
  userId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    // Check if user exists
    const existing = await env.DB.prepare(
      'SELECT * FROM users WHERE user_id = ?'
    )
      .bind(userId)
      .first<User>();

    if (!existing) {
      return errorResponse('User not found', 404, requestId);
    }

    const body = await parseJsonBody<{
      email?: string;
      name?: string;
      role?: string;
    }>(request);

    const updates: string[] = [];
    const params: any[] = [];

    if (body.email !== undefined) {
      // Check if new email is already taken by another user
      const emailCheck = await env.DB.prepare(
        'SELECT * FROM users WHERE email = ? AND user_id != ?'
      )
        .bind(body.email, userId)
        .first<User>();

      if (emailCheck) {
        return errorResponse('Email already in use by another user', 409, requestId);
      }

      updates.push('email = ?');
      params.push(body.email);
    }
    if (body.name !== undefined) {
      updates.push('name = ?');
      params.push(body.name);
    }
    if (body.role !== undefined) {
      updates.push('role = ?');
      params.push(body.role);
    }

    if (updates.length === 0) {
      return errorResponse('No fields to update', 400, requestId);
    }

    const now = new Date().toISOString();
    updates.push('updated_at = ?');
    params.push(now);
    params.push(userId);

    await env.DB.prepare(
      `UPDATE users SET ${updates.join(', ')} WHERE user_id = ?`
    )
      .bind(...params)
      .run();

    // Fetch and return updated user
    const updated = await env.DB.prepare(
      'SELECT * FROM users WHERE user_id = ?'
    )
      .bind(userId)
      .first<User>();

    return successResponse(updated!, requestId);
  } catch (error) {
    console.error('Error updating user:', error);
    if ((error as Error).message === 'Invalid JSON body') {
      return errorResponse('Invalid JSON body', 400, requestId);
    }
    return errorResponse('Database error', 500, requestId);
  }
}

/**
 * Delete a user
 * DELETE /user/{id}
 */
export async function deleteUser(
  userId: string,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    // Check if user exists
    const existing = await env.DB.prepare(
      'SELECT * FROM users WHERE user_id = ?'
    )
      .bind(userId)
      .first<User>();

    if (!existing) {
      return errorResponse('User not found', 404, requestId);
    }

    await env.DB.prepare('DELETE FROM users WHERE user_id = ?')
      .bind(userId)
      .run();

    return successResponse({ deleted: true, user_id: userId }, requestId);
  } catch (error) {
    console.error('Error deleting user:', error);
    return errorResponse('Database error', 500, requestId);
  }
}
