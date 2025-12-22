/**
 * Workflow Execution Engine
 * Orchestrates multi-step chains across workers and providers
 */

import type {
  WorkflowDefinition,
  WorkflowStep,
  RequestConstraints,
  RouterResponse,
  StepMeta,
  MediaOptions,
} from '../types';
import type { Router } from '../index';

/**
 * Workflow execution context
 */
interface ExecutionContext {
  variables: Record<string, any>;
  results: Record<string, any>;
  stepMeta: StepMeta[];
}

/**
 * Workflow Engine
 * Executes multi-step workflows with parallel execution support
 */
export class WorkflowEngine {
  constructor(private router: Router) {}

  /**
   * Execute a workflow definition
   */
  async execute(
    workflow: WorkflowDefinition,
    variables: Record<string, any>,
    globalConstraints?: RequestConstraints
  ): Promise<RouterResponse> {
    const context: ExecutionContext = {
      variables,
      results: {},
      stepMeta: [],
    };

    const startTime = Date.now();

    try {
      // Determine execution order
      const executionGroups = this.buildExecutionGroups(workflow);

      // Execute each group (groups run sequentially, steps within a group run in parallel)
      for (const group of executionGroups) {
        const groupSteps = workflow.steps.filter((s) => group.includes(s.id));

        const groupResults = await Promise.all(
          groupSteps.map((step) =>
            this.executeStep(step, context, globalConstraints)
          )
        );

        // Merge results into context
        for (let i = 0; i < groupSteps.length; i++) {
          context.results[groupSteps[i].output_key] = groupResults[i].result;
          context.stepMeta.push(groupResults[i].meta);
        }
      }

      return {
        success: true,
        results: context.results,
        _meta: {
          request_type: 'workflow',
          steps: context.stepMeta,
          total_cost_cents: context.stepMeta.reduce(
            (sum, s) => sum + (s.cost_cents || 0),
            0
          ),
          total_latency_ms: Date.now() - startTime,
        },
      };
    } catch (error) {
      return {
        success: false,
        results: {
          error: error instanceof Error ? error.message : 'Workflow execution failed',
          partial_results: context.results,
        },
        _meta: {
          request_type: 'workflow',
          steps: context.stepMeta,
          total_cost_cents: context.stepMeta.reduce(
            (sum, s) => sum + (s.cost_cents || 0),
            0
          ),
          total_latency_ms: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Execute a single workflow step
   */
  private async executeStep(
    step: WorkflowStep,
    context: ExecutionContext,
    globalConstraints?: RequestConstraints
  ): Promise<{ result: any; meta: StepMeta }> {
    // Expand template with variables and previous results
    const templateContext = { ...context.variables, ...context.results };
    const prompt = this.expandTemplate(step.prompt_template, templateContext);

    // Merge constraints
    const constraints = {
      ...globalConstraints,
      ...step.constraints,
    };

    // Execute via router
    const response = await this.router.route({
      type: 'simple',
      worker: step.worker,
      prompt,
      constraints,
      options: step.options as MediaOptions,
    });

    if (!response.success) {
      throw new Error(`Step ${step.id} failed: ${response.results.error}`);
    }

    return {
      result: response.results.result,
      meta: {
        ...response._meta.steps[0],
        id: step.id,
      },
    };
  }

  /**
   * Build execution groups from workflow definition
   * Groups are sets of steps that can run in parallel
   */
  private buildExecutionGroups(workflow: WorkflowDefinition): string[][] {
    // If parallel groups are explicitly defined, use them
    if (workflow.parallel_groups?.length) {
      return workflow.parallel_groups;
    }

    // Otherwise, build dependency-based groups
    const groups: string[][] = [];
    const completed = new Set<string>();

    while (completed.size < workflow.steps.length) {
      const nextGroup: string[] = [];

      for (const step of workflow.steps) {
        if (completed.has(step.id)) continue;

        // Check if dependencies are satisfied
        const canRun = this.checkDependencies(step, completed);
        if (canRun) {
          nextGroup.push(step.id);
        }
      }

      if (nextGroup.length === 0) {
        // Circular dependency or missing step
        throw new Error('Cannot resolve workflow dependencies');
      }

      groups.push(nextGroup);
      nextGroup.forEach((id) => completed.add(id));
    }

    return groups;
  }

  /**
   * Check if a step's dependencies are satisfied
   */
  private checkDependencies(step: WorkflowStep, completed: Set<string>): boolean {
    if (!step.input_from) return true;

    // Parse input_from format: "step:step-id" or "request"
    if (step.input_from === 'request') return true;

    if (step.input_from.startsWith('step:')) {
      const dependsOn = step.input_from.slice(5);
      return completed.has(dependsOn);
    }

    return true;
  }

  /**
   * Expand template variables
   * Format: {{variable_name}}
   */
  private expandTemplate(
    template: string,
    context: Record<string, any>
  ): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      const value = context[key];
      if (value === undefined) {
        console.warn(`Template variable not found: ${key}`);
        return match; // Keep original if not found
      }
      return String(value);
    });
  }
}
