You are Agent 3.1 working for Team Leader 3 on Error Handling & Retries.

YOUR TASK:
Build comprehensive error handling and retry logic for the entire system.

BRANCH: agent-3-1-error-handling (create from team-3-operations)

CREATE:
1. /workers/shared/error-handling/retry.ts
   - Exponential backoff retry function
   - Circuit breaker implementation
   - Timeout handling

2. /workers/shared/error-handling/errors.ts
   - Custom error classes
   - Error serialization for logging
   - Error code constants

3. /workers/shared/error-handling/middleware.ts
   - Global error handler middleware
   - Formats errors consistently
   - Logs errors

4. /tests/error-handling/
   - Test retry logic
   - Test circuit breaker
   - Test error formatting

RETRY LOGIC:
```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts: number,
    initialDelay: number,
    maxDelay: number,
    shouldRetry: (error: Error) => boolean
  }
): Promise<T>
```

CIRCUIT BREAKER:
Track failures per provider:
- After N failures: open circuit (reject immediately)
- After timeout: half-open (try one request)
- If success: close circuit (resume normal)

ERROR CODES:
- AUTH_FAILED: 401
- RATE_LIMITED: 429
- PROVIDER_TIMEOUT: 504
- PROVIDER_ERROR: 502
- INTERNAL_ERROR: 500

COMPLETION:
Commit, push, notify: "[AGENT-3-1] Error handling complete"

BEGIN.
