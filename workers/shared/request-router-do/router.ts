/**
 * Request Router Durable Object
 * Central orchestration for async request processing
 *
 * Responsibilities:
 * - Accept requests from Intake Worker
 * - Classify task types
 * - Select optimal provider/model
 * - Manage per-provider queues with rate limiting
 * - Dispatch to processing workers
 * - Track request status
 */

import type {
  IntakeRequest,
  QueuedRequest,
  ProviderQueue,
  ProviderRateLimit,
  RouterState,
  RouterResponse,
  ProcessingNotification,
} from './types';
import { classifyQuery, classifyWithType, getEstimatedProcessingTime } from './classifier';

// Default rate limits per provider (can be overridden from DB)
const DEFAULT_RATE_LIMITS: Record<string, ProviderRateLimit> = {
  anthropic: {
    provider: 'anthropic',
    requests_per_minute: 50,
    tokens_per_minute: 100000,
    concurrent_requests: 10,
    current_rpm: 0,
    current_concurrent: 0,
    last_reset: Date.now(),
  },
  openai: {
    provider: 'openai',
    requests_per_minute: 60,
    tokens_per_minute: 90000,
    concurrent_requests: 10,
    current_rpm: 0,
    current_concurrent: 0,
    last_reset: Date.now(),
  },
  ideogram: {
    provider: 'ideogram',
    requests_per_minute: 30,
    concurrent_requests: 5,
    current_rpm: 0,
    current_concurrent: 0,
    last_reset: Date.now(),
  },
  gemini: {
    provider: 'gemini',
    requests_per_minute: 60,
    tokens_per_minute: 100000,
    concurrent_requests: 10,
    current_rpm: 0,
    current_concurrent: 0,
    last_reset: Date.now(),
  },
  elevenlabs: {
    provider: 'elevenlabs',
    requests_per_minute: 30,
    concurrent_requests: 5,
    current_rpm: 0,
    current_concurrent: 0,
    last_reset: Date.now(),
  },
  shotstack: {
    provider: 'shotstack',
    requests_per_minute: 10,
    concurrent_requests: 3,
    current_rpm: 0,
    current_concurrent: 0,
    last_reset: Date.now(),
  },
  // Sandbox executor (Claude Code with OAuth) - uses Claude.ai Max subscription
  // DISABLED: Set to 0 until on-prem Claude runner is deployed
  // OAuth keeps expiring on Cloudflare edge due to IP/geo issues
  // Re-enable once CLAUDE_RUNNER_URL is configured in sandbox-executor
  'sandbox-executor': {
    provider: 'sandbox-executor',
    requests_per_minute: 0,  // DISABLED - was 20
    concurrent_requests: 0,  // DISABLED - was 3
    current_rpm: 0,
    current_concurrent: 0,
    last_reset: Date.now(),
  },
};

export class RequestRouter implements DurableObject {
  private state: DurableObjectState;

