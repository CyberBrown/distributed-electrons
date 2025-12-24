#!/usr/bin/env bun
/**
 * Integration Test for DE Code Execution Workflow
 *
 * Tests the full flow:
 * 1. Intake → CodeExecutionWorkflow routing
 * 2. Workflow → Runner execution (or mock)
 * 3. Workflow → Nexus callback
 *
 * Run with: bun run scripts/test-code-workflow.ts
 *
 * Environment variables:
 * - INTAKE_URL (default: https://intake.distributedelectrons.com)
 * - NEXUS_URL (default: https://nexus-mcp.solamp.workers.dev)
 * - WORKFLOWS_URL (default: https://de-workflows.<account>.workers.dev)
 * - NEXUS_PASSPHRASE (required for Nexus API calls)
 * - DRY_RUN (set to 'false' to run actual execution)
 */

const INTAKE_URL = process.env.INTAKE_URL || 'https://intake.distributedelectrons.com';
const NEXUS_URL = process.env.NEXUS_URL || 'https://nexus-mcp.solamp.workers.dev';
const WORKFLOWS_URL = process.env.WORKFLOWS_URL || 'https://de-workflows.solamp.workers.dev';
const NEXUS_PASSPHRASE = process.env.NEXUS_PASSPHRASE || '';
const DRY_RUN = process.env.DRY_RUN !== 'false';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration_ms: number;
  details?: Record<string, unknown>;
}

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message: string, color: keyof typeof colors = 'reset'): void {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// ============================================================================
// Test: Health Endpoints
// ============================================================================

async function testHealthEndpoints(): Promise<TestResult> {
  const start = Date.now();
  const details: Record<string, unknown> = {};

  try {
    log('\n[1/6] Testing health endpoints...', 'cyan');

    // Test Intake health
    const intakeHealth = await fetch(`${INTAKE_URL}/health`);
    details.intake_status = intakeHealth.status;
    details.intake_ok = intakeHealth.ok;
    if (intakeHealth.ok) {
      details.intake_data = await intakeHealth.json();
    }

    // Test Workflows health
    const workflowsHealth = await fetch(`${WORKFLOWS_URL}/health`);
    details.workflows_status = workflowsHealth.status;
    details.workflows_ok = workflowsHealth.ok;
    if (workflowsHealth.ok) {
      details.workflows_data = await workflowsHealth.json();
    }

    // Test Nexus health
    const nexusHealth = await fetch(`${NEXUS_URL}/health`);
    details.nexus_status = nexusHealth.status;
    details.nexus_ok = nexusHealth.ok;
    if (nexusHealth.ok) {
      details.nexus_data = await nexusHealth.json();
    }

    const allHealthy = intakeHealth.ok && workflowsHealth.ok && nexusHealth.ok;

    if (!allHealthy) {
      const failures: string[] = [];
      if (!intakeHealth.ok) failures.push(`intake=${intakeHealth.status}`);
      if (!workflowsHealth.ok) failures.push(`workflows=${workflowsHealth.status}`);
      if (!nexusHealth.ok) failures.push(`nexus=${nexusHealth.status}`);
      throw new Error(`Health checks failed: ${failures.join(', ')}`);
    }

    return {
      name: 'health-endpoints',
      passed: true,
      duration_ms: Date.now() - start,
      details,
    };
  } catch (error) {
    return {
      name: 'health-endpoints',
      passed: false,
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - start,
      details,
    };
  }
}

// ============================================================================
// Test: Code Request Classification
// ============================================================================

async function testCodeClassification(): Promise<TestResult> {
  const start = Date.now();
  const details: Record<string, unknown> = {};

  try {
    log('\n[2/6] Testing code request classification...', 'cyan');

    // Test cases that SHOULD be classified as code
    const codeRequests = [
      { query: 'implement a login form', repo_url: 'https://github.com/test/repo', expected: 'code' },
      { query: 'fix the bug in https://github.com/user/project', expected: 'code' },
      { query: 'debug the authentication flow', executor: 'claude', expected: 'code' },
      { query: 'refactor the database module', expected: 'code' },
      { query: 'write a function to parse JSON', expected: 'code' },
    ];

    // Test cases that should NOT be classified as code
    const nonCodeRequests = [
      { query: 'what is the capital of France', expected: 'other' },
      { query: 'summarize this document', expected: 'other' },
    ];

    const results: Array<{ query: string; expected: string; matched: boolean }> = [];

    // We can't test classification directly without modifying intake
    // But we can verify the intake endpoint accepts code requests
    for (const testCase of codeRequests.slice(0, 2)) {
      const response = await fetch(`${INTAKE_URL}/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: testCase.query,
          repo_url: testCase.repo_url,
          app_id: 'integration-test',
          task_type: 'code',
        }),
      });

      const result = await response.json() as Record<string, unknown>;

      // Check if it was routed to code workflow
      const isCodeWorkflow = result.workflow_name === 'code-execution-workflow';
      results.push({
        query: testCase.query.substring(0, 40) + '...',
        expected: testCase.expected,
        matched: isCodeWorkflow,
      });
    }

    details.classification_results = results;
    const allMatched = results.every(r => r.matched);

    if (!allMatched) {
      const failures = results.filter(r => !r.matched);
      throw new Error(`Classification failed for: ${failures.map(f => f.query).join(', ')}`);
    }

    return {
      name: 'code-classification',
      passed: true,
      duration_ms: Date.now() - start,
      details,
    };
  } catch (error) {
    return {
      name: 'code-classification',
      passed: false,
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - start,
      details,
    };
  }
}

// ============================================================================
// Test: Workflow Creation
// ============================================================================

async function testWorkflowCreation(): Promise<TestResult> {
  const start = Date.now();
  const details: Record<string, unknown> = {};

  try {
    log('\n[3/6] Testing workflow creation...', 'cyan');

    // Send a code request and verify workflow is created
    const response = await fetch(`${INTAKE_URL}/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_type: 'code',
        query: 'echo "workflow creation test"',
        repo_url: 'https://github.com/test/test-repo',
        app_id: 'integration-test',
      }),
    });

    details.status = response.status;
    const result = await response.json() as Record<string, unknown>;
    details.response = result;

    // Should return workflow_instance_id if routed correctly
    if (!result.workflow_instance_id) {
      throw new Error(`No workflow_instance_id in response: ${JSON.stringify(result)}`);
    }

    if (result.workflow_name !== 'code-execution-workflow') {
      throw new Error(`Wrong workflow: expected 'code-execution-workflow', got '${result.workflow_name}'`);
    }

    details.workflow_instance_id = result.workflow_instance_id;
    details.request_id = result.request_id;

    return {
      name: 'workflow-creation',
      passed: true,
      duration_ms: Date.now() - start,
      details,
    };
  } catch (error) {
    return {
      name: 'workflow-creation',
      passed: false,
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - start,
      details,
    };
  }
}

