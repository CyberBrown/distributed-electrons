/**
 * PrimeWorkflow
 *
 * The unified entry point for ALL requests into Distributed Electrons.
 * This Cloudflare Workflow serves as the orchestration layer that:
 * - Receives tasks from external systems (Nexus, apps, etc.)
 * - Classifies task type (code, text, video)
 * - Routes to appropriate sub-workflows
 * - Monitors completion and handles failures
 * - Provides centralized logging and callbacks
 *
 * Key principle: Apps suggest, DE decides.
 * - Hints (workflow, provider, model) are suggestions only
 * - PrimeWorkflow makes final routing decisions
 * - Sub-workflows handle actual provider/model selection
 *
 * Steps:
 * 1. validate-request: Validate required fields
 * 2. classify-task: Determine task type from context/content
 * 3. execute-subworkflow: Trigger and monitor sub-workflow
 * 4. send-callback: Notify caller of result (if callback_url provided)
 * 5. log-completion: Log final status for monitoring
 */

import { WorkflowEntrypoint, WorkflowStep, type WorkflowEvent } from 'cloudflare:workers';
import type {
  PrimeWorkflowParams,
  PrimeWorkflowResult,
  TaskType,
  PrimeEnv,
} from './types';

// Default DE Workflows URL (self-reference for HTTP-based sub-workflow triggering)
const DEFAULT_DE_WORKFLOWS_URL = 'https://de-workflows.solamp.workers.dev';

interface ValidationResult {
  valid: boolean;
  error?: string;
}

interface SubWorkflowResult {
  success: boolean;
  workflow_id?: string;
  output?: string;
  text?: string;
  executor?: string;
  provider?: string;
  error?: string;
  duration_ms?: number;
}

