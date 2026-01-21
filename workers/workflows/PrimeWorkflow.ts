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
import { determineWaterfall, parseDefaultWaterfall } from './lib/model-mapping';

/**
 * Failure indicators that suggest the AI reported success but didn't actually complete the task.
 * Defense-in-depth check - sub-workflows should also check these, but we validate here too.
 *
 * IMPORTANT: Keep this in sync with:
 * - TextGenerationWorkflow.ts
 * - nexus/src/workflows/TaskExecutorWorkflow.ts
 * - de/workers/workflows/lib/nexus-callback.ts
 * - nexus/src/index.ts (workflow-callback handler)
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
] as const;

/**
 * Normalize text for comparison by replacing curly quotes with straight quotes.
 * This handles cases where AI outputs use typographic quotes instead of standard ASCII.
 */
function normalizeQuotes(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")  // Single curly quotes → '
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"'); // Double curly quotes → "
}

/**
 * Check if the output contains failure indicators suggesting the task wasn't completed.
 * Normalizes quotes to handle typographic apostrophes (e.g., ' vs ').
 */
function containsFailureIndicators(text: string | undefined): boolean {
  if (!text) return false;
  const normalizedText = normalizeQuotes(text.toLowerCase());
  return FAILURE_INDICATORS.some(indicator => normalizedText.includes(indicator));
}

// Workflow bindings are now used directly instead of HTTP fetch

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
    if (hints?.workflow === 'product-shipping-research') {
      console.log('[PrimeWorkflow] Classification: product-shipping-research (hint)');
      return 'product-shipping-research';
    }

    // 5. Check for product shipping research context signal
    if (context?.product) {
      console.log('[PrimeWorkflow] Classification: product-shipping-research (context.product present)');
      return 'product-shipping-research';
    }

    // 6. Default to text (safer, cheaper, faster)
    console.log('[PrimeWorkflow] Classification: text (default)');
    return 'text';
  }

  /**
   * Route to the appropriate sub-workflow and wait for completion
   * Uses workflow bindings directly instead of HTTP fetch
   */
  private async routeToSubWorkflow(
    taskType: TaskType,
    params: PrimeWorkflowParams
  ): Promise<SubWorkflowResult> {
    const startTime = Date.now();
    const workflowId = `prime-${params.task_id}-${Date.now()}`;

    console.log(`[PrimeWorkflow] Triggering ${taskType} sub-workflow via binding`);

    // Use workflow bindings directly instead of HTTP
    let instance: { id: string; status: () => Promise<{ status: string; output?: unknown; error?: string }> };

    switch (taskType) {
      case 'code':
        // Determine effective waterfall for code execution
        const defaultWaterfall = parseDefaultWaterfall(this.env.DEFAULT_MODEL_WATERFALL);
        const waterfall = determineWaterfall({
          model_waterfall: params.model_waterfall,
          primary_model: params.primary_model,
          preferred_executor: params.hints?.provider === 'gemini' ? 'gemini' : 'claude',
          override_until: params.override_until,
          override_waterfall: params.override_waterfall,
          default_waterfall: defaultWaterfall,
        });

        console.log(`[PrimeWorkflow] Code execution waterfall: ${waterfall.join(' → ')}`);

        instance = await this.env.CODE_EXECUTION_WORKFLOW.create({
          id: workflowId,
          params: {
            task_id: params.task_id,
            prompt: `${params.title}\n\n${params.description}`,
            repo_url: params.context?.repo,
            model_waterfall: waterfall,
            // Keep preferred_executor for backwards compatibility
            preferred_executor:
              params.hints?.provider === 'gemini' ? 'gemini' : 'claude',
            timeout_ms: params.timeout_ms,
            callback_url: params.callback_url,
          },
        });
        break;

      case 'text':
        instance = await this.env.TEXT_GENERATION_WORKFLOW.create({
          id: workflowId,
          params: {
            request_id: params.task_id,
            prompt: `${params.title}\n\n${params.description}`,
            system_prompt: params.context?.system_prompt,
            max_tokens: 4096,
            temperature: 0.7,
            callback_url: params.callback_url,
          },
        });
        break;

      case 'video':
        instance = await this.env.VIDEO_RENDER_WORKFLOW.create({
          id: workflowId,
          params: {
            request_id: params.task_id,
            timeline: params.context?.timeline,
            output: params.context?.output,
            callback_url: params.callback_url,
          },
        });
        break;

      case 'image':
        instance = await this.env.IMAGE_GENERATION_WORKFLOW.create({
          id: workflowId,
          params: {
            request_id: params.task_id,
            prompt: `${params.title}\n\n${params.description}`,
            model_id: params.hints?.model,
            callback_url: params.callback_url,
          },
        });
        break;

      case 'audio':
        instance = await this.env.AUDIO_GENERATION_WORKFLOW.create({
          id: workflowId,
          params: {
            request_id: params.task_id,
            text: params.description || params.title,
            voice_id: params.hints?.model,
            callback_url: params.callback_url,
          },
        });
        break;

      case 'product-shipping-research':
        if (!params.context?.product) {
          throw new Error('Product shipping research requires product context');
        }
        instance = await this.env.PRODUCT_SHIPPING_RESEARCH_WORKFLOW.create({
          id: workflowId,
          params: {
            request_id: params.task_id,
            product: params.context.product,
            callback_url: params.callback_url,
            timeout_ms: params.timeout_ms,
          },
        });
        break;

      default:
        throw new Error(`Unknown task type: ${taskType}`);
    }

    console.log(`[PrimeWorkflow] Sub-workflow started: ${instance.id}`);

    // Poll for completion using workflow binding
    const completionResult = await this.pollForCompletion(instance);

    return {
      success: completionResult.success,
      workflow_id: instance.id,
      output: completionResult.output,
      text: completionResult.text,
      executor: completionResult.executor,
      provider: completionResult.provider,
      error: completionResult.error,
      duration_ms: Date.now() - startTime,
    };
  }

  /**
   * Poll sub-workflow for completion using workflow binding
   */
  private async pollForCompletion(
    instance: { id: string; status: () => Promise<{ status: string; output?: unknown; error?: string }> }
  ): Promise<SubWorkflowResult> {
    const maxAttempts = 60; // 5 minutes at 5-second intervals
    const pollInterval = 5000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await this.sleep(pollInterval);

      try {
        const status = await instance.status();

        console.log(
          `[PrimeWorkflow] Poll attempt ${attempt + 1}: status=${status.status}`
        );

        if (status.status === 'complete') {
          const output = status.output as {
            success?: boolean;
            output?: string;
            text?: string;
            executor?: string;
            provider?: string;
            error?: string;
          } | undefined;

          // Defense-in-depth: Even if sub-workflow reports success,
          // check for failure indicators in the output text
          const outputText = output?.output || output?.text;
          const hasFailureIndicators = containsFailureIndicators(outputText);

          if (hasFailureIndicators && output?.success !== false) {
            console.log(`[PrimeWorkflow] Sub-workflow reported success but output contains failure indicators`);
            console.log(`[PrimeWorkflow] Output preview: ${outputText?.substring(0, 200)}`);
          }

          return {
            success: (output?.success ?? true) && !hasFailureIndicators,
            output: output?.output,
            text: output?.text,
            executor: output?.executor,
            provider: output?.provider,
            error: hasFailureIndicators ? 'Response indicates task was not completed' : output?.error,
          };
        }

        if (status.status === 'errored') {
          const output = status.output as { error?: string } | undefined;
          return {
            success: false,
            error: status.error || output?.error || 'Sub-workflow errored',
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
