/**
 * Queue-Aware Routing
 * Checks Nexus queue depth and routes text-compatible tasks to text-only tier
 * when the code execution queue is congested.
 */

import type { RouterEnv, TextOptions } from './types';
import { classifyRoutingTier } from './text-only-router';

/**
 * Queue status from Nexus
 */
interface QueueStatus {
  executor_type: string;
  queued: number;
  claimed: number;
  dispatched: number;
}

/**
 * Cache for queue status to avoid excessive API calls
 */
interface QueueCache {
  status: QueueStatus | null;
  fetchedAt: number;
}

const queueCache: QueueCache = {
  status: null,
  fetchedAt: 0,
};

// Cache TTL: 30 seconds
const CACHE_TTL_MS = 30000;

// Default queue depth threshold
const DEFAULT_QUEUE_THRESHOLD = 5;

/**
 * Get queue depth threshold from environment
 */
function getQueueThreshold(env: RouterEnv): number {
  if (env.QUEUE_DEPTH_THRESHOLD) {
    const parsed = parseInt(env.QUEUE_DEPTH_THRESHOLD, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_QUEUE_THRESHOLD;
}

/**
 * Fetch queue status from Nexus
 * Returns null if Nexus is not configured or unreachable
 */
async function fetchQueueStatus(env: RouterEnv): Promise<QueueStatus | null> {
  // Check if Nexus is configured
  if (!env.NEXUS_URL) {
    return null;
  }

  // Check cache
  const now = Date.now();
  if (queueCache.status && (now - queueCache.fetchedAt) < CACHE_TTL_MS) {
    return queueCache.status;
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add service token if available
    if (env.NEXUS_SERVICE_TOKEN) {
      headers['CF-Access-Client-Id'] = 'service-token';
      headers['CF-Access-Client-Secret'] = env.NEXUS_SERVICE_TOKEN;
    }

    // Fetch queue stats from Nexus MCP endpoint
    const response = await fetch(`${env.NEXUS_URL}/api/queue/stats`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      console.warn(`Failed to fetch Nexus queue status: ${response.status}`);
      return null;
    }

    const data = await response.json() as {
      success: boolean;
      by_executor?: Record<string, {
        queued?: number;
        claimed?: number;
        dispatched?: number;
      }>;
    };

    if (!data.success || !data.by_executor) {
      return null;
    }

    // Get claude-code queue status
    const codeQueue = data.by_executor['claude-code'];
    if (!codeQueue) {
      return null;
    }

    const status: QueueStatus = {
      executor_type: 'claude-code',
      queued: codeQueue.queued || 0,
      claimed: codeQueue.claimed || 0,
      dispatched: codeQueue.dispatched || 0,
    };

    // Update cache
    queueCache.status = status;
    queueCache.fetchedAt = now;

    return status;
  } catch (error) {
    console.error('Error fetching Nexus queue status:', error);
    return null;
  }
}

/**
 * Check if the code queue is congested
 */
export async function isCodeQueueCongested(env: RouterEnv): Promise<boolean> {
  const status = await fetchQueueStatus(env);
  if (!status) {
    return false; // Can't determine, assume not congested
  }

  const threshold = getQueueThreshold(env);
  const totalPending = status.queued + status.claimed + status.dispatched;

  console.log(`Code queue status: ${totalPending} pending (threshold: ${threshold})`);

  return totalPending >= threshold;
}

/**
 * Determine if a request should be rerouted to text-only tier based on queue status
 */
export async function shouldUseTextOnlyTier(
  prompt: string,
  options: TextOptions | undefined,
  env: RouterEnv
): Promise<{
  useTextOnly: boolean;
  reason: string;
}> {
  // First check if the request is explicitly marked for a tier
  if (options?.routing_tier === 'code') {
    return { useTextOnly: false, reason: 'explicitly marked as code tier' };
  }

  if (options?.routing_tier === 'text-only') {
    return { useTextOnly: true, reason: 'explicitly marked as text-only' };
  }

  // Classify the task
  const tier = classifyRoutingTier(prompt, options);

  // If definitely a code task, use code tier
  if (tier === 'code') {
    return { useTextOnly: false, reason: 'classified as code task' };
  }

  // If text-only, use text-only tier
  if (tier === 'text-only') {
    return { useTextOnly: true, reason: 'classified as text-only task' };
  }

  // For auto-classified tasks, check queue congestion
  const congested = await isCodeQueueCongested(env);
  if (congested) {
    // Check if this task is text-compatible (not explicitly code)
    // For ambiguous tasks during congestion, prefer text-only tier
    const isTextCompatible = !options?.task_type ||
      !['code_generation', 'planning', 'tool_use', 'agentic'].includes(options.task_type);

    if (isTextCompatible) {
      return { useTextOnly: true, reason: 'queue congested, routing to text-only' };
    }
  }

  return { useTextOnly: false, reason: 'defaulting to standard routing' };
}

/**
 * Get current queue status for monitoring
 */
export async function getQueueStatus(env: RouterEnv): Promise<QueueStatus | null> {
  return fetchQueueStatus(env);
}

/**
 * Clear the queue status cache (useful for testing)
 */
export function clearQueueCache(): void {
  queueCache.status = null;
  queueCache.fetchedAt = 0;
}
