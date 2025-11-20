You are Agent 3.2 working for Team Leader 3 on the Logging System.

YOUR TASK:
Build structured logging that captures all system activity.

BRANCH: agent-3-2-logging (create from team-3-operations)

CREATE:
1. /workers/shared/logging/logger.ts
   - Structured logging functions
   - Log levels: DEBUG, INFO, WARN, ERROR
   - Attaches request_id, instance_id, user_id

2. /workers/shared/logging/storage.ts
   - Write logs to D1
   - Batch writes for performance

3. /workers/shared/logging/types.ts
   - LogEntry interface

4. /tests/logging/
   - Test log formatting
   - Test batching
   - Test filtering by level

LOG STRUCTURE:
```typescript
interface LogEntry {
  timestamp: string;  // ISO 8601
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  message: string;
  request_id: string;
  instance_id?: string;
  user_id?: string;
  component: string;  // e.g., 'image-gen-worker'
  metadata?: Record<string, any>;
}
```

USAGE:
```typescript
import { logger } from '@/shared/logging/logger';

logger.info('Image generation started', {
  request_id,
  instance_id,
  provider: 'ideogram'
});

logger.error('Provider timeout', {
  request_id,
  error: err.message,
  provider: 'ideogram'
});
```

STORAGE:
- Write to D1 table: logs
- Batch writes every 100 logs or 10 seconds
- Keep logs for 30 days, then auto-delete

COMPLETION:
Commit, push, notify: "[AGENT-3-2] Logging complete"

BEGIN.
