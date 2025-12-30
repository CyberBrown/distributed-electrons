/**
 * CodeExecutionWorkflow
 *
 * Cloudflare Workflow for durable code execution via sandbox-executor.
 * Handles code tasks from Nexus with:
 * - Validation step to catch bad tasks early
 * - Execution via sandbox-executor (which routes to runners and handles fallback)
 * - Error classification to decide retry vs quarantine
 * - Retries with exponential backoff
 * - Crash recovery (resume from last checkpoint)
 * - Nexus callback with retry tracking and quarantine
 *
 * Steps:
 * 1. validate-task: Validate task parameters and classify early errors
 * 2. execute-task: Execute via sandbox-executor (handles runner routing + fallback)
 * 3. classify-error: On failure, decide whether to retry, fallback, or quarantine
 * 4. report-to-nexus: Report result to Nexus MCP server
 * 5. send-callback: Optional client callback notification
 */

import { WorkflowEntrypoint, WorkflowStep, type WorkflowEvent } from 'cloudflare:workers';
import type { CodeExecutionParams, ExecutionResult } from './types';
import type { NexusEnv } from './lib/nexus-callback';
import { reportToNexus } from './lib/nexus-callback';

// ============================================================================
// Failure Indicator Detection (Defense-in-Depth)
// Catches cases where AI reports success but output shows it couldn't complete
// ============================================================================

/**
 * Failure indicators that suggest the AI reported success but didn't actually complete the task.
 * This is a SUBSET of the full list - focused on the most common false-positive patterns.
 * The full list is in:
 * - nexus/src/lib/validation.ts (canonical source)
 * - sandbox-executor/src/index.ts
 * - nexus-callback.ts
 */
const FAILURE_INDICATORS = [
  // Most common false-positive patterns
  "couldn't find", "could not find", "can't find", "cannot find",
  "doesn't have", "does not have", "not found",
  "doesn't exist", "does not exist", "file not found",
  "repo not found", "project not found", "reference not found",
  "failed to", "unable to", "i can't", "i cannot",
  "couldn't complete", "could not complete", "unable to complete",
  // Idea-specific patterns (critical for this use case)
  "idea reference doesn't", "idea reference does not",
  "doesn't have a corresponding", "does not have a corresponding",
  "file i can find", "no corresponding file",
  "no repo was created", "no worker deployed", "no database created",
  // Setup/initialization patterns
  "hasn't been created", "hasn't set up", "hasn't found",
  "need to create", "needs to be created", "must be created",
] as const;

/**
 * Normalize text for comparison by replacing curly quotes with straight quotes.
 */
function normalizeQuotes(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"');
}

/**
 * Check if output contains failure indicators suggesting the AI didn't complete the task.
 * Returns the matched indicator for logging, or null if no match.
 */
function findFailureIndicator(output: string | undefined): string | null {
  if (!output) return null;
  const normalized = normalizeQuotes(output.toLowerCase());
  for (const indicator of FAILURE_INDICATORS) {
    if (normalized.includes(indicator)) {
      return indicator;
    }
  }
  return null;
}

// Default sandbox-executor URL
const DEFAULT_SANDBOX_EXECUTOR_URL = 'https://sandbox-executor.solamp.workers.dev';

// Error classification types
type ErrorAction = 'retry' | 'try-fallback' | 'quarantine';

interface ValidationResult {
  valid: boolean;
  error?: string;
  action?: ErrorAction;
}

interface ClassificationResult {
  action: ErrorAction;
  reason: string;
}

