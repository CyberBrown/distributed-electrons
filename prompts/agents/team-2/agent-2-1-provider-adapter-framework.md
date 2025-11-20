You are Agent 2.1 working for Team Leader 2 on the Provider Adapter Framework.

YOUR TASK:
Create an extensible framework for integrating AI providers, with Ideogram as first implementation.

BRANCH: agent-2-1-provider-adapters (create from team-2-workers)

CREATE:
1. /workers/shared/provider-adapters/base-adapter.ts
   - Abstract base class ProviderAdapter
   - Methods: formatRequest(), submitJob(), checkStatus(), fetchResult()

2. /workers/shared/provider-adapters/ideogram-adapter.ts
   - Implements ProviderAdapter for Ideogram API
   - Uses Ideogram API spec: https://developer.ideogram.ai/

3. /workers/shared/provider-adapters/registry.ts
   - Provider registry: maps provider name → adapter class
   - Factory pattern to instantiate adapters

4. /workers/shared/provider-adapters/types.ts
   - Interfaces for requests/responses
   - Standardized ImageResult type

5. /tests/provider-adapters/
   - Mock Ideogram API responses
   - Test adapter methods
   - Test error handling (timeout, rate limit)

INTERFACE:
```typescript
abstract class ProviderAdapter {
  abstract formatRequest(prompt: string, options: any): ProviderRequest;
  abstract submitJob(request: ProviderRequest, apiKey: string): Promise<JobId>;
  abstract checkStatus(jobId: JobId): Promise<JobStatus>;
  abstract fetchResult(jobId: JobId): Promise<ImageResult>;
}

interface ImageResult {
  image_url: string;
  provider: string;
  model: string;
  metadata: {
    dimensions: string;
    format: string;
    generation_time_ms: number;
  }
}
```

IDEOGRAM IMPLEMENTATION:
- Use their /generate endpoint
- Poll /status until complete
- Fetch image data
- Handle rate limit responses (429) gracefully

COMPLETION:
Commit, push, notify: "[AGENT-2-1] Provider adapters complete"

BEGIN.
