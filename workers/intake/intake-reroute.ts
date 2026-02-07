/**
 * Intake → PrimeWorkflow Reroute Handler
 *
 * Traffic cop: intercepts requests to the legacy intake endpoint,
 * transforms them to PrimeWorkflow format, fires them through /execute,
 * and returns a deprecation notice so apps know to update.
 *
 * The RequestRouter Durable Object is bypassed entirely.
 *
 * Drop-in replacement for the intake worker's POST /intake handler.
 * Preserves the same 202 response contract so existing apps don't break.
 *
 * Callback support: if the original request includes a callback_url,
 * we poll the workflow status and POST the result back when complete.
 */

import type { Env } from './types';

// ─── Types ──────────────────────────────────────────────────────────

interface IntakeRequestBody {
  query: string;
  app_id?: string;
  task_type?: string;
  provider?: string;
  model?: string;
  callback_url?: string;
  metadata?: Record<string, unknown>;
  priority?: number;
  system_prompt?: string;
  // Some apps send these
  request_id?: string;
  instance_id?: string;
}

interface PrimeWorkflowParams {
  task_id: string;
  title: string;
  description: string;
  context: {
    system_prompt?: string;
    metadata?: Record<string, unknown>;
    original_app_id?: string;
    original_intake_path: string;
  };
  hints: {
    workflow?: string;
    provider?: string;
    model?: string;
  };
  callback_url?: string;
  timeout_ms: number;
}

interface ExecuteResponse {
  success: boolean;
  execution_id?: string;
  error?: string;
}

interface StatusResponse {
  status: 'queued' | 'running' | 'complete' | 'errored';
  output?: {
    success: boolean;
    output?: string;
    error?: string;
    [key: string]: unknown;
  };
}

// ─── Intake → PrimeWorkflow Mapping ─────────────────────────────────

function inferTaskType(body: IntakeRequestBody): string {
  // If the app explicitly says what it wants, respect that
  if (body.task_type) {
    const typeMap: Record<string, string> = {
      'text': 'text-generation',
      'text-generation': 'text-generation',
      'code': 'code-execution',
      'code-execution': 'code-execution',
      'image': 'image-generation',
      'image-generation': 'image-generation',
      'audio': 'audio-generation',
      'audio-generation': 'audio-generation',
    };
    return typeMap[body.task_type] || 'text-generation';
  }
  // Default: most intake requests are text generation
  return 'text-generation';
}

function inferTitlePrefix(workflow: string): string {
  const prefixMap: Record<string, string> = {
    'text-generation': '[research]',
    'code-execution': '[implement]',
    'image-generation': '[image]',
    'audio-generation': '[audio]',
  };
  return prefixMap[workflow] || '[research]';
}

function mapIntakeToPrimeWorkflow(body: IntakeRequestBody, requestId: string): PrimeWorkflowParams {
  const workflow = inferTaskType(body);
  const prefix = inferTitlePrefix(workflow);

  // Build a meaningful title from the query (truncated)
  const titleBody = body.query.length > 80
    ? body.query.substring(0, 77) + '...'
    : body.query;

  return {
    task_id: requestId,
    title: `${prefix} ${titleBody}`,
    description: body.query,
    context: {
      system_prompt: body.system_prompt,
      metadata: body.metadata,
      original_app_id: body.app_id,
      original_intake_path: '/intake',
    },
    hints: {
      workflow,
      provider: body.provider || undefined,
      model: body.model || undefined,
    },
    callback_url: body.callback_url,
    timeout_ms: 600_000, // 10 min default
  };
}

// ─── Reroute Handler ────────────────────────────────────────────────