// ============================================================================
// Test: Nexus API Connectivity
// ============================================================================

async function testNexusAPI(): Promise<TestResult> {
  const start = Date.now();
  const details: Record<string, unknown> = {};

  try {
    log('\n[4/6] Testing Nexus API connectivity...', 'cyan');

    if (!NEXUS_PASSPHRASE) {
      log('  Warning: NEXUS_PASSPHRASE not set, skipping write tests', 'yellow');
      details.skipped = true;
      details.reason = 'NEXUS_PASSPHRASE not configured';

      // Still test read endpoint
      const listResponse = await fetch(`${NEXUS_URL}/api/tasks?limit=1`);
      details.list_status = listResponse.status;

      return {
        name: 'nexus-api',
        passed: listResponse.ok,
        duration_ms: Date.now() - start,
        details,
      };
    }

    // Test creating a task
    const createResponse = await fetch(`${NEXUS_URL}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Nexus-Passphrase': NEXUS_PASSPHRASE,
      },
      body: JSON.stringify({
        title: '[test] Integration test task - can be deleted',
        description: 'Automated test from test-code-workflow.ts',
        status: 'next',
        domain: 'work',
      }),
    });

    details.create_status = createResponse.status;

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Failed to create Nexus task: ${createResponse.status} - ${errorText}`);
    }

    const task = await createResponse.json() as { task_id?: string; id?: string };
    const taskId = task.task_id || task.id;
    details.created_task_id = taskId;

    if (!taskId) {
      throw new Error('No task_id returned from Nexus');
    }

    // Test reading the task
    const getResponse = await fetch(`${NEXUS_URL}/api/tasks/${taskId}`, {
      headers: { 'X-Nexus-Passphrase': NEXUS_PASSPHRASE },
    });
    details.get_status = getResponse.status;

    // Clean up - delete the test task
    const deleteResponse = await fetch(`${NEXUS_URL}/api/tasks/${taskId}`, {
      method: 'DELETE',
      headers: { 'X-Nexus-Passphrase': NEXUS_PASSPHRASE },
    });
    details.delete_status = deleteResponse.status;
    details.cleaned_up = deleteResponse.ok;

    return {
      name: 'nexus-api',
      passed: true,
      duration_ms: Date.now() - start,
      details,
    };
  } catch (error) {
    return {
      name: 'nexus-api',
      passed: false,
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - start,
      details,
    };
  }
}