  // In-memory state (backed by storage)
  private requests: Map<string, QueuedRequest> = new Map();
  private providerQueues: Map<string, ProviderQueue> = new Map();
  private initialized: boolean = false;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  /**
   * Handle incoming HTTP requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Initialize state from storage on first request
      if (!this.initialized) {
        await this.initialize();
      }

      // Route to handlers
      if (path === '/submit' && request.method === 'POST') {
        const body: IntakeRequest = await request.json();
        const result = await this.submitRequest(body);
        return Response.json(result);
      }

      if (path === '/status' && request.method === 'GET') {
        const requestId = url.searchParams.get('request_id');
        if (!requestId) {
          return Response.json({ error: 'request_id required' }, { status: 400 });
        }
        const result = await this.getRequestStatus(requestId);
        return Response.json(result);
      }

      if (path === '/cancel' && request.method === 'POST') {
        const body = await request.json() as { request_id: string };
        const result = await this.cancelRequest(body.request_id);
        return Response.json(result);
      }

      if (path === '/complete' && request.method === 'POST') {
        const body = await request.json() as { request_id: string; success: boolean; error?: string };
        const result = await this.completeRequest(body.request_id, body.success, body.error);
        return Response.json(result);
      }

      if (path === '/state' && request.method === 'GET') {
        const state = await this.getRouterState();
        return Response.json(state);
      }

      if (path === '/process-queue' && request.method === 'POST') {
        await this.processQueues();
        return Response.json({ success: true });
      }

      return Response.json({ error: 'Not Found' }, { status: 404 });
    } catch (error) {
      console.error('Router error:', error);
      return Response.json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        { status: 500 }
      );
    }
  }

  /**
   * Initialize state from durable storage
   */
  private async initialize(): Promise<void> {
    // Load requests
    const storedRequests = await this.state.storage.get<Map<string, QueuedRequest>>('requests');
    if (storedRequests) {
      this.requests = new Map(storedRequests);
    }

    // Load provider queues
    const storedQueues = await this.state.storage.get<Record<string, ProviderQueue>>('providerQueues');
    if (storedQueues) {
      for (const [key, queue] of Object.entries(storedQueues)) {
        // Reconstruct Set from array
        this.providerQueues.set(key, {
          ...queue,
          processing: new Set(Array.from(queue.processing || [])),
        });
      }
    }

    // Initialize default provider queues if not present
    for (const [provider, rateLimit] of Object.entries(DEFAULT_RATE_LIMITS)) {
      if (!this.providerQueues.has(provider)) {
        this.providerQueues.set(provider, {
          provider,
          queue: [],
          processing: new Set(),
          rate_limit: { ...rateLimit },
        });
      }
    }

    // Set up alarm for periodic queue processing
    const alarm = await this.state.storage.getAlarm();
    if (!alarm) {
      // Process queues every 5 seconds
      await this.state.storage.setAlarm(Date.now() + 5000);
    }

    this.initialized = true;
  }

  /**
   * Handle alarm - process queues periodically
   */
  async alarm(): Promise<void> {
    await this.processQueues();

    // Reset rate limit counters every minute
    const now = Date.now();
    for (const queue of this.providerQueues.values()) {
      if (now - queue.rate_limit.last_reset > 60000) {
        queue.rate_limit.current_rpm = 0;
        queue.rate_limit.last_reset = now;
      }
    }

    await this.persistState();

    // Schedule next alarm
    await this.state.storage.setAlarm(Date.now() + 5000);
  }

  /**
   * Submit a new request for processing
   */
  async submitRequest(intake: IntakeRequest): Promise<RouterResponse> {
    // Classify the request if not already classified
    let classification;
    if (intake.task_type && intake.provider && intake.model) {
      classification = classifyWithType(intake.query, intake.task_type);
      classification.provider = intake.provider;
      classification.model = intake.model;
    } else if (intake.task_type) {
      classification = classifyWithType(intake.query, intake.task_type);
    } else {
      classification = classifyQuery(intake.query);
    }

    // Create queued request
    const queuedRequest: QueuedRequest = {
      ...intake,
      task_type: classification.task_type,
      provider: intake.provider || classification.provider,
      model: intake.model || classification.model,
      status: 'queued',
      retry_count: 0,
      max_retries: 3,
      queued_at: new Date().toISOString(),
    };

    // Store request
    this.requests.set(intake.id, queuedRequest);

    // Add to provider queue
    const providerKey = queuedRequest.provider || 'default';
    let providerQueue = this.providerQueues.get(providerKey);

    if (!providerQueue) {
      // Create new queue for unknown provider
      providerQueue = {
        provider: providerKey,
        queue: [],
        processing: new Set(),
        rate_limit: {
          provider: providerKey,
          requests_per_minute: 30,
          concurrent_requests: 5,
          current_rpm: 0,
          current_concurrent: 0,
          last_reset: Date.now(),
        },
      };
      this.providerQueues.set(providerKey, providerQueue);
    }

    // Add to queue based on priority
    if (queuedRequest.priority && queuedRequest.priority > 0) {
      // Higher priority goes first
      const insertIndex = providerQueue.queue.findIndex((id) => {
        const req = this.requests.get(id);
        return !req || (req.priority || 0) < (queuedRequest.priority || 0);
      });
      if (insertIndex === -1) {
        providerQueue.queue.push(intake.id);
      } else {
        providerQueue.queue.splice(insertIndex, 0, intake.id);
      }
    } else {
      providerQueue.queue.push(intake.id);
    }

    // Update queue position
    queuedRequest.queue_position = providerQueue.queue.indexOf(intake.id) + 1;

    // Persist state
    await this.persistState();

    // Calculate estimated wait time
    const estimatedProcessingTime = getEstimatedProcessingTime(
      queuedRequest.task_type!,
      queuedRequest.provider!
    );
    const queuePosition = queuedRequest.queue_position || 1;
    const estimatedWait = estimatedProcessingTime * queuePosition;

    return {
      success: true,
      request_id: intake.id,
      status: 'queued',
      queue_position: queuedRequest.queue_position,
      estimated_wait_ms: estimatedWait,
    };
  }

