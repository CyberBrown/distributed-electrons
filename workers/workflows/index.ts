/**
 * DE Workflows Index
 * Exports all Cloudflare Workflows for Distributed Electrons
 */

export { VideoRenderWorkflow } from './VideoRenderWorkflow';
export { CodeExecutionWorkflow } from './CodeExecutionWorkflow';

// Future workflows:
// export { BatchProcessWorkflow } from './BatchProcessWorkflow';
// export { FallbackChainWorkflow } from './FallbackChainWorkflow';
// export { HumanApprovalWorkflow } from './HumanApprovalWorkflow';

// Default export required for Cloudflare Workers module format
// The actual workflow is exposed via the [[workflows]] binding in wrangler.toml
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return Response.json({
        status: 'healthy',
        service: 'de-workflows',
        workflows: ['video-render-workflow', 'code-execution-workflow'],
        timestamp: new Date().toISOString(),
      });
    }

    return Response.json({
      error: 'Workflows are invoked via bindings, not HTTP',
      available_workflows: ['video-render-workflow', 'code-execution-workflow'],
    }, { status: 400 });
  },
};
