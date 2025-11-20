# Authentication Middleware

Secure authentication system for Cloudflare Workers with API key validation, user context loading, and permission management.

## Overview

This authentication middleware provides:
- API key generation and validation
- Secure key hashing using Web Crypto API
- User authentication and context loading
- Instance-based permission management
- Hierarchical role system (readonly, user, admin, owner)

## Quick Start

### Basic Usage

```typescript
import { authMiddleware } from '@/infrastructure/auth/middleware';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // Authenticate the request
    const authResult = await authMiddleware(request, env);

    if (!authResult.authorized) {
      return new Response(JSON.stringify({ error: authResult.error }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Access authenticated user
    const user = authResult.user;
    const instances = authResult.instances;

    // Continue with authorized request
    return new Response(`Hello ${user.name}!`);
  }
};
```

### Using Middleware Wrapper

```typescript
import { authMiddlewareWrapper } from '@/infrastructure/auth/middleware';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const { auth, response } = await authMiddlewareWrapper(request, env);

    // If authentication failed, response is already prepared
    if (response) {
      return response;
    }

    // Continue with auth.user, auth.instances, etc.
    return handleRequest(request, auth);
  }
};
```

## API Keys

### Key Format

- **Live keys**: `sk_live_[64 hex characters]`
- **Test keys**: `sk_test_[64 hex characters]`

### Generating Keys

```typescript
import { generateApiKey, generateKeyPair } from '@/infrastructure/auth/key-manager';

// Generate a live API key
const apiKey = await generateApiKey();
// Returns: sk_live_a1b2c3d4...

// Generate key and hash together
const { apiKey, hash } = await generateKeyPair();
// Store hash in database, return apiKey to user (only shown once)
```

### Using Keys in Requests

Include the API key in the `Authorization` header:

```bash
# With Bearer prefix (recommended)
curl -H "Authorization: Bearer sk_live_abc123..." https://api.example.com/

# Without Bearer prefix (also supported)
curl -H "Authorization: sk_live_abc123..." https://api.example.com/
```

## Permission System

### Permission Levels

The system uses a hierarchical permission model:

1. **readonly** - Can only read data
2. **user** - Can read and write data
3. **admin** - Can manage instance settings
4. **owner** - Full control over instance

Higher levels inherit all permissions from lower levels.

### Permission Checking

```typescript
import { hasPermission, canWrite, isAdmin } from '@/infrastructure/auth/types';

// Check specific permission level
if (hasPermission(authContext, 'instance-1', PermissionLevel.ADMIN)) {
  // User is admin or owner
}

// Use convenience functions
if (canWrite(authContext, 'instance-1')) {
  // User has write access (user, admin, or owner)
}

if (isAdmin(authContext, 'instance-1')) {
  // User is admin or owner
}
```

### Getting User's Instances

```typescript
import { getUserInstances, getInstancesWithPermission } from '@/infrastructure/auth/types';

// Get all instances user has access to
const allInstances = getUserInstances(authContext);

// Get only instances where user is admin or owner
const adminInstances = getInstancesWithPermission(
  authContext,
  PermissionLevel.ADMIN
);
```

## Security Features

### Key Hashing

All API keys are hashed using SHA-256 before storage:

```typescript
import { hashApiKey } from '@/infrastructure/auth/key-manager';

const apiKey = await generateApiKey();
const hash = await hashApiKey(apiKey);
// Store only the hash in the database
```

### Constant-Time Comparison

Key verification uses constant-time comparison to prevent timing attacks.

### Key Sanitization

Never log full API keys:

```typescript
import { sanitizeKeyForLogging } from '@/infrastructure/auth/key-manager';

console.log(`Auth attempt: ${sanitizeKeyForLogging(apiKey)}`);
// Output: sk_live_...a1b2
```

## Configuration Options

```typescript
const authResult = await authMiddleware(request, env, {
  // Allow test keys in production (default: false)
  allowTestKeys: true,

  // Custom error messages
  errorMessages: {
    noAuth: 'Please provide an API key',
    invalidKey: 'Your API key is invalid',
    inactiveUser: 'Your account has been deactivated'
  }
});
```

## Database Schema

The authentication system expects these tables:

### users table
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);
```

### instance_access table
```sql
CREATE TABLE instance_access (
  user_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('readonly', 'user', 'admin', 'owner')),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, instance_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (instance_id) REFERENCES instances(id)
);
```

## Testing

Run tests with:

```bash
npm test tests/auth/
```

Test coverage includes:
- Key generation and validation
- Key hashing and verification
- Permission checking
- Middleware authentication flow
- Error handling

## Error Handling

The middleware returns structured error responses:

```typescript
{
  authorized: false,
  error: "Authorization header required" |
         "Invalid API key" |
         "User account is inactive" |
         "Authentication failed"
}
```

## Best Practices

1. **Never expose API keys in logs or responses**
   - Use `sanitizeKeyForLogging()` when logging
   - Never return keys in API responses

2. **Store only hashed keys**
   - Never store plain-text API keys
   - Show keys to users only once during generation

3. **Use appropriate permission levels**
   - Grant minimum required permissions
   - Review instance access regularly

4. **Validate instance access before operations**
   - Always check permissions before allowing actions
   - Use `requireAuth()` to ensure authentication

5. **Test keys in development**
   - Use test keys (`sk_test_*`) in development
   - Block test keys in production unless explicitly allowed

## Integration Example

Complete worker example:

```typescript
import { authMiddleware, requireAuth, canWrite } from '@/infrastructure/auth';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // Authenticate
    const authResult = await authMiddleware(request, env);
    if (!authResult.authorized) {
      return new Response('Unauthorized', { status: 401 });
    }

    const auth = requireAuth(authResult);

    // Parse request
    const url = new URL(request.url);
    const instanceId = url.searchParams.get('instance');

    if (!instanceId) {
      return new Response('Instance ID required', { status: 400 });
    }

    // Check permissions
    if (request.method === 'POST' && !canWrite(auth, instanceId)) {
      return new Response('Insufficient permissions', { status: 403 });
    }

    // Process request
    return handleRequest(request, auth, instanceId);
  }
};
```
