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

/**
 * Failure indicators that suggest the AI reported success but didn't actually complete the task.
 * These phrases in the output indicate the AI couldn't find resources, files, or complete the work.
 *
 * IMPORTANT: These are checked case-insensitively against the full output.
 * Add new patterns when you see tasks marked complete without actual work.
 */
const FAILURE_INDICATORS = [
  // Resource not found patterns
  "couldn't find",
  "could not find",
  "can't find",
  "cannot find",
  "doesn't have",
  "does not have",
  "not found",
  "no such file",
  "doesn't exist",
  "does not exist",
  "file not found",
  "directory not found",
  "repo not found",
  "repository not found",
  "project not found",
  "reference not found",
  "idea not found",
  // Failure action patterns
  "failed to",
  "unable to",
  "i can't",
  "i cannot",
  "i'm unable",
  "i am unable",
  "cannot locate",
  "couldn't locate",
  "couldn't create",
  "could not create",
  "wasn't able",
  "was not able",
  // Empty/missing result patterns
  "no matching",
  "nothing found",
  "no results",
  "empty result",
  "no data",
  // Explicit error indicators
  "error:",
  "error occurred",
  "exception:",
  // Task incomplete patterns
  "task incomplete",
  "could not complete",
  "couldn't complete",
  "unable to complete",
  "did not complete",
  "didn't complete",
  // Missing reference patterns (for idea-based tasks)
  "reference doesn't have",
  "reference does not have",
  "doesn't have a corresponding",
  "does not have a corresponding",
  "no corresponding file",
  "no corresponding project",
  "missing reference",
  "invalid reference",
  // Additional patterns for edge cases (added 2024-12)
  "i can find", // catches "file I can find" negation patterns
  "no repo",
  "no repository",
  "no project",
  "couldn't access",
  "could not access",
  "can't access",
  "cannot access",
  "no idea file",
  "idea file not",
  "idea reference not",
  "there is no",
  "there are no",
  "there isn't",
  "there aren't",
  "without a",
  "missing a",
  "lack of",
  "lacking",
  "haven't been created",
  "hasn't been created",
  "has not been created",
  "wasn't created",
  "were not created",
  "weren't created",
  "no github",
  "no cloudflare",
  "no d1",
  "no worker",
  "the task cannot",
  "the task could not",
  "this task cannot",
  // Additional patterns added 2024-12-30 after investigating false completions
  "idea reference doesn't",
  "idea reference does not",
  "file i can find", // catches "...a corresponding file I can find"
  "no repo was created",
  "no repository was created",
  "no worker deployed",
  "no database created",
  "completion result says", // meta-pattern for reflection about failed execution
  // Additional patterns to catch more edge cases
  "haven't found", "have not found", "hasn't found", "has not found",
  "haven't set up", "have not set up", "hasn't set up", "has not set up",
  "setup yet", "not initialized", "not been initialized",
  "no setup", "no configuration", "not configured",
  "doesn't appear", "does not appear", "didn't find", "did not find",
  "looked for", "searched for",
  "need to create", "needs to be created", "must be created",
  "should be created", "would need to", "will need to",
  "before i can", "before we can", "in order to",
  "prerequisite", "prerequisites", "first need",
  "no code", "no files", "no implementation",
  "empty repo", "empty repository", "blank project",
  "scaffold", "scaffolding", "boilerplate",
  "set up the project", "set up the repo", "create the project",
  "initialize the project", "initialize the repo",
  "project structure", "folder structure", "directory structure",
  "does not have any", "doesn't have any", "don't have any",
  "nothing has been", "nothing was", "nothing is",
  // Additional patterns added 2024-12-30 after further investigation
  "no action taken", "no changes made", "nothing to do",
  "can not proceed", "cannot proceed", "couldn't proceed", "could not proceed",
  "doesn't point to", "does not point to", "not pointing to",
  "no valid", "invalid path", "path does not exist",
  "no work done", "no work performed", "no work completed",
  "unable to locate", "unable to access", "unable to read",
  "nothing to commit", "nothing to deploy", "nothing to execute",
  "empty project", "empty directory", "empty folder",
  "does not contain", "doesn't contain", "not containing",
  "outside of", "not within", "not part of",
  "requires setup", "requires configuration", "requires initialization",
  "not yet implemented", "not implemented", "to be implemented",
  "placeholder", "stub", "todo:",
] as const;

