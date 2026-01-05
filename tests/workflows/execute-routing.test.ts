/**
 * Tests for /execute endpoint routing to PrimeWorkflow
 *
 * Verifies that the /execute endpoint correctly:
 * - Validates passphrase authentication
 * - Validates required parameters (task_id, title)
 * - Routes requests to PrimeWorkflow
 * - Returns proper response format
 *
 * Note: We inline the handler logic here rather than importing the worker
 * directly, because the worker imports Cloudflare Workflow classes that
 * require the cloudflare:workers runtime which isn't available in vitest.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Types matching the worker's interface
interface PrimeWorkflowParams {
  task_id: string;
  title: string;
  description?: string;
  context?: Record<string, unknown>;
  hints?: Record<string, unknown>;
  callback_url?: string;
  timeout_ms?: number;
}

interface Workflow {
  create(options: { id: string; params: unknown }): Promise<{ id: string }>;
  get(id: string): Promise<{
    id: string;
    status(): Promise<{ status: string; output?: unknown; error?: string }>;
  }>;
}

interface Env {
  CODE_EXECUTION_WORKFLOW: Workflow;
  VIDEO_RENDER_WORKFLOW: Workflow;
  TEXT_GENERATION_WORKFLOW: Workflow;
  PRIME_WORKFLOW: Workflow;
  IMAGE_GENERATION_WORKFLOW: Workflow;
  AUDIO_GENERATION_WORKFLOW: Workflow;
  NEXUS_PASSPHRASE?: string;
}

/**
 * Inline handler that mirrors the worker's fetch handler logic.
 * This allows testing without importing cloudflare:workers dependencies.
 */
const handler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return Response.json({
        status: 'healthy',
        service: 'de-workflows',
        workflows: [
          'prime-workflow',
          'video-render-workflow',
          'code-execution-workflow',
          'text-generation-workflow',
          'image-generation-workflow',
          'audio-generation-workflow',
        ],
        timestamp: new Date().toISOString(),
      });
    }

    // POST /execute - Unified entry point (PrimeWorkflow)
    if (url.pathname === '/execute' && request.method === 'POST') {
      try {
        // Validate passphrase for authentication
        const passphrase = request.headers.get('X-Passphrase');
        if (env.NEXUS_PASSPHRASE && passphrase !== env.NEXUS_PASSPHRASE) {
          return Response.json({ error: 'Invalid passphrase' }, { status: 401 });
        }

        const body = (await request.json()) as {
          id?: string;
          params: PrimeWorkflowParams;
        };

        if (!body.params?.task_id) {
          return Response.json({ error: 'Missing task_id in params' }, { status: 400 });
        }

        if (!body.params?.title) {
          return Response.json({ error: 'Missing title in params' }, { status: 400 });
        }

        // Use task_id as workflow instance ID to prevent duplicates
        const workflowId = body.id || body.params.task_id;

        const instance = await env.PRIME_WORKFLOW.create({
          id: workflowId,
          params: body.params,
        });

        return Response.json({
          success: true,
          execution_id: instance.id,
          status: 'accepted',
          message: 'Request accepted for processing',
        });
      } catch (error: unknown) {
        const err = error as Error;
        // Handle duplicate workflow error gracefully
        if (err.message?.includes('already exists')) {
          return Response.json(
            {
              success: false,
              error: 'Execution with this ID already exists',
              code: 'DUPLICATE_EXECUTION',
            },
            { status: 409 }
          );
        }
        return Response.json(
          {
            success: false,
            error: err.message || 'Failed to accept request',
          },
          { status: 500 }
        );
      }
    }

    // GET /status/:id - Get execution status (PrimeWorkflow)
    if (url.pathname.startsWith('/status/') && request.method === 'GET') {
      try {
        const executionId = url.pathname.replace('/status/', '');
        if (!executionId) {
          return Response.json({ error: 'Missing execution ID' }, { status: 400 });
        }

        const instance = await env.PRIME_WORKFLOW.get(executionId);
        const status = await instance.status();

        return Response.json({
          success: true,
          execution_id: executionId,
          status: status.status,
          output: status.output,
          error: status.error,
        });
      } catch (error: unknown) {
        const err = error as Error;
        return Response.json(
          {
            success: false,
            error: err.message || 'Failed to get execution status',
          },
          { status: 500 }
        );
      }
    }

    // POST /workflows/code-execution - LOCKED DOWN
    if (url.pathname === '/workflows/code-execution' && request.method === 'POST') {
      return Response.json(
        {
          error: 'Direct workflow access disabled. Use POST /execute instead.',
          code: 'USE_EXECUTE_ENDPOINT',
        },
        { status: 403 }
      );
    }

    // POST /workflows/text-generation - LOCKED DOWN
    if (url.pathname === '/workflows/text-generation' && request.method === 'POST') {
      return Response.json(
        {
          error: 'Direct workflow access disabled. Use POST /execute instead.',
          code: 'USE_EXECUTE_ENDPOINT',
        },
        { status: 403 }
      );
    }

    // POST /workflows/image-generation - LOCKED DOWN
    if (url.pathname === '/workflows/image-generation' && request.method === 'POST') {
      return Response.json(
        {
          error: 'Direct workflow access disabled. Use POST /execute instead.',
          code: 'USE_EXECUTE_ENDPOINT',
        },
        { status: 403 }
      );
    }

    // POST /workflows/audio-generation - LOCKED DOWN
    if (url.pathname === '/workflows/audio-generation' && request.method === 'POST') {
      return Response.json(
        {
          error: 'Direct workflow access disabled. Use POST /execute instead.',
          code: 'USE_EXECUTE_ENDPOINT',
        },
        { status: 403 }
      );
    }

    return Response.json(
      {
        error: 'Not found',
        available_endpoints: [
          'GET /health',
          'POST /execute (single entry point - triggers PrimeWorkflow)',
          'GET /status/:id',
        ],
      },
      { status: 404 }
    );
  },
};

