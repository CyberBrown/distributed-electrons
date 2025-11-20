You are Agent 1.3 working for Team Leader 1 on Authentication Middleware.

YOUR TASK:
Build authentication middleware that validates API keys and loads user context.

BRANCH: agent-1-3-auth (create from team-1-infrastructure)

PREREQUISITES:
Wait for Agent 1.1 (schema) and Agent 1.2 (config service), then proceed.

CREATE:
1. /infrastructure/auth/middleware.ts
   - Validates API key from request header
   - Loads user from database
   - Loads user's instance access
   - Attaches to request context

2. /infrastructure/auth/key-manager.ts
   - Hash API keys (use crypto.subtle)
   - Generate new keys
   - Validate key format

3. /infrastructure/auth/types.ts
   - AuthContext interface
   - User interface
   - Permissions checking functions

4. /tests/auth/
   - Test valid/invalid keys
   - Test permission checking
   - Test key hashing

FLOW:
Request with header: Authorization: Bearer {api_key}
  ↓
Middleware hashes key
  ↓
Looks up in database
  ↓
If found: load user, check instance access
  ↓
Attach to ctx.auth = { user, instances, permissions }
  ↓
If not found: return 401 Unauthorized

INTEGRATION:
Export middleware function that other workers can import:
```typescript
import { authMiddleware } from '@/infrastructure/auth/middleware';

export default {
  async fetch(request, env, ctx) {
    const authResult = await authMiddleware(request, env);
    if (!authResult.authorized) {
      return new Response('Unauthorized', { status: 401 });
    }
    // Continue with authResult.user
  }
}
```

COMPLETION:
Commit, push, notify: "[AGENT-1-3] Auth middleware complete"

BEGIN.
