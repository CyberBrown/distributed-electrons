/**
 * Nexus Callback Library
 *
 * Handles reporting execution results back to Nexus MCP server.
 * - Updates task status (complete/failed/quarantined)
 * - Tracks retry counts for failed tasks
 * - Quarantines tasks after MAX_RETRIES failures
 * - Sends ntfy notifications on quarantine (optional)
 *
 * API Endpoints Used:
 * - POST /api/queue/{queue_id}/complete - Complete a queue task with result
 * - PATCH /api/tasks/{task_id} - Update task status/fields
 * - GET /api/tasks/{task_id} - Get task details including retry count
 */

import type {
  NexusEnv,
  NexusExecutionResult,
  NexusTaskUpdatePayload,
  NexusResponse,
} from '../types';

// Re-export NexusEnv for convenience
export type { NexusEnv, NexusExecutionResult };

/** Maximum retry attempts before quarantine */
const MAX_RETRIES = 5;

/** Default Nexus API URL */
const DEFAULT_NEXUS_URL = 'https://nexus-mcp.solamp.workers.dev';

/** API base path */
const API_PREFIX = '/api';

/**
 * Report execution result to Nexus
 *
 * @param env - Environment bindings including Nexus config
 * @param result - Execution result to report
 * @returns true if report was successful, false otherwise
 */