export class CodeExecutionWorkflow extends WorkflowEntrypoint<NexusEnv, CodeExecutionParams> {
  /**
   * Main workflow execution
   */
  override async run(event: WorkflowEvent<CodeExecutionParams>, step: WorkflowStep) {
    const {
      task_id,
      prompt,
      repo_url,
      preferred_executor = 'claude',
      context: _context,
      callback_url,
      timeout_ms = 300000, // 5 minutes default
    } = event.payload;

    console.log(`[CodeExecutionWorkflow] Starting for task ${task_id}`);
    console.log(`[CodeExecutionWorkflow] Preferred executor: ${preferred_executor}`);

    // Step 1: Validate task parameters
    const validation = await step.do(
      'validate-task',
      {
        retries: { limit: 1, delay: '1 second', backoff: 'constant' },
        timeout: '10 seconds',
      },
      async () => {
        return this.validateTask(task_id, prompt, repo_url);
      }
    );

    // If validation failed, report error and exit early
    if (!validation.valid) {
      console.error(`[CodeExecutionWorkflow] Validation failed: ${validation.error}`);

      // Report validation error to Nexus
      await step.do(
        'report-validation-error',
        {
          retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' },
          timeout: '30 seconds',
        },
        async () => {
          await reportToNexus(this.env, {
            task_id,
            success: false,
            error: validation.error || 'Validation failed',
            executor_used: 'none',
            duration_ms: 0,
          });
          return { reported: true };
        }
      );

      return {
        success: false,
        task_id,
        executor: 'none' as const,
        error: validation.error,
        quarantine: validation.action === 'quarantine',
        duration_ms: 0,
      };
    }

    console.log(`[CodeExecutionWorkflow] Task validated successfully`);

    // Step 2: Execute via sandbox-executor (handles runner routing + fallback)
    let result: ExecutionResult;

    try {
      result = await step.do(
        'execute-task',
        {
          retries: {
            limit: 2,
            delay: '10 seconds',
            backoff: 'exponential',
          },
          timeout: `${Math.ceil(timeout_ms / 1000)} seconds`,
        },
        async () => {
          return await this.executeViaSandbox(
            task_id,
            prompt,
            repo_url,
            preferred_executor,
            timeout_ms
          );
        }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[CodeExecutionWorkflow] Execution failed: ${errorMessage}`);

      // Step 3: Classify the error to decide action
      const classification = await step.do(
        'classify-error',
        {
          retries: { limit: 1, delay: '1 second', backoff: 'constant' },
          timeout: '5 seconds',
        },
        async () => {
          return this.classifyError(errorMessage);
        }
      );

      console.log(`[CodeExecutionWorkflow] Error classified: ${classification.action} - ${classification.reason}`);

      // If we should try fallback executor
      if (classification.action === 'try-fallback') {
        const fallbackExecutor = preferred_executor === 'claude' ? 'gemini' : 'claude';
        console.log(`[CodeExecutionWorkflow] Trying fallback executor: ${fallbackExecutor}`);

        try {
          result = await step.do(
            'execute-fallback',
            {
              retries: {
                limit: 2,
                delay: '10 seconds',
                backoff: 'exponential',
              },
              timeout: `${Math.ceil(timeout_ms / 1000)} seconds`,
            },
            async () => {
              return await this.executeViaSandbox(
                task_id,
                prompt,
                repo_url,
                fallbackExecutor,
                timeout_ms
              );
            }
          );
        } catch (fallbackError) {
          const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          console.error(`[CodeExecutionWorkflow] Fallback also failed: ${fallbackErrorMessage}`);

          result = {
            success: false,
            task_id,
            executor: fallbackExecutor,
            error: `Both executors failed. Primary: ${errorMessage}. Fallback: ${fallbackErrorMessage}`,
            quarantine: true,
            duration_ms: 0,
          };
        }
      } else {
        // Quarantine or retry failed - create failed result
        result = {
          success: false,
          task_id,
          executor: preferred_executor,
          error: errorMessage,
          quarantine: classification.action === 'quarantine',
          duration_ms: 0,
        };
      }
    }

    // Step 4: Report to Nexus
    const nexusReportResult = await step.do(
      'report-to-nexus',
      {
        retries: {
          limit: 3,
          delay: '2 seconds',
          backoff: 'exponential',
        },
        timeout: '30 seconds',
      },
      async () => {
        const reported = await reportToNexus(this.env, {
          task_id: task_id,
          success: result.success,
          output: result.output,
          error: result.error,
          exit_code: result.exit_code,
          executor_used: result.executor,
          duration_ms: result.duration_ms,
        });
        return { reported, timestamp: new Date().toISOString() };
      }
    );

    console.log(`[CodeExecutionWorkflow] Nexus report: ${nexusReportResult.reported ? 'success' : 'failed'}`);

    // Step 5: Send callback if configured (best effort)
    if (callback_url) {
      await step.do(
        'send-callback',
        {
          retries: {
            limit: 3,
            delay: '5 seconds',
            backoff: 'exponential',
          },
          timeout: '30 seconds',
        },
        async () => {
          try {
            await this.sendCallback(callback_url, task_id, result);
          } catch (error) {
            // Log but don't throw - callback is best effort
            console.warn(`[CodeExecutionWorkflow] Callback failed: ${error}`);
          }
        }
      );
    }

    console.log(`[CodeExecutionWorkflow] Completed for task ${task_id}`);

    return {
      success: result.success,
      task_id,
      executor: result.executor,
      output: result.output,
      error: result.error,
      quarantine: result.quarantine || false,
      duration_ms: result.duration_ms,
    };
  }

  /**
   * Validate task parameters before execution
   * Catches obvious issues early to avoid wasting execution time
   */
  private validateTask(
    taskId: string,
    prompt: string,
    repoUrl?: string
  ): ValidationResult {
    // Check required fields
    if (!taskId) {
      return { valid: false, error: 'Missing task_id', action: 'quarantine' };
    }

    if (!prompt || prompt.trim().length === 0) {
      return { valid: false, error: 'Missing or empty prompt', action: 'quarantine' };
    }

    // Check prompt length (avoid processing extremely short or long prompts)
    if (prompt.trim().length < 10) {
      return { valid: false, error: 'Prompt too short (minimum 10 characters)', action: 'quarantine' };
    }

    if (prompt.length > 100000) {
      return { valid: false, error: 'Prompt too long (maximum 100K characters)', action: 'quarantine' };
    }

    // Validate repo URL format if provided
    if (repoUrl) {
      try {
        const url = new URL(repoUrl);
        if (!['https:', 'http:', 'git:'].includes(url.protocol)) {
          return { valid: false, error: 'Invalid repo URL protocol (must be https, http, or git)', action: 'quarantine' };
        }
      } catch {
        return { valid: false, error: 'Invalid repo URL format', action: 'quarantine' };
      }
    }

    console.log(`[CodeExecutionWorkflow] Task ${taskId} validated: prompt length=${prompt.length}`);
    return { valid: true };
  }

  /**
   * Execute task via sandbox-executor
   * Sandbox-executor handles runner routing and fallback internally
   */
  private async executeViaSandbox(
    taskId: string,
    prompt: string,
    repoUrl?: string,
    executorType: 'claude' | 'gemini' = 'claude',
    timeoutMs: number = 300000
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const sandboxUrl = this.env.SANDBOX_EXECUTOR_URL || DEFAULT_SANDBOX_EXECUTOR_URL;

    console.log(`[CodeExecutionWorkflow] Executing via sandbox-executor at ${sandboxUrl}`);
    console.log(`[CodeExecutionWorkflow] Executor type: ${executorType}, Timeout: ${timeoutMs}ms`);

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Request-ID': taskId,
    };

    // Add sandbox executor secret if configured
    if (this.env.SANDBOX_EXECUTOR_SECRET) {
      headers['X-API-Key'] = this.env.SANDBOX_EXECUTOR_SECRET;
    }

    try {
      const response = await fetch(`${sandboxUrl}/execute`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          task: prompt,
          repo: repoUrl,
          executor_type: executorType,
          options: {
            timeout_ms: timeoutMs,
          },
        }),
      });

      const result = await response.json() as {
        success: boolean;
        logs?: string;
        error?: string;
        error_code?: string;
        metadata?: {
          execution_time_ms?: number;
          exit_code?: number;
          executor_type?: string;
        };
      };
      const duration = Date.now() - startTime;

      if (!result.success) {
        const errorMessage = result.error || result.error_code || 'Execution failed';
        console.error(`[CodeExecutionWorkflow] Sandbox execution failed: ${errorMessage}`);
        throw new Error(errorMessage);
      }

      // DEFENSE-IN-DEPTH: Even if sandbox-executor reports success, validate the output
      // for failure indicators. This catches cases where:
      // 1. An older version of sandbox-executor without false-positive detection is deployed
      // 2. A new failure pattern slips through sandbox-executor's checks
      // 3. The AI output contains subtle failure indicators
      const matchedIndicator = findFailureIndicator(result.logs);
      if (matchedIndicator) {
        console.warn(`[CodeExecutionWorkflow] FALSE POSITIVE DETECTED: "${matchedIndicator}"`);
        console.warn(`[CodeExecutionWorkflow] Output preview: ${(result.logs || '').substring(0, 300)}`);
        throw new Error(`FALSE_POSITIVE: AI reported success but output contains failure indicator: "${matchedIndicator}"`);
      }

      // Also check minimum output length - very short outputs are usually errors
      const outputLength = (result.logs || '').trim().length;
      if (outputLength < 100) {
        console.warn(`[CodeExecutionWorkflow] Output too short (${outputLength} chars), treating as failure`);
        throw new Error(`Output too short (${outputLength} chars) - likely indicates execution failure`);
      }

      return {
        success: true,
        task_id: taskId,
        executor: (result.metadata?.executor_type as 'claude' | 'gemini') || executorType,
        output: result.logs,
        exit_code: result.metadata?.exit_code,
        duration_ms: result.metadata?.execution_time_ms || duration,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[CodeExecutionWorkflow] Sandbox execution error: ${errorMessage}`);
      throw new Error(errorMessage);
    }
  }

