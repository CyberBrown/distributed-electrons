/**
 * CodeExecutionWorkflow
 *
 * Cloudflare Workflow for durable code execution via on-prem runners.
 * Handles code tasks from Nexus with:
 * - Automatic fallover from claude-runner to gemini-runner
 * - Retries with exponential backoff
 * - Crash recovery (resume from last checkpoint)
 * - Result reporting (success or quarantine)
 *
 * Steps:
 * 1. log-request: Log request receipt for visibility
 * 2. execute-primary: Attempt primary executor (claude-runner by default)
 * 3. execute-fallback: On failure, try gemini-runner
 * 4. report-result: Report completion status (success/quarantine)
 */

import { WorkflowEntrypoint, WorkflowStep, type WorkflowEvent } from 'cloudflare:workers';
import type { CodeExecutionParams, CodeExecutionEnv, ExecutionResult, RunnerResponse } from './types';

// Default runner URLs (via Cloudflare Tunnel)
const DEFAULT_CLAUDE_RUNNER_URL = 'https://claude-runner.shiftaltcreate.com';
const DEFAULT_GEMINI_RUNNER_URL = 'https://gemini-runner.shiftaltcreate.com';

export class CodeExecutionWorkflow extends WorkflowEntrypoint<CodeExecutionEnv, CodeExecutionParams> {
  /**
   * Main workflow execution
   */
  override async run(event: WorkflowEvent<CodeExecutionParams>, step: WorkflowStep) {
    const {
      task_id,
      prompt,
      repo_url,
      preferred_executor = 'claude',
      context,
      callback_url,
      timeout_ms = 300000, // 5 minutes default
    } = event.payload;

    console.log(`[CodeExecutionWorkflow] Starting for task ${task_id}`);
    console.log(`[CodeExecutionWorkflow] Preferred executor: ${preferred_executor}`);

    // Step 1: Log request receipt for visibility/tracking
    const requestLog = await step.do(
      'log-request',
      {
        retries: { limit: 2, delay: '1 second', backoff: 'exponential' },
        timeout: '10 seconds',
      },
      async () => {
        return this.logRequestReceipt(task_id, prompt, repo_url, preferred_executor);
      }
    );

    console.log(`[CodeExecutionWorkflow] Request logged: ${requestLog.logged_at}`);

    // Determine primary and fallback executors based on preference
    const primaryExecutor = preferred_executor === 'gemini' ? 'gemini' : 'claude';
    const fallbackExecutor = primaryExecutor === 'claude' ? 'gemini' : 'claude';

    // Step 2: Attempt primary executor
    let primaryResult: ExecutionResult | null = null;
    let primaryError: string | null = null;

    try {
      primaryResult = await step.do(
        'execute-primary',
        {
          retries: {
            limit: 2,
            delay: '5 seconds',
            backoff: 'exponential',
          },
          timeout: `${Math.ceil(timeout_ms / 1000)} seconds`,
        },
        async () => {
          return await this.executeOnRunner(
            primaryExecutor,
            task_id,
            prompt,
            repo_url,
            context,
            timeout_ms
          );
        }
      );
    } catch (error) {
      primaryError = error instanceof Error ? error.message : String(error);
      console.warn(`[CodeExecutionWorkflow] Primary executor (${primaryExecutor}) failed: ${primaryError}`);
    }

    // If primary succeeded, skip fallback
    if (primaryResult?.success) {
      console.log(`[CodeExecutionWorkflow] Primary executor succeeded for task ${task_id}`);
    } else {
      // Step 3: Attempt fallback executor
      console.log(`[CodeExecutionWorkflow] Attempting fallback executor: ${fallbackExecutor}`);

      try {
        primaryResult = await step.do(
          'execute-fallback',
          {
            retries: {
              limit: 2,
              delay: '5 seconds',
              backoff: 'exponential',
            },
            timeout: `${Math.ceil(timeout_ms / 1000)} seconds`,
          },
          async () => {
            return await this.executeOnRunner(
              fallbackExecutor,
              task_id,
              prompt,
              repo_url,
              context,
              timeout_ms
            );
          }
        );
      } catch (error) {
        const fallbackError = error instanceof Error ? error.message : String(error);
        console.error(`[CodeExecutionWorkflow] Fallback executor (${fallbackExecutor}) also failed: ${fallbackError}`);

        // Both executors failed - mark for quarantine
        primaryResult = {
          success: false,
          task_id,
          executor: fallbackExecutor,
          error: `Both executors failed. Primary (${primaryExecutor}): ${primaryError}. Fallback (${fallbackExecutor}): ${fallbackError}`,
          quarantine: true,
          duration_ms: 0,
        };
      }
    }

    // Step 4: Report result back
    const reportResult = await step.do(
      'report-result',
      {
        retries: {
          limit: 3,
          delay: '2 seconds',
          backoff: 'exponential',
        },
        timeout: '30 seconds',
      },
      async () => {
        return await this.reportResult(task_id, primaryResult!);
      }
    );

    console.log(`[CodeExecutionWorkflow] Result reported: ${reportResult.status}`);

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
            await this.sendCallback(callback_url, task_id, primaryResult!);
          } catch (error) {
            // Log but don't throw - callback is best effort
            console.warn(`[CodeExecutionWorkflow] Callback failed: ${error}`);
          }
        }
      );
    }

    console.log(`[CodeExecutionWorkflow] Completed for task ${task_id}`);

    return {
      success: primaryResult!.success,
      task_id,
      executor: primaryResult!.executor,
      output: primaryResult!.output,
      error: primaryResult!.error,
      quarantine: primaryResult!.quarantine || false,
      duration_ms: primaryResult!.duration_ms,
    };
  }

  /**
   * Log request receipt for visibility/tracking
   */
  private async logRequestReceipt(
    taskId: string,
    prompt: string,
    repoUrl?: string,
    executor?: string
  ): Promise<{ logged_at: string; task_id: string }> {
    const now = new Date().toISOString();

    // Update task status in D1 if available
    if (this.env.DB) {
      try {
        await this.env.DB.prepare(`
          UPDATE tasks SET
            status = 'processing',
            started_at = ?,
            executor = ?
          WHERE id = ?
        `).bind(now, executor, taskId).run();
      } catch (error) {
        // Log but don't fail - D1 update is best effort
        console.warn(`[CodeExecutionWorkflow] Failed to update task status in D1: ${error}`);
      }
    }

    console.log(`[CodeExecutionWorkflow] Task ${taskId} logged at ${now}`);
    console.log(`[CodeExecutionWorkflow] Prompt length: ${prompt.length} chars`);
    if (repoUrl) {
      console.log(`[CodeExecutionWorkflow] Repo URL: ${repoUrl}`);
    }

    return { logged_at: now, task_id: taskId };
  }

  /**
   * Execute task on specified runner
   */
  private async executeOnRunner(
    executorType: 'claude' | 'gemini',
    taskId: string,
    prompt: string,
    repoUrl?: string,
    context?: Record<string, unknown>,
    timeoutMs: number = 300000
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    // Get runner URL and secret based on executor type
    const runnerUrl = executorType === 'claude'
      ? (this.env.CLAUDE_RUNNER_URL || DEFAULT_CLAUDE_RUNNER_URL)
      : (this.env.GEMINI_RUNNER_URL || DEFAULT_GEMINI_RUNNER_URL);

    const runnerSecret = executorType === 'claude'
      ? this.env.RUNNER_SECRET
      : this.env.GEMINI_RUNNER_SECRET;

    if (!runnerSecret) {
      throw new Error(`${executorType.toUpperCase()}_RUNNER_SECRET not configured`);
    }

    console.log(`[CodeExecutionWorkflow] Executing on ${executorType} runner at ${runnerUrl}`);

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Runner-Secret': runnerSecret,
      'X-Request-ID': taskId,
    };

    // Add Cloudflare Access service token headers if configured
    if (this.env.CF_ACCESS_CLIENT_ID && this.env.CF_ACCESS_CLIENT_SECRET) {
      headers['CF-Access-Client-Id'] = this.env.CF_ACCESS_CLIENT_ID;
      headers['CF-Access-Client-Secret'] = this.env.CF_ACCESS_CLIENT_SECRET;
    }

    try {
      const response = await fetch(`${runnerUrl}/execute`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prompt,
          repo_url: repoUrl,
          timeout_ms: timeoutMs,
          context,
        }),
      });

      const result = await response.json() as RunnerResponse;
      const duration = Date.now() - startTime;

      if (!result.success) {
        // Check for OAuth/auth errors that shouldn't trigger fallback
        if (result.error?.includes('OAuth') || result.error?.includes('authentication')) {
          console.error(`[CodeExecutionWorkflow] ${executorType} runner auth error: ${result.error}`);
        }
        throw new Error(result.error || `${executorType} runner failed`);
      }

      return {
        success: true,
        task_id: taskId,
        executor: executorType,
        output: result.output,
        exit_code: result.exit_code,
        duration_ms: duration,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[CodeExecutionWorkflow] ${executorType} runner error: ${errorMessage}`);
      throw new Error(`${executorType} runner failed: ${errorMessage}`);
    }
  }

  /**
   * Report execution result back to config-service
   */
  private async reportResult(
    taskId: string,
    result: ExecutionResult
  ): Promise<{ status: string; reported_at: string }> {
    const now = new Date().toISOString();

    // Update task status in D1
    if (this.env.DB) {
      try {
        const status = result.quarantine ? 'quarantined' : (result.success ? 'completed' : 'failed');
        await this.env.DB.prepare(`
          UPDATE tasks SET
            status = ?,
            completed_at = ?,
            output = ?,
            error = ?,
            exit_code = ?,
            duration_ms = ?
          WHERE id = ?
        `).bind(
          status,
          now,
          result.output || null,
          result.error || null,
          result.exit_code ?? null,
          result.duration_ms,
          taskId
        ).run();
      } catch (error) {
        console.warn(`[CodeExecutionWorkflow] Failed to update task result in D1: ${error}`);
      }
    }

    // Emit event to config-service if available
    if (this.env.CONFIG_SERVICE_URL) {
      try {
        const eventType = result.quarantine
          ? 'task.quarantined'
          : (result.success ? 'task.completed' : 'task.failed');

        await fetch(`${this.env.CONFIG_SERVICE_URL}/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenant_id: 'system',
            action: eventType,
            eventable_type: 'task',
            eventable_id: taskId,
            particulars: {
              task_id: taskId,
              executor: result.executor,
              success: result.success,
              quarantine: result.quarantine,
              duration_ms: result.duration_ms,
              timestamp: now,
            },
          }),
        });
      } catch (error) {
        console.warn(`[CodeExecutionWorkflow] Failed to emit event: ${error}`);
      }
    }

    return {
      status: result.quarantine ? 'quarantined' : (result.success ? 'completed' : 'failed'),
      reported_at: now,
    };
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