// Mock workflow instance
const createMockWorkflowInstance = (id: string) => ({
  id,
  status: vi.fn().mockResolvedValue({
    status: 'complete',
    output: { success: true, output: 'Task completed' },
  }),
});

// Mock environment with all required workflow bindings
const createMockEnv = () => ({
  NEXUS_PASSPHRASE: 'test-passphrase',
  PRIME_WORKFLOW: {
    create: vi.fn().mockImplementation(({ id }: { id: string }) =>
      Promise.resolve(createMockWorkflowInstance(id))
    ),
    get: vi.fn().mockImplementation((id: string) => Promise.resolve(createMockWorkflowInstance(id))),
  },
  CODE_EXECUTION_WORKFLOW: {
    create: vi.fn().mockImplementation(({ id }: { id: string }) =>
      Promise.resolve(createMockWorkflowInstance(id))
    ),
    get: vi.fn().mockImplementation((id: string) => Promise.resolve(createMockWorkflowInstance(id))),
  },
  TEXT_GENERATION_WORKFLOW: {
    create: vi.fn().mockImplementation(({ id }: { id: string }) =>
      Promise.resolve(createMockWorkflowInstance(id))
    ),
    get: vi.fn().mockImplementation((id: string) => Promise.resolve(createMockWorkflowInstance(id))),
  },
  VIDEO_RENDER_WORKFLOW: {
    create: vi.fn().mockImplementation(({ id }: { id: string }) =>
      Promise.resolve(createMockWorkflowInstance(id))
    ),
    get: vi.fn().mockImplementation((id: string) => Promise.resolve(createMockWorkflowInstance(id))),
  },
  IMAGE_GENERATION_WORKFLOW: {
    create: vi.fn().mockImplementation(({ id }: { id: string }) =>
      Promise.resolve(createMockWorkflowInstance(id))
    ),
    get: vi.fn().mockImplementation((id: string) => Promise.resolve(createMockWorkflowInstance(id))),
  },
  AUDIO_GENERATION_WORKFLOW: {
    create: vi.fn().mockImplementation(({ id }: { id: string }) =>
      Promise.resolve(createMockWorkflowInstance(id))
    ),
    get: vi.fn().mockImplementation((id: string) => Promise.resolve(createMockWorkflowInstance(id))),
  },
});