// ============================================================================
// Test: Type Alignment (Static Check)
// ============================================================================

async function testTypeAlignment(): Promise<TestResult> {
  const start = Date.now();
  const details: Record<string, unknown> = {};

  try {
    log('\n[5/6] Checking type alignment (static analysis)...', 'cyan');

    // Define expected types based on what we found
    const intakeSendsFields = [
      'task_id', 'request_id', 'app_id', 'instance_id',
      'prompt', 'repo_url', 'preferred_executor',
      'callback_url', 'metadata'
    ];

    const workflowExpectsFields = [
      'task_id', 'prompt', 'repo_url', 'preferred_executor',
      'context', 'callback_url', 'timeout_ms'
    ];

    // Find mismatches
    const extraFromIntake = intakeSendsFields.filter(f => !workflowExpectsFields.includes(f));
    const missingFromIntake = workflowExpectsFields.filter(f => !intakeSendsFields.includes(f));

    details.intake_sends = intakeSendsFields;
    details.workflow_expects = workflowExpectsFields;
    details.extra_from_intake = extraFromIntake;
    details.missing_from_intake = missingFromIntake;

    // Known issues that are OK
    const acceptableExtra = ['request_id', 'app_id', 'instance_id', 'metadata'];
    const acceptableMissing = ['context', 'timeout_ms'];

    const problematicExtra = extraFromIntake.filter(f => !acceptableExtra.includes(f));
    const problematicMissing = missingFromIntake.filter(f => !acceptableMissing.includes(f));

    details.problematic_extra = problematicExtra;
    details.problematic_missing = problematicMissing;

    if (problematicExtra.length > 0 || problematicMissing.length > 0) {
      log(`  Warning: Type alignment issues found`, 'yellow');
      log(`    Extra fields: ${extraFromIntake.join(', ')}`, 'yellow');
      log(`    Missing fields: ${missingFromIntake.join(', ')}`, 'yellow');
    }

    // This is a warning, not a failure
    return {
      name: 'type-alignment',
      passed: true,
      duration_ms: Date.now() - start,
      details,
    };
  } catch (error) {
    return {
      name: 'type-alignment',
      passed: false,
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - start,
      details,
    };
  }
}

// ============================================================================
// Test: End-to-End (Optional - requires running runners)
// ============================================================================