export class PrimeWorkflow extends WorkflowEntrypoint<PrimeEnv, PrimeWorkflowParams> {
  /**
   * Main workflow execution
   */
  override async run(event: WorkflowEvent<PrimeWorkflowParams>, step: WorkflowStep) {
    const {
      task_id,
      title,
      description,
      context,
      hints,
      callback_url,
      timeout_ms = 300000, // 5 minutes default
    } = event.payload;

    const startTime = Date.now();

    console.log(`[PrimeWorkflow] Starting for task ${task_id}`);
    console.log(`[PrimeWorkflow] Title: ${title}`);
    console.log(`[PrimeWorkflow] Hints: ${JSON.stringify(hints)}`);

    // Step 1: Validate request
    const validation = await step.do(
      'validate-request',
      {
        retries: { limit: 1, delay: '1 second', backoff: 'constant' },
        timeout: '10 seconds',
      },
      async () => {
        return this.validateRequest(event.payload);
      }
    );

    if (!validation.valid) {
      console.error(`[PrimeWorkflow] Validation failed: ${validation.error}`);
      return this.createErrorResult(task_id, 'unknown', validation.error, startTime);
    }

    // Step 2: Classify task type (apps suggest, we decide)
    const taskType = await step.do(
      'classify-task',
      {
        retries: { limit: 1, delay: '1 second', backoff: 'constant' },
        timeout: '5 seconds',
      },
      async () => {
        return this.classifyTask(title, description, context, hints);
      }
    );

    console.log(`[PrimeWorkflow] Classified as: ${taskType}`);

    // Step 3: Route to appropriate sub-workflow and wait for completion
    let subResult: SubWorkflowResult;
    try {
      subResult = await step.do(
        'execute-subworkflow',
        {
          retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' },
          timeout: `${Math.ceil(timeout_ms / 1000)} seconds`,
        },
        async () => {
          return this.routeToSubWorkflow(taskType, event.payload);
        }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[PrimeWorkflow] Sub-workflow execution failed: ${errorMessage}`);
      subResult = {
        success: false,
        error: errorMessage,
      };
    }

    // Build result
    const result: PrimeWorkflowResult = {
      success: subResult.success,
      task_id,
      task_type: taskType,
      sub_workflow_id: subResult.workflow_id,
      runner_used: subResult.executor || subResult.provider,
      output: subResult.output || subResult.text,
      error: subResult.error,
      duration_ms: Date.now() - startTime,
    };

    // Step 4: Send callback if configured
    if (callback_url) {
      await step.do(
        'send-callback',
        {
          retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' },
          timeout: '30 seconds',
        },
        async () => {
          await this.sendCallback(callback_url, result);
          return { sent: true };
        }
      );
    }

    // Step 5: Log completion
    await step.do(
      'log-completion',
      {
        retries: { limit: 2, delay: '1 second', backoff: 'constant' },
        timeout: '10 seconds',
      },
      async () => {
        console.log(`[PrimeWorkflow] Completed task ${task_id}`);
        console.log(`[PrimeWorkflow] Result: ${JSON.stringify(result)}`);
        return { logged: true };
      }
    );

    return result;
  }

  /**
   * Validate request parameters
   */
  private validateRequest(params: PrimeWorkflowParams): ValidationResult {
    if (!params.task_id) {
      return { valid: false, error: 'Missing task_id' };
    }

    if (!params.title || params.title.trim() === '') {
      return { valid: false, error: 'Missing or empty title' };
    }

    if (!params.description && !params.title) {
      return { valid: false, error: 'Missing description and title' };
    }

    return { valid: true };
  }

  /**
   * Classify task type based on context and content
   * Apps suggest via hints, but we make the final decision
   */
  private classifyTask(
    title: string,
    description: string,
    context?: PrimeWorkflowParams['context'],
    hints?: PrimeWorkflowParams['hints']
  ): TaskType {
    // 1. Strong context signals (override hints)
    if (context?.repo) {
      console.log('[PrimeWorkflow] Classification: code (context.repo present)');
      return 'code';
    }
    if (context?.timeline) {
      console.log('[PrimeWorkflow] Classification: video (context.timeline present)');
      return 'video';
    }

    // 2. Title tag parsing (explicit markers)
    const titleLower = title.toLowerCase();
    const codeIndicators = [
      '[implement]',
      '[bugfix]',
      '[cc]',
      '[code]',
      '[fix]',
      '[refactor]',
      '[debug]',
    ];
    const textIndicators = [
      '[research]',
      '[analyze]',
      '[write]',
      '[summarize]',
      '[explain]',
    ];
    const videoIndicators = ['[video]', '[render]', '[animate]'];
    const imageIndicators = ['[image]', '[generate-image]', '[picture]', '[illustration]'];
    const audioIndicators = ['[audio]', '[speech]', '[tts]', '[voice]', '[synthesize]'];

    if (codeIndicators.some((ind) => titleLower.includes(ind))) {
      console.log('[PrimeWorkflow] Classification: code (title tag)');
      return 'code';
    }
    if (textIndicators.some((ind) => titleLower.includes(ind))) {
      console.log('[PrimeWorkflow] Classification: text (title tag)');
      return 'text';
    }
    if (videoIndicators.some((ind) => titleLower.includes(ind))) {
      console.log('[PrimeWorkflow] Classification: video (title tag)');
      return 'video';
    }
    if (imageIndicators.some((ind) => titleLower.includes(ind))) {
      console.log('[PrimeWorkflow] Classification: image (title tag)');
      return 'image';
    }
    if (audioIndicators.some((ind) => titleLower.includes(ind))) {
      console.log('[PrimeWorkflow] Classification: audio (title tag)');
      return 'audio';
    }

    // 3. Content keyword analysis
    const fullText = `${title} ${description}`.toLowerCase();
    const codeKeywords = [
      'implement',
      'fix bug',
      'debug',
      'refactor',
      'commit',
      'pr ',
      'pull request',
      'create file',
      'update code',
      'write function',
      'add feature',
      'modify',
      'change the code',
      'build',
      'deploy',
    ];

    if (codeKeywords.some((kw) => fullText.includes(kw))) {
      console.log('[PrimeWorkflow] Classification: code (content keywords)');
      return 'code';
    }

    // 4. Consider hints (as tiebreaker only)
    if (hints?.workflow === 'code-execution') {
      console.log('[PrimeWorkflow] Classification: code (hint)');
      return 'code';
    }
    if (hints?.workflow === 'text-generation') {
      console.log('[PrimeWorkflow] Classification: text (hint)');
      return 'text';
    }
    if (hints?.workflow === 'video-render') {
      console.log('[PrimeWorkflow] Classification: video (hint)');
      return 'video';
    }
    if (hints?.workflow === 'image-generation') {
      console.log('[PrimeWorkflow] Classification: image (hint)');
      return 'image';
    }
    if (hints?.workflow === 'audio-generation') {
      console.log('[PrimeWorkflow] Classification: audio (hint)');
      return 'audio';
    }

    // 5. Default to text (safer, cheaper, faster)
    console.log('[PrimeWorkflow] Classification: text (default)');
    return 'text';
  }

  /**
   * Route to the appropriate sub-workflow and wait for completion
   */
  private async routeToSubWorkflow(
    taskType: TaskType,
    params: PrimeWorkflowParams
  ): Promise<SubWorkflowResult> {
    const workflowUrl =
      this.env.DE_WORKFLOWS_URL || DEFAULT_DE_WORKFLOWS_URL;
    const startTime = Date.now();

    let endpoint: string;
    let subParams: Record<string, unknown>;

    switch (taskType) {
      case 'code':
        endpoint = '/workflows/code-execution';
        subParams = {
          params: {
            task_id: params.task_id,
            prompt: `${params.title}\n\n${params.description}`,
            repo_url: params.context?.repo,
            preferred_executor:
              params.hints?.provider === 'gemini' ? 'gemini' : 'claude',
            timeout_ms: params.timeout_ms,
          },
        };
        break;

      case 'text':
        endpoint = '/workflows/text-generation';
        subParams = {
          params: {
            request_id: params.task_id,
            prompt: `${params.title}\n\n${params.description}`,
            system_prompt: params.context?.system_prompt,
            max_tokens: 4096,
            temperature: 0.7,
          },
        };
        break;

      case 'video':
        endpoint = '/workflows/video-render';
        subParams = {
          params: {
            request_id: params.task_id,
            timeline: params.context?.timeline,
            output: params.context?.output,
          },
        };
        break;

      case 'image':
        endpoint = '/workflows/image-generation';
        subParams = {
          params: {
            request_id: params.task_id,
            prompt: `${params.title}\n\n${params.description}`,
            model_id: params.hints?.model,
            callback_url: params.callback_url,
          },
        };
        break;

      case 'audio':
        endpoint = '/workflows/audio-generation';
        subParams = {
          params: {
            request_id: params.task_id,
            text: params.description || params.title,
            voice_id: params.hints?.model, // Can use hints.model for voice selection
            callback_url: params.callback_url,
          },
        };
        break;

      default:
        throw new Error(`Unknown task type: ${taskType}`);
    }

    console.log(`[PrimeWorkflow] Triggering sub-workflow at ${endpoint}`);

    // Trigger sub-workflow via HTTP
    const response = await fetch(`${workflowUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Passphrase': this.env.NEXUS_PASSPHRASE || '',
      },
      body: JSON.stringify(subParams),
    });

    const triggerResult = (await response.json()) as {
      success: boolean;
      workflow_id?: string;
      error?: string;
    };

    if (!triggerResult.success) {
      throw new Error(triggerResult.error || 'Sub-workflow failed to start');
    }

    const subWorkflowId = triggerResult.workflow_id;
    console.log(`[PrimeWorkflow] Sub-workflow started: ${subWorkflowId}`);

    // Poll for completion
    const completionResult = await this.pollForCompletion(
      workflowUrl,
      endpoint,
      subWorkflowId!
    );

    return {
      success: completionResult.success,
      workflow_id: subWorkflowId,
      output: completionResult.output,
      text: completionResult.text,
      executor: completionResult.executor,
      provider: completionResult.provider,
      error: completionResult.error,
      duration_ms: Date.now() - startTime,
    };
  }

