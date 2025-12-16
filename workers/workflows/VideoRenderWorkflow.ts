/**
 * VideoRenderWorkflow
 *
 * Cloudflare Workflow for durable video rendering via Shotstack.
 * Handles long-running (60+ second) renders with:
 * - Automatic retries with exponential backoff
 * - Crash recovery (resume from last checkpoint)
 * - Dual completion reporting (D1 + Delivery Worker)
 *
 * Steps:
 * 1. submit-to-shotstack: POST render job, get render_id
 * 2. poll-shotstack-completion: Poll until done/failed (up to 10 min)
 * 3. update-d1-status: Mark request completed in database
 * 4. notify-delivery: Send result to Delivery Worker
 * 5. send-callback: Notify client if callback_url configured
 */

import { WorkflowEntrypoint, WorkflowStep, type WorkflowEvent } from 'cloudflare:workers';
import type {
  Env,
  VideoRenderParams,
  Timeline,
  ShotstackSubmitResult,
  ShotstackStatusResult,
  RenderResult,
  DeliveryPayload,
  CallbackPayload,
} from './types';

export class VideoRenderWorkflow extends WorkflowEntrypoint<Env, VideoRenderParams> {
  /**
   * Main workflow execution
   */
  override async run(event: WorkflowEvent<VideoRenderParams>, step: WorkflowStep) {
    const { request_id, app_id, instance_id, timeline, output, callback_url } = event.payload;

    console.log(`[VideoRenderWorkflow] Starting for request ${request_id}`);

    // Step 1: Submit render job to Shotstack
    const renderId = await step.do(
      'submit-to-shotstack',
      {
        retries: {
          limit: 3,
          delay: '5 seconds',
          backoff: 'exponential',
        },
        timeout: '30 seconds',
      },
      async () => {
        return await this.submitToShotstack(timeline, output);
      }
    );

    console.log(`[VideoRenderWorkflow] Submitted to Shotstack, render_id: ${renderId}`);

    // Step 2: Poll for completion (up to 10 minutes)
    const result = await step.do(
      'poll-shotstack-completion',
      {
        retries: {
          limit: 120, // Poll up to 120 times
          delay: '5 seconds',
          backoff: 'linear', // Linear backoff for polling
        },
        timeout: '10 minutes',
      },
      async () => {
        return await this.pollShotstackCompletion(renderId);
      }
    );

    console.log(`[VideoRenderWorkflow] Render complete: ${result.video_url}`);

    // Step 3: Update D1 database with completion status
    const deliverableId = await step.do(
      'update-d1-status',
      {
        retries: {
          limit: 3,
          delay: '2 seconds',
          backoff: 'exponential',
        },
        timeout: '30 seconds',
      },
      async () => {
        return await this.updateD1Status(request_id, result);
      }
    );

    console.log(`[VideoRenderWorkflow] D1 updated, deliverable_id: ${deliverableId}`);

    // Step 4: Notify Delivery Worker (best effort - don't fail workflow if this fails)
    await step.do(
      'notify-delivery',
      {
        retries: {
          limit: 3,
          delay: '2 seconds',
          backoff: 'exponential',
        },
        timeout: '30 seconds',
      },
      async () => {
        try {
          await this.notifyDelivery(request_id, result);
        } catch (error) {
          // Log but don't throw - D1 is source of truth
          console.warn(`[VideoRenderWorkflow] Delivery notification failed: ${error}`);
        }
      }
    );

    // Step 5: Send client callback if configured (best effort)
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
            await this.sendCallback(callback_url, request_id, result);
          } catch (error) {
            // Log but don't throw - callback is best effort
            console.warn(`[VideoRenderWorkflow] Callback failed: ${error}`);
          }
        }
      );
    }

    console.log(`[VideoRenderWorkflow] Completed successfully for request ${request_id}`);

    return {
      success: true,
      request_id,
      render_id: renderId,
      video_url: result.video_url,
      deliverable_id: deliverableId,
    };
  }

  /**
   * Submit render job to Shotstack API
   */
  private async submitToShotstack(
    timeline: Timeline,
    output?: VideoRenderParams['output']
  ): Promise<string> {
    const shotstackEnv = this.env.SHOTSTACK_ENV || 'stage';
    const baseUrl = shotstackEnv === 'stage'
      ? 'https://api.shotstack.io/stage'
      : 'https://api.shotstack.io/v1';

    const shotstackTimeline = this.convertToShotstackFormat(timeline);

    const response = await fetch(`${baseUrl}/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.env.SHOTSTACK_API_KEY,
      },
      body: JSON.stringify({
        timeline: shotstackTimeline,
        output: {
          format: output?.format || 'mp4',
          resolution: output?.resolution || 'hd',
          fps: output?.fps || 25,
          quality: output?.quality || 'high',
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Shotstack API error (${response.status}): ${error}`);
    }

    const data = await response.json() as { response: { id: string } };
    return data.response.id;
  }

  /**
   * Poll Shotstack for render completion
   * Throws if not complete yet (triggers retry)
   */
  private async pollShotstackCompletion(renderId: string): Promise<RenderResult> {
    const shotstackEnv = this.env.SHOTSTACK_ENV || 'stage';
    const baseUrl = shotstackEnv === 'stage'
      ? 'https://api.shotstack.io/stage'
      : 'https://api.shotstack.io/v1';

    const response = await fetch(`${baseUrl}/render/${renderId}`, {
      headers: { 'x-api-key': this.env.SHOTSTACK_API_KEY },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Shotstack status error (${response.status}): ${error}`);
    }

    const data = await response.json() as { response: ShotstackStatusResult };
    const render = data.response;

    if (render.status === 'failed') {
      throw new Error(`Render failed: ${render.error || 'Unknown error'}`);
    }

    if (render.status !== 'done') {
      // Not complete yet - throw to trigger retry
      throw new Error(`Render not complete: ${render.status} (${render.progress || 0}%)`);
    }

    if (!render.url) {
      throw new Error('Render completed but no URL returned');
    }

    return {
      video_url: render.url,
      status: 'done',
    };
  }

  /**
   * Update D1 database with completion status
   */
  private async updateD1Status(requestId: string, result: RenderResult): Promise<string> {
    const now = new Date().toISOString();

    // Update request status
    await this.env.DB.prepare(`
      UPDATE requests SET
        status = 'completed',
        completed_at = ?
      WHERE id = ?
    `).bind(now, requestId).run();

    // Create deliverable record
    const deliverableId = crypto.randomUUID();
    await this.env.DB.prepare(`
      INSERT INTO deliverables (
        id, request_id, content_type, content, status, created_at, updated_at
      ) VALUES (?, ?, 'video_url', ?, 'approved', ?, ?)
    `).bind(deliverableId, requestId, result.video_url, now, now).run();

    return deliverableId;
  }

  /**
   * Notify Delivery Worker of completion
   */
  private async notifyDelivery(requestId: string, result: RenderResult): Promise<void> {
    const payload: DeliveryPayload = {
      request_id: requestId,
      success: true,
      content_type: 'video_url',
      content: result.video_url,
      provider: 'shotstack',
      raw_response: result,
    };

    const response = await fetch(`${this.env.DELIVERY_URL}/deliver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Delivery notification failed (${response.status}): ${error}`);
    }
  }

  /**
   * Send callback to client application
   */
  private async sendCallback(
    callbackUrl: string,
    requestId: string,
    result: RenderResult
  ): Promise<void> {
    const payload: CallbackPayload = {
      request_id: requestId,
      status: 'completed',
      content_type: 'video_url',
      content: result.video_url,
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

  /**
   * Convert internal timeline format to Shotstack format
   */
  private convertToShotstackFormat(timeline: Timeline): object {
    return {
      soundtrack: timeline.soundtrack,
      tracks: timeline.tracks.map(track => ({
        clips: track.clips.map(clip => ({
          asset: clip.asset,
          start: clip.start,
          length: clip.length,
          fit: clip.fit || 'crop',
          scale: clip.scale,
          position: clip.position || 'center',
          offset: clip.offset,
          transition: clip.transition,
          effect: clip.effect,
          filter: clip.filter,
          opacity: clip.opacity,
        })),
      })),
    };
  }
}