  /**
   * Classify an error to decide what action to take
   * Returns: 'retry' (try again), 'try-fallback' (use other executor), or 'quarantine' (give up)
   */
  private classifyError(error: string): ClassificationResult {
    const e = error.toLowerCase();

    // Immediate quarantine - don't retry
    if (e.includes('invalid') || e.includes('missing required')) {
      return { action: 'quarantine', reason: 'Invalid input - will not retry' };
    }
    if (e.includes('unauthorized') || e.includes('authentication') || e.includes('oauth')) {
      return { action: 'quarantine', reason: 'Auth error - requires human intervention' };
    }
    if (e.includes('failed to classify') || e.includes('cannot parse')) {
      return { action: 'quarantine', reason: 'Task parsing failed - will not retry' };
    }
    // FALSE_POSITIVE errors indicate the AI couldn't actually complete the task
    // These should quarantine immediately - retrying won't help
    if (e.includes('false_positive') || e.includes('failure indicator')) {
      return { action: 'quarantine', reason: 'False positive detected - task not actually completed' };
    }
    // Short output errors also indicate fundamental issues with task execution
    if (e.includes('output too short')) {
      return { action: 'quarantine', reason: 'Output too short - task likely failed to execute' };
    }

    // Try fallback executor
    if (e.includes('unreachable') || e.includes('runner_unreachable')) {
      return { action: 'try-fallback', reason: 'Runner unreachable - trying fallback' };
    }
    if (e.includes('503') || e.includes('service unavailable')) {
      return { action: 'try-fallback', reason: 'Service unavailable - trying fallback' };
    }
    if (e.includes('timeout') || e.includes('timed out')) {
      return { action: 'try-fallback', reason: 'Execution timeout - trying fallback' };
    }
    if (e.includes('all_runners_failed')) {
      return { action: 'quarantine', reason: 'All runners failed - needs investigation' };
    }

    // Retry same executor (transient errors)
    if (e.includes('rate limit') || e.includes('too many requests') || e.includes('429')) {
      return { action: 'retry', reason: 'Rate limited - will retry' };
    }
    if (e.includes('overloaded') || e.includes('capacity')) {
      return { action: 'retry', reason: 'Server overloaded - will retry' };
    }
    if (e.includes('500') || e.includes('internal server error')) {
      return { action: 'try-fallback', reason: 'Server error - trying fallback' };
    }

    // Default: quarantine unknown errors
    return { action: 'quarantine', reason: `Unknown error: ${error.substring(0, 100)}` };
  }

  /**
   * Send callback to client application
   */
  private async sendCallback(
    callbackUrl: string,
    taskId: string,
    result: ExecutionResult
  ): Promise<void> {
    const payload = {
      task_id: taskId,
      status: result.quarantine ? 'quarantined' : (result.success ? 'completed' : 'failed'),
      executor: result.executor,
      output: result.output,
      error: result.error,
      duration_ms: result.duration_ms,
      timestamp: new Date().toISOString(),
    };

    const response = await fetch(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Callback failed (${response.status}): ${error}`);
    }
  }
}