// Use the inline handler instead of importing the worker
const worker = handler;

describe('/execute endpoint routing to PrimeWorkflow', () => {
  let mockEnv: ReturnType<typeof createMockEnv>;

  beforeEach(() => {
    mockEnv = createMockEnv();
    vi.clearAllMocks();
  });

  describe('Authentication', () => {
    it('should reject request without passphrase when NEXUS_PASSPHRASE is set', async () => {
      const request = new Request('https://workflows.test/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          params: {
            task_id: 'test-task-1',
            title: '[implement] Test task',
          },
        }),
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(401);
      expect(data.error).toBe('Invalid passphrase');
    });

    it('should reject request with invalid passphrase', async () => {
      const request = new Request('https://workflows.test/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Passphrase': 'wrong-passphrase',
        },
        body: JSON.stringify({
          params: {
            task_id: 'test-task-1',
            title: '[implement] Test task',
          },
        }),
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(401);
      expect(data.error).toBe('Invalid passphrase');
    });

    it('should accept request with valid passphrase', async () => {
      const request = new Request('https://workflows.test/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Passphrase': 'test-passphrase',
        },
        body: JSON.stringify({
          params: {
            task_id: 'test-task-1',
            title: '[implement] Test task',
          },
        }),
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should skip auth check when NEXUS_PASSPHRASE is not set', async () => {
      const envWithoutPassphrase = { ...mockEnv, NEXUS_PASSPHRASE: undefined };

      const request = new Request('https://workflows.test/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          params: {
            task_id: 'test-task-1',
            title: '[implement] Test task',
          },
        }),
      });

      const response = await worker.fetch(request, envWithoutPassphrase as any);
      const data = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe('Request validation', () => {
    it('should reject request without task_id', async () => {
      const request = new Request('https://workflows.test/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Passphrase': 'test-passphrase',
        },
        body: JSON.stringify({
          params: {
            title: '[implement] Test task',
          },
        }),
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(400);
      expect(data.error).toBe('Missing task_id in params');
    });

    it('should reject request without title', async () => {
      const request = new Request('https://workflows.test/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Passphrase': 'test-passphrase',
        },
        body: JSON.stringify({
          params: {
            task_id: 'test-task-1',
          },
        }),
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(400);
      expect(data.error).toBe('Missing title in params');
    });
  });

  describe('PrimeWorkflow routing', () => {
    it('should route valid request to PrimeWorkflow.create()', async () => {
      const request = new Request('https://workflows.test/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Passphrase': 'test-passphrase',
        },
        body: JSON.stringify({
          params: {
            task_id: 'test-task-1',
            title: '[implement] Build new feature',
            description: 'Implement a new feature for the app',
          },
        }),
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.execution_id).toBe('test-task-1');
      expect(data.status).toBe('accepted');

      // Verify PrimeWorkflow.create was called with correct params
      expect(mockEnv.PRIME_WORKFLOW.create).toHaveBeenCalledTimes(1);
      expect(mockEnv.PRIME_WORKFLOW.create).toHaveBeenCalledWith({
        id: 'test-task-1',
        params: {
          task_id: 'test-task-1',
          title: '[implement] Build new feature',
          description: 'Implement a new feature for the app',
        },
      });
    });

    it('should use custom id when provided', async () => {
      const request = new Request('https://workflows.test/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Passphrase': 'test-passphrase',
        },
        body: JSON.stringify({
          id: 'custom-execution-id',
          params: {
            task_id: 'test-task-1',
            title: '[implement] Test task',
          },
        }),
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(data.execution_id).toBe('custom-execution-id');

      expect(mockEnv.PRIME_WORKFLOW.create).toHaveBeenCalledWith({
        id: 'custom-execution-id',
        params: expect.objectContaining({
          task_id: 'test-task-1',
        }),
      });
    });

    it('should pass all PrimeWorkflow params through', async () => {
      const params = {
        task_id: 'test-task-1',
        title: '[implement] Full test',
        description: 'Full description here',
        context: { repo: 'https://github.com/test/repo' },
        hints: { workflow: 'code-execution', provider: 'claude' },
        callback_url: 'https://nexus.test/workflow-callback',
        timeout_ms: 600000,
      };

      const request = new Request('https://workflows.test/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Passphrase': 'test-passphrase',
        },
        body: JSON.stringify({ params }),
      });

      const response = await worker.fetch(request, mockEnv as any);

      expect(response.status).toBe(200);
      expect(mockEnv.PRIME_WORKFLOW.create).toHaveBeenCalledWith({
        id: 'test-task-1',
        params,
      });
    });
  });

  describe('Duplicate execution handling', () => {
    it('should return 409 for duplicate execution ID', async () => {
      mockEnv.PRIME_WORKFLOW.create = vi.fn().mockRejectedValue(
        new Error('Workflow with ID already exists')
      );

      const request = new Request('https://workflows.test/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Passphrase': 'test-passphrase',
        },
        body: JSON.stringify({
          params: {
            task_id: 'duplicate-task-id',
            title: '[implement] Duplicate task',
          },
        }),
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(409);
      expect(data.success).toBe(false);
      expect(data.code).toBe('DUPLICATE_EXECUTION');
    });
  });

  describe('Error handling', () => {
    it('should return 500 for workflow creation errors', async () => {
      mockEnv.PRIME_WORKFLOW.create = vi.fn().mockRejectedValue(
        new Error('Workflow service unavailable')
      );

      const request = new Request('https://workflows.test/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Passphrase': 'test-passphrase',
        },
        body: JSON.stringify({
          params: {
            task_id: 'test-task-1',
            title: '[implement] Test task',
          },
        }),
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Workflow service unavailable');
    });
  });

  describe('GET /status/:id endpoint', () => {
    it('should return workflow status for valid execution ID', async () => {
      const request = new Request('https://workflows.test/status/test-execution-id', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.execution_id).toBe('test-execution-id');
      expect(mockEnv.PRIME_WORKFLOW.get).toHaveBeenCalledWith('test-execution-id');
    });
  });

  describe('Direct workflow access lockdown', () => {
    it('should reject direct POST to /workflows/code-execution', async () => {
      const request = new Request('https://workflows.test/workflows/code-execution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: 'test' }),
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(403);
      expect(data.code).toBe('USE_EXECUTE_ENDPOINT');
    });

    it('should reject direct POST to /workflows/text-generation', async () => {
      const request = new Request('https://workflows.test/workflows/text-generation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'test' }),
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(403);
      expect(data.code).toBe('USE_EXECUTE_ENDPOINT');
    });

    it('should reject direct POST to /workflows/image-generation', async () => {
      const request = new Request('https://workflows.test/workflows/image-generation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'test' }),
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(403);
      expect(data.code).toBe('USE_EXECUTE_ENDPOINT');
    });

    it('should reject direct POST to /workflows/audio-generation', async () => {
      const request = new Request('https://workflows.test/workflows/audio-generation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'test' }),
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(403);
      expect(data.code).toBe('USE_EXECUTE_ENDPOINT');
    });
  });

  describe('Health endpoint', () => {
    it('should return healthy status with workflow list', async () => {
      const request = new Request('https://workflows.test/health', {
        method: 'GET',
      });

      const response = await worker.fetch(request, mockEnv as any);
      const data = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(data.status).toBe('healthy');
      expect(data.service).toBe('de-workflows');
      expect(data.workflows).toContain('prime-workflow');
      expect(data.workflows).toContain('code-execution-workflow');
    });
  });
});
