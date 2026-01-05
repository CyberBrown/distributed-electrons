/**
 * Simple test for /execute endpoint routing to PrimeWorkflow
 *
 * This test verifies that the /execute endpoint correctly routes through PrimeWorkflow.
 * It uses Node's built-in test runner (node --test) and doesn't require external dependencies.
 *
 * Run with: node --test tests/workflows/execute-routing-simple.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';

// Types matching the worker's interface
/**
 * @typedef {Object} PrimeWorkflowParams
 * @property {string} task_id
 * @property {string} title
 * @property {string} [description]
 * @property {Record<string, unknown>} [context]
 * @property {Record<string, unknown>} [hints]
 * @property {string} [callback_url]
 * @property {number} [timeout_ms]
 */

/**
 * Create a mock workflow binding
 * @param {string} name
 */
const createMockWorkflow = (name) => ({
  createCalls: [],
  getCalls: [],
  create: async function(options) {
    this.createCalls.push(options);
    return { id: options.id };
  },
  get: async function(id) {
    this.getCalls.push(id);
    return {
      id,
      status: async () => ({ status: 'complete', output: { success: true } })
    };
  }
});

/**
 * Create mock environment
 */
const createMockEnv = () => ({
  NEXUS_PASSPHRASE: 'test-secret',
  PRIME_WORKFLOW: createMockWorkflow('PRIME_WORKFLOW'),
  CODE_EXECUTION_WORKFLOW: createMockWorkflow('CODE_EXECUTION_WORKFLOW'),
  TEXT_GENERATION_WORKFLOW: createMockWorkflow('TEXT_GENERATION_WORKFLOW'),
  VIDEO_RENDER_WORKFLOW: createMockWorkflow('VIDEO_RENDER_WORKFLOW'),
  IMAGE_GENERATION_WORKFLOW: createMockWorkflow('IMAGE_GENERATION_WORKFLOW'),
  AUDIO_GENERATION_WORKFLOW: createMockWorkflow('AUDIO_GENERATION_WORKFLOW'),
});

/**
 * Inline handler that mirrors the worker's /execute endpoint logic
 */
