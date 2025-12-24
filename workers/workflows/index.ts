/**
 * DE Workflows Index
 * Exports all Cloudflare Workflows for Distributed Electrons
 */

import { CodeExecutionParams, TextGenerationParams, PrimeWorkflowParams } from './types';

export { VideoRenderWorkflow } from './VideoRenderWorkflow';
export { CodeExecutionWorkflow } from './CodeExecutionWorkflow';
export { TextGenerationWorkflow } from './TextGenerationWorkflow';
export { PrimeWorkflow } from './PrimeWorkflow';

// Workflow binding type
interface Workflow {
  create(options?: { id?: string; params?: unknown }): Promise<WorkflowInstance>;
  get(id: string): Promise<WorkflowInstance>;
}

interface WorkflowInstance {
  id: string;
  status(): Promise<{
    status: 'queued' | 'running' | 'paused' | 'complete' | 'errored' | 'terminated' | 'waiting';
    output?: unknown;
    error?: string;
  }>;
}

interface Env {
  CODE_EXECUTION_WORKFLOW: Workflow;
  VIDEO_RENDER_WORKFLOW: Workflow;
  TEXT_GENERATION_WORKFLOW: Workflow;
  PRIME_WORKFLOW: Workflow;
  // Auth secret for external trigger requests
  NEXUS_PASSPHRASE?: string;
}