  /**
   * Get status of a request
   */
  async getRequestStatus(requestId: string): Promise<RouterResponse> {
    const request = this.requests.get(requestId);

    if (!request) {
      return {
        success: false,
        error: 'Request not found',
      };
    }

    // Calculate current queue position if still queued
    let queuePosition: number | undefined;
    if (request.status === 'queued' && request.provider) {
      const queue = this.providerQueues.get(request.provider);
      if (queue) {
        queuePosition = queue.queue.indexOf(requestId) + 1;
        if (queuePosition === 0) queuePosition = undefined;
      }
    }

    return {
      success: true,
      request_id: requestId,
      status: request.status,
      queue_position: queuePosition,
    };
  }

  /**
   * Cancel a pending/queued request
   */
  async cancelRequest(requestId: string): Promise<RouterResponse> {
    const request = this.requests.get(requestId);

    if (!request) {
      return {
        success: false,
        error: 'Request not found',
      };
    }

    if (request.status === 'processing' || request.status === 'completed') {
      return {
        success: false,
        error: `Cannot cancel request in ${request.status} status`,
      };
    }

    // Remove from queue
    if (request.provider) {
      const queue = this.providerQueues.get(request.provider);
      if (queue) {
        const index = queue.queue.indexOf(requestId);
        if (index > -1) {
          queue.queue.splice(index, 1);
        }
      }
    }

    // Update status
    request.status = 'cancelled';
    request.completed_at = new Date().toISOString();

    await this.persistState();

    return {
      success: true,
      request_id: requestId,
      status: 'cancelled',
    };
  }

  /**
   * Mark a request as complete (called by Delivery Worker)
   */
  async completeRequest(
    requestId: string,
    success: boolean,
    error?: string
  ): Promise<RouterResponse> {
    const request = this.requests.get(requestId);

    if (!request) {
      return {
        success: false,
        error: 'Request not found',
      };
    }

    // Remove from processing set
    if (request.provider) {
      const queue = this.providerQueues.get(request.provider);
      if (queue) {
        queue.processing.delete(requestId);
        queue.rate_limit.current_concurrent = queue.processing.size;
      }
    }

    // Update status
    if (success) {
      request.status = 'completed';
    } else {
      // Check if we should retry
      if (request.retry_count < request.max_retries) {
        request.retry_count++;
        request.status = 'queued';
        request.error_message = error;

        // Re-add to queue (at front for retry)
        if (request.provider) {
          const queue = this.providerQueues.get(request.provider);
          if (queue) {
            queue.queue.unshift(requestId);
          }
        }
      } else {
        request.status = 'failed';
        request.error_message = error;
      }
    }

    request.completed_at = new Date().toISOString();
    await this.persistState();

    return {
      success: true,
      request_id: requestId,
      status: request.status,
    };
  }