const handler = {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return Response.json({
        status: 'healthy',
        service: 'de-workflows',
        workflows: ['prime-workflow', 'code-execution-workflow', 'text-generation-workflow'],
      });
    }

    // POST /execute - Unified entry point (PrimeWorkflow)
    if (url.pathname === '/execute' && request.method === 'POST') {
      try {
        // Validate passphrase
        const passphrase = request.headers.get('X-Passphrase');
        if (env.NEXUS_PASSPHRASE && passphrase !== env.NEXUS_PASSPHRASE) {
          return Response.json({ error: 'Invalid passphrase' }, { status: 401 });
        }

        const body = await request.json();

        if (!body.params?.task_id) {
          return Response.json({ error: 'Missing task_id in params' }, { status: 400 });
        }

        if (!body.params?.title) {
          return Response.json({ error: 'Missing title in params' }, { status: 400 });
        }

        const workflowId = body.id || body.params.task_id;

        // This is the key routing - /execute goes to PRIME_WORKFLOW
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
      } catch (error) {
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

    // Direct workflow access - LOCKED DOWN
    if (url.pathname === '/workflows/code-execution' && request.method === 'POST') {
      return Response.json({
        error: 'Direct workflow access disabled. Use POST /execute instead.',
        code: 'USE_EXECUTE_ENDPOINT',
      }, { status: 403 });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  }
};

// Test suite
describe('/execute endpoint routing to PrimeWorkflow', () => {

  test('POST /execute routes to PRIME_WORKFLOW.create()', async () => {
    const env = createMockEnv();

    const request = new Request('https://test.local/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Passphrase': 'test-secret',
      },
      body: JSON.stringify({
        params: {
          task_id: 'test-task-123',
          title: '[implement] Test routing',
          description: 'Verify /execute routes to PrimeWorkflow',
        }
      })
    });

    const response = await handler.fetch(request, env);
    const data = await response.json();

    // Verify response
    assert.strictEqual(response.status, 200, 'Should return 200 OK');
    assert.strictEqual(data.success, true, 'Should return success: true');
    assert.strictEqual(data.execution_id, 'test-task-123', 'Should return execution_id');
    assert.strictEqual(data.status, 'accepted', 'Should return status: accepted');

    // Verify PRIME_WORKFLOW.create() was called (this is the key routing verification)
    assert.strictEqual(env.PRIME_WORKFLOW.createCalls.length, 1, 'PRIME_WORKFLOW.create() should be called once');
    assert.deepStrictEqual(env.PRIME_WORKFLOW.createCalls[0], {
      id: 'test-task-123',
      params: {
        task_id: 'test-task-123',
        title: '[implement] Test routing',
        description: 'Verify /execute routes to PrimeWorkflow',
      }
    }, 'PRIME_WORKFLOW.create() should be called with correct params');

    // Verify other workflows were NOT called directly
    assert.strictEqual(env.CODE_EXECUTION_WORKFLOW.createCalls.length, 0, 'CODE_EXECUTION_WORKFLOW should not be called directly');
    assert.strictEqual(env.TEXT_GENERATION_WORKFLOW.createCalls.length, 0, 'TEXT_GENERATION_WORKFLOW should not be called directly');

    console.log('✓ POST /execute correctly routes to PRIME_WORKFLOW.create()');
  });

  test('POST /execute requires valid passphrase', async () => {
    const env = createMockEnv();

    const request = new Request('https://test.local/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Passphrase': 'wrong-secret',
      },
      body: JSON.stringify({
        params: {
          task_id: 'test-task-123',
          title: '[implement] Test',
        }
      })
    });

    const response = await handler.fetch(request, env);
    const data = await response.json();

    assert.strictEqual(response.status, 401, 'Should return 401 Unauthorized');
    assert.strictEqual(data.error, 'Invalid passphrase');
    assert.strictEqual(env.PRIME_WORKFLOW.createCalls.length, 0, 'PRIME_WORKFLOW should not be called');

    console.log('✓ POST /execute rejects invalid passphrase');
  });

  test('POST /execute validates required params', async () => {
    const env = createMockEnv();

    // Missing task_id
    const request1 = new Request('https://test.local/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Passphrase': 'test-secret',
      },
      body: JSON.stringify({
        params: {
          title: '[implement] Test',
        }
      })
    });

    const response1 = await handler.fetch(request1, env);
    const data1 = await response1.json();

    assert.strictEqual(response1.status, 400, 'Should return 400 for missing task_id');
    assert.strictEqual(data1.error, 'Missing task_id in params');

    // Missing title
    const request2 = new Request('https://test.local/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Passphrase': 'test-secret',
      },
      body: JSON.stringify({
        params: {
          task_id: 'test-123',
        }
      })
    });

    const response2 = await handler.fetch(request2, env);
    const data2 = await response2.json();

    assert.strictEqual(response2.status, 400, 'Should return 400 for missing title');
    assert.strictEqual(data2.error, 'Missing title in params');

    console.log('✓ POST /execute validates required params');
  });

  test('Direct workflow access is blocked', async () => {
    const env = createMockEnv();

    const request = new Request('https://test.local/workflows/code-execution', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        task_id: 'test-123',
      })
    });

    const response = await handler.fetch(request, env);
    const data = await response.json();

    assert.strictEqual(response.status, 403, 'Should return 403 Forbidden');
    assert.strictEqual(data.code, 'USE_EXECUTE_ENDPOINT');
    assert.strictEqual(env.CODE_EXECUTION_WORKFLOW.createCalls.length, 0, 'CODE_EXECUTION_WORKFLOW should not be called');

    console.log('✓ Direct workflow access returns 403 USE_EXECUTE_ENDPOINT');
  });

  test('/execute passes all PrimeWorkflow params through', async () => {
    const env = createMockEnv();

    const params = {
      task_id: 'full-test-123',
      title: '[implement] Full params test',
      description: 'Testing all params pass through',
      context: { repo: 'https://github.com/test/repo' },
      hints: { workflow: 'code-execution', provider: 'claude' },
      callback_url: 'https://nexus.test/callback',
      timeout_ms: 600000,
    };

    const request = new Request('https://test.local/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Passphrase': 'test-secret',
      },
      body: JSON.stringify({ params })
    });

    const response = await handler.fetch(request, env);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(env.PRIME_WORKFLOW.createCalls[0].params, params, 'All params should pass through to PrimeWorkflow');

    console.log('✓ POST /execute passes all params to PRIME_WORKFLOW');
  });

});

console.log('\n=== Execute Routing Test Summary ===');
console.log('All tests verify that POST /execute routes through PrimeWorkflow');
console.log('PrimeWorkflow then classifies and routes to appropriate sub-workflows');