  /**
   * Poll sub-workflow for completion
   */
  private async pollForCompletion(
    baseUrl: string,
    endpoint: string,
    workflowId: string
  ): Promise<SubWorkflowResult> {
    const maxAttempts = 60; // 5 minutes at 5-second intervals
    const pollInterval = 5000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await this.sleep(pollInterval);

      try {
        const response = await fetch(`${baseUrl}${endpoint}/${workflowId}`);
        const status = (await response.json()) as {
          success?: boolean;
          status?: string;
          output?: {
            success?: boolean;
            output?: string;
            text?: string;
            executor?: string;
            provider?: string;
            error?: string;
          };
          error?: string;
        };

        console.log(
          `[PrimeWorkflow] Poll attempt ${attempt + 1}: status=${status.status}`
        );

        if (status.status === 'complete') {
          return {
            success: status.output?.success ?? true,
            output: status.output?.output,
            text: status.output?.text,
            executor: status.output?.executor,
            provider: status.output?.provider,
            error: status.output?.error,
          };
        }

        if (status.status === 'errored') {
          return {
            success: false,
            error: status.error || status.output?.error || 'Sub-workflow errored',
          };
        }

        // Still running, continue polling
      } catch (error) {
        console.error(
          `[PrimeWorkflow] Poll error (attempt ${attempt + 1}):`,
          error
        );
        // Continue polling despite errors
      }
    }

    throw new Error('Sub-workflow timed out waiting for completion');
  }

  /**
   * Send callback to caller with result
   */
  private async sendCallback(
    callbackUrl: string,
    result: PrimeWorkflowResult
  ): Promise<void> {
    console.log(`[PrimeWorkflow] Sending callback to ${callbackUrl}`);

    const response = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Passphrase': this.env.NEXUS_PASSPHRASE || '',
      },
      body: JSON.stringify({
        task_id: result.task_id,
        status: result.success ? 'completed' : 'failed',
        task_type: result.task_type,
        runner_used: result.runner_used,
        output: result.output,
        error: result.error,
        duration_ms: result.duration_ms,
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[PrimeWorkflow] Callback failed (${response.status}): ${errorText}`
      );
      throw new Error(`Callback failed: ${response.status}`);
    }

    console.log('[PrimeWorkflow] Callback sent successfully');
  }

  /**
   * Create error result
   */
  private createErrorResult(
    task_id: string,
    task_type: TaskType | 'unknown',
    error: string | undefined,
    startTime: number
  ): PrimeWorkflowResult {
    return {
      success: false,
      task_id,
      task_type: task_type === 'unknown' ? 'text' : task_type,
      error: error || 'Unknown error',
      duration_ms: Date.now() - startTime,
    };
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
