/**
 * Mock for cloudflare:workers module
 * Used by vitest for testing workflow code
 */

export interface WorkflowEvent<T = unknown> {
  payload: T;
  timestamp: Date;
  instanceId: string;
}

export interface WorkflowStep {
  do: <T>(
    name: string,
    options: { retries?: { limit: number; delay: string; backoff: string }; timeout?: string },
    fn: () => Promise<T>
  ) => Promise<T>;
  sleep: (duration: string) => Promise<void>;
  sleepUntil: (date: Date) => Promise<void>;
}

export class WorkflowEntrypoint<E = unknown, P = unknown> {
  protected env!: E;

  constructor() {
    // Workflow entrypoint base class
  }

  async run(_event: WorkflowEvent<P>, _step: WorkflowStep): Promise<unknown> {
    throw new Error('Workflow run method must be implemented');
  }
}