/**
 * Normalize text for comparison by replacing curly quotes with straight quotes
 * This handles cases where AI outputs use typographic quotes instead of standard ASCII
 */
function normalizeQuotes(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")  // Single curly quotes → '
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"'); // Double curly quotes → "
}

/**
 * Check if the output contains failure indicators suggesting the AI didn't actually complete the task.
 * This prevents false positive completions where the AI says "I couldn't find X" but reports success.
 *
 * Normalizes quotes to handle typographic apostrophes (e.g., ' vs ') and logs the matched indicator.
 *
 * @returns Object with matched indicator for logging, or null if no match
 */
function findFailureIndicator(output: string | undefined): string | null {
  if (!output) return null;
  // Normalize quotes and convert to lowercase for comparison
  const normalizedOutput = normalizeQuotes(output.toLowerCase());
  for (const indicator of FAILURE_INDICATORS) {
    if (normalizedOutput.includes(indicator)) {
      return indicator;
    }
  }
  return null;
}

/**
 * Check if the output contains failure indicators suggesting the AI didn't actually complete the task.
 * This prevents false positive completions where the AI says "I couldn't find X" but reports success.
 */
function containsFailureIndicators(output: string | undefined): boolean {
  return findFailureIndicator(output) !== null;
}

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
      // SECURITY: Check minimum output length
      // Very short outputs typically indicate errors or non-execution
      const outputLength = (result.output || '').trim().length;
      if (outputLength < 100) {
        console.warn(`[NexusCallback] Task ${result.task_id} output too short (${outputLength} chars), treating as failure`);
        console.warn(`[NexusCallback] Short output: ${result.output}`);

        const shortOutputResult: NexusExecutionResult = {
          ...result,
          success: false,
          error: `Output too short (${outputLength} chars) - likely indicates execution failure. Output: ${result.output}`,
        };

        return await handleTaskFailure(env, nexusUrl, passphrase, shortOutputResult);
      }

      // Check for false positive success - AI reported success but output indicates failure
      const matchedIndicator = findFailureIndicator(result.output);

      if (matchedIndicator) {
        console.warn(`[NexusCallback] FALSE POSITIVE DETECTED for task ${result.task_id}`);
        console.warn(`[NexusCallback] Matched indicator: "${matchedIndicator}"`);
        console.warn(`[NexusCallback] Output length: ${(result.output || '').length} chars`);
        console.warn(`[NexusCallback] Output preview (first 300 chars): ${(result.output || '').substring(0, 300)}`);

        // Treat as failure - the AI said success but didn't actually complete the work
        const falsePositiveResult: NexusExecutionResult = {
          ...result,
          success: false,
          error: `False positive detected (matched: "${matchedIndicator}"): AI reported success but output indicates failure. Output: ${(result.output || '').substring(0, 500)}`,
        };

        return await handleTaskFailure(env, nexusUrl, passphrase, falsePositiveResult);
      }

      console.log(`[NexusCallback] Task ${result.task_id} passed false-positive check, marking complete`);
      // Genuine success case: mark task complete
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
  const response = await fetch(`${nexusUrl}${API_PREFIX}/tasks/${result.task_id}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Passphrase': passphrase,
    },
    body: JSON.stringify({
      // Increased from 500 to 2000 to ensure failure indicators aren't truncated away
      notes: `Completed by ${result.executor_used} in ${result.duration_ms}ms. Output: ${(result.output || '').substring(0, 2000)}`,
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