export async function reportToNexus(
  env: NexusEnv,
  result: NexusExecutionResult
): Promise<boolean> {
  const nexusUrl = env.NEXUS_API_URL || DEFAULT_NEXUS_URL;
  const passphrase = env.NEXUS_PASSPHRASE;

  if (!passphrase) {
    console.warn('[NexusCallback] NEXUS_PASSPHRASE not configured, skipping report');
    return false;
  }

  console.log(`[NexusCallback] Reporting result for task ${result.task_id} to Nexus`);
  console.log(`[NexusCallback] Success: ${result.success}, Executor: ${result.executor_used}`);

  try {
    if (result.success) {
      // Success case: mark task complete
      return await markTaskComplete(nexusUrl, passphrase, result);
    } else {
      // Failure case: increment retry count, potentially quarantine
      return await handleTaskFailure(env, nexusUrl, passphrase, result);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[NexusCallback] Failed to report to Nexus: ${errorMessage}`);
    return false;
  }
}

/**
 * Mark a task as completed in Nexus
 */
async function markTaskComplete(
  nexusUrl: string,
  passphrase: string,
  result: NexusExecutionResult
): Promise<boolean> {
  // Build payload for potential future use (currently using inline object for simplified endpoint)
  const _payload: NexusTaskUpdatePayload = {
    task_id: result.task_id,
    status: 'completed',
    result: {
      output: result.output,
      executor: result.executor_used,
      duration_ms: result.duration_ms,
      exit_code: result.exit_code,
    },
  };

  // Use the complete_task endpoint with notes containing the result
  const response = await fetch(`${nexusUrl}${API_PREFIX}/tasks/${result.task_id}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Passphrase': passphrase,
    },
    body: JSON.stringify({
      notes: `Completed by ${result.executor_used} in ${result.duration_ms}ms. Output: ${(result.output || '').substring(0, 500)}`,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Nexus API error (${response.status}): ${errorText}`);
  }

  const data = await response.json() as NexusResponse;
  console.log(`[NexusCallback] Task ${result.task_id} marked complete in Nexus`);
  return data.success;
}

/**
 * Handle task failure - increment retry count and potentially quarantine
 */
async function handleTaskFailure(
  env: NexusEnv,
  nexusUrl: string,
  passphrase: string,
  result: NexusExecutionResult
): Promise<boolean> {
  // First, get current retry count from Nexus
  const retryCount = await getTaskRetryCount(nexusUrl, passphrase, result.task_id);
  const newRetryCount = retryCount + 1;

  console.log(`[NexusCallback] Task ${result.task_id} failure #${newRetryCount} of ${MAX_RETRIES}`);

  // Check if we should quarantine
  const shouldQuarantine = newRetryCount >= MAX_RETRIES;

  const payload: NexusTaskUpdatePayload = {
    task_id: result.task_id,
    status: shouldQuarantine ? 'quarantined' : 'failed',
    result: {
      error: result.error,
      executor: result.executor_used,
      duration_ms: result.duration_ms,
      exit_code: result.exit_code,
    },
    retry_count: newRetryCount,
  };

  if (shouldQuarantine) {
    payload.quarantine_reason = `Failed after ${MAX_RETRIES} attempts. Last error: ${result.error}`;
    console.warn(`[NexusCallback] Task ${result.task_id} quarantined after ${MAX_RETRIES} failures`);

    // Send ntfy notification on quarantine
    await sendQuarantineNotification(env, result, newRetryCount);
  }

  // Use the update_task endpoint to update status
  const updatePayload: Record<string, unknown> = {
    status: shouldQuarantine ? 'cancelled' : 'next',  // 'next' to retry, 'cancelled' for quarantine
    description: shouldQuarantine
      ? `QUARANTINED: ${payload.quarantine_reason}`
      : `Failed attempt #${newRetryCount}: ${result.error}`,
  };

  const response = await fetch(`${nexusUrl}${API_PREFIX}/tasks/${result.task_id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Passphrase': passphrase,
    },
    body: JSON.stringify(updatePayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Nexus API error (${response.status}): ${errorText}`);
  }

  const data = await response.json() as NexusResponse;
  console.log(`[NexusCallback] Task ${result.task_id} updated in Nexus (status: ${payload.status})`);
  return data.success;
}

/**
 * Get current retry count for a task from Nexus
 */
async function getTaskRetryCount(
  nexusUrl: string,
  passphrase: string,
  taskId: string
): Promise<number> {
  try {
    // Use task status endpoint to get current state
    const response = await fetch(`${nexusUrl}${API_PREFIX}/tasks/${taskId}/status`, {
      method: 'GET',
      headers: {
        'X-Passphrase': passphrase,
      },
    });

    if (!response.ok) {
      // Try alternate endpoint format
      const altResponse = await fetch(`${nexusUrl}${API_PREFIX}/tasks/${taskId}`, {
        method: 'GET',
        headers: {
          'X-Passphrase': passphrase,
        },
      });

      if (!altResponse.ok) {
        console.warn(`[NexusCallback] Could not get retry count for task ${taskId}, assuming 0`);
        return 0;
      }

      const altData = await altResponse.json() as { retry_count?: number; execution_attempts?: number };
      return altData.retry_count || altData.execution_attempts || 0;
    }

    const data = await response.json() as { retry_count?: number; execution_attempts?: number };
    return data.retry_count || data.execution_attempts || 0;
  } catch (error) {
    console.warn(`[NexusCallback] Error getting retry count: ${error}`);
    return 0;
  }
}

/**
 * Send ntfy notification when a task is quarantined
 */
async function sendQuarantineNotification(
  env: NexusEnv,
  result: NexusExecutionResult,
  retryCount: number
): Promise<void> {
  const ntfyTopic = env.NTFY_TOPIC;

  if (!ntfyTopic) {
    console.log('[NexusCallback] NTFY_TOPIC not configured, skipping notification');
    return;
  }

  try {
    const message = [
      `Task ${result.task_id} quarantined`,
      `Executor: ${result.executor_used}`,
      `Retries: ${retryCount}/${MAX_RETRIES}`,
      `Error: ${result.error || 'Unknown error'}`,
    ].join('\n');

    await fetch(`https://ntfy.sh/${ntfyTopic}`, {
      method: 'POST',
      headers: {
        'Title': 'DE Task Quarantined',
        'Priority': 'high',
        'Tags': 'warning,robot',
      },
      body: message,
    });

    console.log(`[NexusCallback] Quarantine notification sent to ntfy/${ntfyTopic}`);
  } catch (error) {
    console.warn(`[NexusCallback] Failed to send ntfy notification: ${error}`);
  }
}

/**
 * Check if Nexus is configured and available
 */
export async function checkNexusHealth(env: NexusEnv): Promise<boolean> {
  const nexusUrl = env.NEXUS_API_URL || DEFAULT_NEXUS_URL;

  try {
    // Root endpoint returns health status
    const response = await fetch(`${nexusUrl}/`, {
      method: 'GET',
    });

    if (response.ok) {
      const data = await response.json() as { status?: string };
      return data.status === 'healthy';
    }
    return false;
  } catch {
    return false;
  }
}
