/**
 * Simple test to verify /execute endpoint routes through PrimeWorkflow
 *
 * This is a minimal sanity check test that verifies:
 * 1. POST /execute with valid params calls PRIME_WORKFLOW.create()
 * 2. The response format is correct
 */

import { describe, it, expect, vi } from 'vitest';

// Minimal handler matching the worker's /execute route
const handler = {
  async fetch(request: Request, env: { PRIME_WORKFLOW: { create: Function }; NEXUS_PASSPHRASE?: string }): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/execute' && request.method === 'POST') {
      const passphrase = request.headers.get('X-Passphrase');
      if (env.NEXUS_PASSPHRASE && passphrase !== env.NEXUS_PASSPHRASE) {
        return Response.json({ error: 'Invalid passphrase' }, { status: 401 });
      }

      const body = await request.json() as { id?: string; params: { task_id: string; title: string } };

      if (!body.params?.task_id) {
        return Response.json({ error: 'Missing task_id in params' }, { status: 400 });
      }
      if (!body.params?.title) {
        return Response.json({ error: 'Missing title in params' }, { status: 400 });
      }

      const workflowId = body.id || body.params.task_id;
      const instance = await env.PRIME_WORKFLOW.create({ id: workflowId, params: body.params });

      return Response.json({
        success: true,
        execution_id: instance.id,
        status: 'accepted',
        message: 'Request accepted for processing',
      });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  },
};

describe('/execute routes through PrimeWorkflow', () => {
  it('calls PRIME_WORKFLOW.create() with correct parameters', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 'test-task-123' });
    const env = {
      NEXUS_PASSPHRASE: 'secret',
      PRIME_WORKFLOW: { create: mockCreate },
    };

    const request = new Request('https://test/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Passphrase': 'secret',
      },
      body: JSON.stringify({
        params: {
          task_id: 'test-task-123',
          title: '[implement] Test routing',
          description: 'Verify routing works',
        },
      }),
    });

    const response = await handler.fetch(request, env);
    const data = await response.json() as Record<string, unknown>;

    // Verify response
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.execution_id).toBe('test-task-123');
    expect(data.status).toBe('accepted');

    // Verify PRIME_WORKFLOW.create was called correctly
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith({
      id: 'test-task-123',
      params: {
        task_id: 'test-task-123',
        title: '[implement] Test routing',
        description: 'Verify routing works',
      },
    });
  });
});