  /**
   * Process queues and dispatch ready requests
   */
  async processQueues(): Promise<void> {
    const notifications: ProcessingNotification[] = [];

    for (const [_providerKey, queue] of this.providerQueues) {
      // Reset rate limits if minute has passed
      const now = Date.now();
      if (now - queue.rate_limit.last_reset > 60000) {
        queue.rate_limit.current_rpm = 0;
        queue.rate_limit.last_reset = now;
      }

      // Check if we can process more requests
      while (
        queue.queue.length > 0 &&
        queue.rate_limit.current_rpm < queue.rate_limit.requests_per_minute &&
        queue.processing.size < queue.rate_limit.concurrent_requests
      ) {
        const requestId = queue.queue.shift();
        if (!requestId) break;

        const request = this.requests.get(requestId);
        if (!request) continue;

        // Skip if not in queued status
        if (request.status !== 'queued') continue;

        // Move to processing
        request.status = 'processing';
        request.started_at = new Date().toISOString();
        queue.processing.add(requestId);
        queue.rate_limit.current_rpm++;
        queue.rate_limit.current_concurrent = queue.processing.size;

        // Create notification for processing worker
        notifications.push({
          request_id: request.id,
          app_id: request.app_id,
          query: request.query,
          task_type: request.task_type!,
          provider: request.provider!,
          model: request.model!,
          metadata: request.metadata,
          callback_url: request.callback_url,
        });
      }

      // Update queue positions for remaining items
      queue.queue.forEach((id, index) => {
        const req = this.requests.get(id);
        if (req) {
          req.queue_position = index + 1;
        }
      });
    }

    // Persist state after processing
    await this.persistState();

    // Note: In production, notifications would be sent to processing workers
    // For now, we store them for retrieval via a /pending endpoint
    if (notifications.length > 0) {
      await this.state.storage.put('pendingNotifications', notifications);
    }
  }

  /**
   * Get pending notifications for processing workers
   */
  async getPendingNotifications(): Promise<ProcessingNotification[]> {
    const notifications = await this.state.storage.get<ProcessingNotification[]>('pendingNotifications');
    // Clear after retrieval
    await this.state.storage.delete('pendingNotifications');
    return notifications || [];
  }

  /**
   * Get current router state for monitoring
   */
  async getRouterState(): Promise<RouterState> {
    let pending = 0;
    let queued = 0;
    let processing = 0;
    let completed = 0;
    let failed = 0;

    for (const request of this.requests.values()) {
      switch (request.status) {
        case 'pending':
          pending++;
          break;
        case 'queued':
          queued++;
          break;
        case 'processing':
          processing++;
          break;
        case 'completed':
          completed++;
          break;
        case 'failed':
          failed++;
          break;
      }
    }

    const providerQueuesState: RouterState['provider_queues'] = {};
    for (const [key, queue] of this.providerQueues) {
      providerQueuesState[key] = {
        queue_length: queue.queue.length,
        processing: queue.processing.size,
        rate_limit: queue.rate_limit,
      };
    }

    return {
      total_requests: this.requests.size,
      pending_requests: pending,
      queued_requests: queued,
      processing_requests: processing,
      completed_requests: completed,
      failed_requests: failed,
      provider_queues: providerQueuesState,
    };
  }

  /**
   * Persist state to durable storage
   */
  private async persistState(): Promise<void> {
    // Convert Maps to serializable format
    await this.state.storage.put('requests', this.requests);

    // Convert Sets to arrays for storage
    const queuesForStorage: Record<string, any> = {};
    for (const [key, queue] of this.providerQueues) {
      queuesForStorage[key] = {
        ...queue,
        processing: Array.from(queue.processing),
      };
    }
    await this.state.storage.put('providerQueues', queuesForStorage);
  }
}

// Export as module worker (for standalone deployment if needed)
export default {
  async fetch(_request: Request, _env: unknown): Promise<Response> {
    return new Response('Request Router DO - Use Durable Object bindings', { status: 200 });
  },
};