export async function handleIntakeReroute(
  request: Request,
  env: Env
): Promise<Response> {
  const requestId = crypto.randomUUID();

  // ── Parse body ──
  let body: IntakeRequestBody;
  try {
    body = await request.json() as IntakeRequestBody;
  } catch {
    return Response.json({
      success: false,
      error: 'Invalid JSON body',
      code: 'INVALID_JSON',
    }, { status: 400 });
  }

  if (!body.query || typeof body.query !== 'string' || !body.query.trim()) {
    return Response.json({
      success: false,
      error: 'Missing required field: query',
      code: 'MISSING_FIELD',
    }, { status: 400 });
  }

  // ── Log deprecation ──
  const sourceIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  const userAgent = request.headers.get('User-Agent') || 'unknown';
  const appId = body.app_id || 'unknown';
  console.warn(
    `[DEPRECATION] Intake reroute: app_id=${appId} ip=${sourceIp} ua=${userAgent} ` +
    `task_type=${body.task_type || 'auto'} has_callback=${!!body.callback_url}`
  );

  // ── Map to PrimeWorkflow format ──
  const params = mapIntakeToPrimeWorkflow(body, requestId);

  // ── Forward to /execute ──
  let executeResult: ExecuteResponse;
  try {
    const executeResponse = await fetch(`${env.DE_WORKFLOWS_URL}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Passphrase': env.PASSPHRASE,
        'X-Forwarded-For': sourceIp,
        'X-Original-App-ID': appId,
        'X-Rerouted-From': 'intake',
      },
      body: JSON.stringify({ params }),
    });

    executeResult = await executeResponse.json() as ExecuteResponse;

    if (!executeResult.success) {
      // Track failure in D1
      await trackRequest(env.DB, requestId, body, 'failed', executeResult.error);

      return Response.json({
        success: false,
        request_id: requestId,
        error: executeResult.error || 'PrimeWorkflow submission failed',
        code: 'REROUTE_EXECUTE_FAILED',
        _deprecation: buildDeprecationNotice(requestId),
      }, { status: 502 });
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    await trackRequest(env.DB, requestId, body, 'failed', errorMsg);

    return Response.json({
      success: false,
      request_id: requestId,
      error: `Failed to reach PrimeWorkflow: ${errorMsg}`,
      code: 'REROUTE_NETWORK_ERROR',
      _deprecation: buildDeprecationNotice(requestId),
    }, { status: 502 });
  }

  const executionId = executeResult.execution_id || requestId;

  // ── Track in D1 ──
  await trackRequest(env.DB, requestId, body, 'queued', null, executionId);

  // ── If callback_url provided, schedule async callback delivery ──
  if (body.callback_url) {
    // Use waitUntil to poll and deliver callback in background
    const ctx = (request as any).ctx as ExecutionContext | undefined;
    if (ctx?.waitUntil) {
      ctx.waitUntil(
        pollAndCallback(
          executionId,
          body.callback_url,
          requestId,
          appId,
          env
        )
      );
    }
  }

  // ── Return 202 Accepted (same contract as old intake) ──
  return Response.json({
    success: true,
    request_id: requestId,
    execution_id: executionId,
    status: 'queued',
    queue_position: 0,
    estimated_wait_ms: 30_000,

    // The traffic cop badge — apps should read this and fix themselves
    redirected: true,
    _deprecation: buildDeprecationNotice(requestId),
  }, {
    status: 202,
    headers: {
      'X-Request-ID': requestId,
      'X-Execution-ID': executionId,
      'X-Rerouted': 'true',
      'X-Deprecation': 'intake endpoint is deprecated, use POST /execute directly',
    },
  });
}

// ─── Callback Delivery (Poll + POST) ────────────────────────────────

async function pollAndCallback(
  executionId: string,
  callbackUrl: string,
  requestId: string,
  appId: string,
  env: Env,
  maxAttempts = 60,       // 5 minutes at 5s intervals
  pollIntervalMs = 5_000
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(pollIntervalMs);

    try {
      const statusRes = await fetch(
        `${env.DE_WORKFLOWS_URL}/status/${executionId}`,
        {
          headers: {
            'X-Passphrase': env.PASSPHRASE,
          },
        }
      );

      if (!statusRes.ok) continue;

      const status = await statusRes.json() as StatusResponse;

      if (status.status === 'complete' || status.status === 'errored') {
        // ── Fire the callback ──
        const callbackPayload = {
          request_id: requestId,
          execution_id: executionId,
          status: status.status === 'complete' ? 'completed' : 'failed',
          result: status.output?.output || status.output?.error || null,
          error: status.status === 'errored' ? (status.output?.error || 'Unknown error') : null,

          // Nudge the app to migrate
          _deprecation: {
            message: 'This callback was delivered via intake reroute. Migrate to POST /execute + GET /status/:id for direct access.',
            migrate_to: 'POST /execute → GET /status/:id',
          },
        };

        const callbackRes = await fetch(callbackUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-DE-Request-ID': requestId,
            'X-DE-Execution-ID': executionId,
            'X-DE-Source': 'intake-reroute-callback',
          },
          body: JSON.stringify(callbackPayload),
        });

        // Update tracking
        await env.DB.prepare(`
          UPDATE intake_reroute_tracking
          SET status = ?, callback_delivered = ?, callback_status = ?, completed_at = ?
          WHERE request_id = ?
        `).bind(
          status.status,
          true,
          callbackRes.status,
          new Date().toISOString(),
          requestId
        ).run();

        console.log(
          `[INTAKE-REROUTE] Callback delivered: request_id=${requestId} ` +
          `app_id=${appId} callback_status=${callbackRes.status} ` +
          `de_status=${status.status}`
        );

        return;
      }
      // Still running, keep polling
    } catch (err) {
      console.error(
        `[INTAKE-REROUTE] Poll error attempt ${attempt}: ${err}`
      );
    }
  }

  // Timed out — notify via callback that we gave up
  try {
    await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-DE-Request-ID': requestId,
        'X-DE-Source': 'intake-reroute-callback',
      },
      body: JSON.stringify({
        request_id: requestId,
        execution_id: executionId,
        status: 'timeout',
        error: 'DE reroute: polling timed out after 5 minutes. Check /status/:id manually.',
        _deprecation: {
          message: 'Migrate to POST /execute + GET /status/:id',
        },
      }),
    });
  } catch {
    // Best effort
  }
}

// ─── D1 Tracking ────────────────────────────────────────────────────

async function trackRequest(
  db: D1Database,
  requestId: string,
  body: IntakeRequestBody,
  status: string,
  error: string | null | undefined,
  executionId?: string
): Promise<void> {
  try {
    await db.prepare(`
      INSERT INTO intake_reroute_tracking
        (request_id, execution_id, app_id, task_type, callback_url, status, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      requestId,
      executionId || null,
      body.app_id || 'unknown',
      body.task_type || 'auto',
      body.callback_url || null,
      status,
      error || null,
      new Date().toISOString()
    ).run();
  } catch (err) {
    // Don't fail the request if tracking fails
    console.error(`[INTAKE-REROUTE] D1 tracking error: ${err}`);
  }
}

// ─── Deprecation Notice Builder ─────────────────────────────────────

function buildDeprecationNotice(requestId: string) {
  return {
    warning: 'The /intake endpoint is deprecated and will be removed. Your request was rerouted through PrimeWorkflow.',
    migrate_to: {
      endpoint: 'POST /execute',
      docs: 'https://de-workflows.solamp.workers.dev/docs',
      status_polling: 'GET /status/:execution_id',
      example: {
        method: 'POST',
        url: 'https://de-workflows.solamp.workers.dev/execute',
        headers: {
          'Content-Type': 'application/json',
          'X-Passphrase': '<your-passphrase>',
        },
        body: {
          params: {
            task_id: 'your-unique-id',
            title: '[research] Your task description',
            description: 'Full prompt / query text here',
            context: {},
            hints: {
              workflow: 'text-generation',
              provider: 'openai',
              model: 'gpt-4o-mini',
            },
            timeout_ms: 600000,
          },
        },
      },
    },
    request_id: requestId,
    rerouted_at: new Date().toISOString(),
  };
}

// ─── Utility ────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