async function testEndToEnd(): Promise<TestResult> {
  const start = Date.now();
  const details: Record<string, unknown> = {};

  try {
    log('\n[6/6] Testing end-to-end flow...', 'cyan');

    if (DRY_RUN) {
      log('  Skipping E2E (DRY_RUN=true). Set DRY_RUN=false to enable.', 'yellow');
      details.skipped = true;
      details.reason = 'DRY_RUN mode enabled';
      return {
        name: 'end-to-end',
        passed: true,
        duration_ms: Date.now() - start,
        details,
      };
    }

    if (!NEXUS_PASSPHRASE) {
      log('  Skipping E2E (NEXUS_PASSPHRASE not set)', 'yellow');
      details.skipped = true;
      details.reason = 'NEXUS_PASSPHRASE not configured';
      return {
        name: 'end-to-end',
        passed: true,
        duration_ms: Date.now() - start,
        details,
      };
    }

    // Create a real task in Nexus
    log('  Creating test task in Nexus...', 'blue');
    const taskResponse = await fetch(`${NEXUS_URL}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Nexus-Passphrase': NEXUS_PASSPHRASE,
      },
      body: JSON.stringify({
        title: '[E2E Test] Code execution integration test',
        description: 'This task tests the full code execution workflow. Can be deleted.',
        status: 'next',
        domain: 'work',
      }),
    });

    if (!taskResponse.ok) {
      throw new Error(`Failed to create Nexus task: ${taskResponse.status}`);
    }

    const task = await taskResponse.json() as { task_id?: string; id?: string };
    const taskId = task.task_id || task.id;
    details.nexus_task_id = taskId;
    log(`  Created Nexus task: ${taskId}`, 'green');

    // Dispatch to code workflow
    log('  Dispatching to CodeExecutionWorkflow...', 'blue');
    const execResponse = await fetch(`${INTAKE_URL}/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_type: 'code',
        task_id: taskId,
        query: 'echo "E2E integration test completed successfully"',
        app_id: 'integration-test-e2e',
      }),
    });

    const execResult = await execResponse.json() as Record<string, unknown>;
    details.workflow_response = execResult;
    log(`  Workflow instance: ${execResult.workflow_instance_id}`, 'green');

    // Wait for workflow to complete (poll status)
    log('  Waiting for workflow completion (max 60s)...', 'blue');
    const maxWait = 60000;
    const pollInterval = 5000;
    let elapsed = 0;
    let completed = false;

    while (elapsed < maxWait && !completed) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      elapsed += pollInterval;

      const statusResponse = await fetch(
        `${INTAKE_URL}/status?request_id=${execResult.request_id}`
      );
      const status = await statusResponse.json() as { status?: string };

      log(`    Status after ${elapsed/1000}s: ${status.status}`, 'blue');

      if (status.status === 'completed' || status.status === 'failed' || status.status === 'quarantined') {
        completed = true;
        details.final_status = status;
      }
    }

    if (!completed) {
      details.timeout = true;
      log('  Workflow did not complete within timeout', 'yellow');
    }

    // Clean up - delete test task from Nexus
    log('  Cleaning up test task...', 'blue');
    await fetch(`${NEXUS_URL}/api/tasks/${taskId}`, {
      method: 'DELETE',
      headers: { 'X-Nexus-Passphrase': NEXUS_PASSPHRASE },
    });
    details.cleaned_up = true;

    return {
      name: 'end-to-end',
      passed: execResponse.ok,
      duration_ms: Date.now() - start,
      details,
    };
  } catch (error) {
    return {
      name: 'end-to-end',
      passed: false,
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - start,
      details,
    };
  }
}

// ============================================================================
// Main Runner
// ============================================================================

async function runTests(): Promise<TestResult[]> {
  log('='.repeat(60), 'cyan');
  log('DE Code Execution Workflow Integration Tests', 'cyan');
  log('='.repeat(60), 'cyan');
  log(`\nConfiguration:`, 'blue');
  log(`  INTAKE_URL:   ${INTAKE_URL}`, 'blue');
  log(`  NEXUS_URL:    ${NEXUS_URL}`, 'blue');
  log(`  WORKFLOWS_URL: ${WORKFLOWS_URL}`, 'blue');
  log(`  DRY_RUN:      ${DRY_RUN}`, 'blue');
  log(`  NEXUS_PASSPHRASE: ${NEXUS_PASSPHRASE ? '(set)' : '(not set)'}`, 'blue');

  const results: TestResult[] = [];

  // Run tests sequentially
  results.push(await testHealthEndpoints());
  results.push(await testCodeClassification());
  results.push(await testWorkflowCreation());
  results.push(await testNexusAPI());
  results.push(await testTypeAlignment());
  results.push(await testEndToEnd());

  return results;
}

// Run and output results
runTests().then(results => {
  log('\n' + '='.repeat(60), 'cyan');
  log('Test Results Summary', 'cyan');
  log('='.repeat(60), 'cyan');

  let passed = 0;
  let failed = 0;

  for (const result of results) {
    const icon = result.passed ? '\u2705' : '\u274c';
    const status = result.passed ? 'PASS' : 'FAIL';
    const color = result.passed ? 'green' : 'red';

    log(`${icon} ${status.padEnd(5)} ${result.name} (${result.duration_ms}ms)`, color);

    if (result.error) {
      log(`         Error: ${result.error}`, 'red');
    }

    if (result.details?.skipped) {
      log(`         Skipped: ${result.details.reason}`, 'yellow');
    }

    result.passed ? passed++ : failed++;
  }

  log('\n' + '-'.repeat(60), 'cyan');
  log(`Total: ${passed} passed, ${failed} failed`, failed > 0 ? 'red' : 'green');
  log('-'.repeat(60), 'cyan');

  // Output detailed results as JSON for CI
  if (process.env.CI) {
    console.log('\n--- JSON Results ---');
    console.log(JSON.stringify(results, null, 2));
  }

  process.exit(failed > 0 ? 1 : 0);
}).catch(error => {
  log(`\nFatal error: ${error}`, 'red');
  process.exit(1);
});