// Default export required for Cloudflare Workers module format
// The actual workflow is exposed via the [[workflows]] binding in wrangler.toml
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return Response.json({
        status: 'healthy',
        service: 'de-workflows',
        workflows: ['prime-workflow', 'video-render-workflow', 'code-execution-workflow', 'text-generation-workflow'],
        timestamp: new Date().toISOString(),
      });
    }

    // =========================================================================
    // POST /execute - Unified entry point (PrimeWorkflow)
    // This is the main entry point for all requests into DE
    // =========================================================================
    if (url.pathname === '/execute' && request.method === 'POST') {
      try {
        // Validate passphrase for authentication
        const passphrase = request.headers.get('X-Passphrase');
        if (env.NEXUS_PASSPHRASE && passphrase !== env.NEXUS_PASSPHRASE) {
          return Response.json({ error: 'Invalid passphrase' }, { status: 401 });
        }

        const body = await request.json() as {
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
      } catch (error: any) {
        // Handle duplicate workflow error gracefully
        if (error.message?.includes('already exists')) {
          return Response.json({
            success: false,
            error: 'Execution with this ID already exists',
            code: 'DUPLICATE_EXECUTION',
          }, { status: 409 });
        }
        return Response.json({
          success: false,
          error: error.message || 'Failed to accept request',
        }, { status: 500 });
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
      } catch (error: any) {
        return Response.json({
          success: false,
          error: error.message || 'Failed to get execution status',
        }, { status: 500 });
      }
    }

    // POST /workflows/code-execution - Trigger CodeExecutionWorkflow via HTTP
    // This endpoint allows external workers (like Nexus) to trigger workflows
    // since cross-worker workflow bindings are not supported by CF Workflows
    if (url.pathname === '/workflows/code-execution' && request.method === 'POST') {
      try {
        // Validate passphrase for authentication
        const passphrase = request.headers.get('X-Passphrase');
        if (env.NEXUS_PASSPHRASE && passphrase !== env.NEXUS_PASSPHRASE) {
          return Response.json({ error: 'Invalid passphrase' }, { status: 401 });
        }

        const body = await request.json() as {
          id?: string;
          params: CodeExecutionParams;
        };

        if (!body.params?.task_id) {
          return Response.json({ error: 'Missing task_id in params' }, { status: 400 });
        }

        // Use task_id as workflow instance ID to prevent duplicates
        const workflowId = body.id || body.params.task_id;

        const instance = await env.CODE_EXECUTION_WORKFLOW.create({
          id: workflowId,
          params: body.params,
        });

        return Response.json({
          success: true,
          workflow_id: instance.id,
          message: 'CodeExecutionWorkflow triggered',
        });
      } catch (error: any) {
        // Handle duplicate workflow error gracefully
        if (error.message?.includes('already exists')) {
          return Response.json({
            success: false,
            error: 'Workflow with this ID already exists',
            code: 'DUPLICATE_WORKFLOW',
          }, { status: 409 });
        }
        return Response.json({
          success: false,
          error: error.message || 'Failed to trigger workflow',
        }, { status: 500 });
      }
    }

    // GET /workflows/code-execution/:id - Get workflow status
    if (url.pathname.startsWith('/workflows/code-execution/') && request.method === 'GET') {
      try {
        const workflowId = url.pathname.replace('/workflows/code-execution/', '');
        if (!workflowId) {
          return Response.json({ error: 'Missing workflow ID' }, { status: 400 });
        }

        const instance = await env.CODE_EXECUTION_WORKFLOW.get(workflowId);
        const status = await instance.status();

        return Response.json({
          success: true,
          workflow_id: workflowId,
          status: status.status,
          output: status.output,
          error: status.error,
        });
      } catch (error: any) {
        return Response.json({
          success: false,
          error: error.message || 'Failed to get workflow status',
        }, { status: 500 });
      }
    }

    // POST /workflows/text-generation - Trigger TextGenerationWorkflow via HTTP
    // Routes text-only tasks through the waterfall: runners → local vLLM → API providers
    if (url.pathname === '/workflows/text-generation' && request.method === 'POST') {
      try {
        // Validate passphrase for authentication
        const passphrase = request.headers.get('X-Passphrase');
        if (env.NEXUS_PASSPHRASE && passphrase !== env.NEXUS_PASSPHRASE) {
          return Response.json({ error: 'Invalid passphrase' }, { status: 401 });
        }

        const body = await request.json() as {
          id?: string;
          params: TextGenerationParams;
        };

        if (!body.params?.request_id) {
          return Response.json({ error: 'Missing request_id in params' }, { status: 400 });
        }

        if (!body.params?.prompt) {
          return Response.json({ error: 'Missing prompt in params' }, { status: 400 });
        }

        // Use request_id as workflow instance ID to prevent duplicates
        const workflowId = body.id || body.params.request_id;

        const instance = await env.TEXT_GENERATION_WORKFLOW.create({
          id: workflowId,
          params: body.params,
        });

        return Response.json({
          success: true,
          workflow_id: instance.id,
          message: 'TextGenerationWorkflow triggered',
        });
      } catch (error: any) {
        // Handle duplicate workflow error gracefully
        if (error.message?.includes('already exists')) {
          return Response.json({
            success: false,
            error: 'Workflow with this ID already exists',
            code: 'DUPLICATE_WORKFLOW',
          }, { status: 409 });
        }
        return Response.json({
          success: false,
          error: error.message || 'Failed to trigger workflow',
        }, { status: 500 });
      }
    }

    // GET /workflows/text-generation/:id - Get workflow status
    if (url.pathname.startsWith('/workflows/text-generation/') && request.method === 'GET') {
      try {
        const workflowId = url.pathname.replace('/workflows/text-generation/', '');
        if (!workflowId) {
          return Response.json({ error: 'Missing workflow ID' }, { status: 400 });
        }

        const instance = await env.TEXT_GENERATION_WORKFLOW.get(workflowId);
        const status = await instance.status();

        return Response.json({
          success: true,
          workflow_id: workflowId,
          status: status.status,
          output: status.output,
          error: status.error,
        });
      } catch (error: any) {
        return Response.json({
          success: false,
          error: error.message || 'Failed to get workflow status',
        }, { status: 500 });
      }
    }

    return Response.json({
      error: 'Not found',
      available_endpoints: [
        'GET /health',
        'POST /execute',
        'GET /status/:id',
        'POST /workflows/code-execution',
        'GET /workflows/code-execution/:id',
        'POST /workflows/text-generation',
        'GET /workflows/text-generation/:id',
      ],
    }, { status: 404 });
  },
};
