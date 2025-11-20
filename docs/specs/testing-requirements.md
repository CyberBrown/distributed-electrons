# Testing Requirements

## Testing Philosophy

Every component must be thoroughly tested before merging. Tests serve as:
1. **Documentation** - Show how components are used
2. **Safety Net** - Prevent regressions
3. **Design Tool** - Force clean interfaces
4. **Confidence** - Enable rapid iteration

---

## Coverage Requirements

### Minimum Coverage
- **Overall**: 80% code coverage
- **Critical Paths**: 100% coverage (auth, payment, data mutation)
- **Utilities**: 90% coverage
- **UI Components**: 70% coverage (harder to test)

### What to Cover
- ✓ All public functions/methods
- ✓ All error cases
- ✓ All edge cases (null, empty, max values)
- ✓ All API endpoints
- ✓ All provider integrations
- ✓ All database queries

---

## Test Types

### 1. Unit Tests

**Purpose**: Test individual functions in isolation

**Requirements**:
- Every utility function must have unit tests
- Mock all external dependencies
- Fast execution (< 100ms per test)
- No network calls

**Example Location**: `/tests/{component}/{file}.test.ts`

**Example**:
```typescript
// File: infrastructure/auth/key-manager.ts
// Test: tests/infrastructure/auth/key-manager.test.ts

import { describe, it, expect } from 'vitest';
import { hashApiKey, validateKeyFormat } from '@/infrastructure/auth/key-manager';

describe('hashApiKey', () => {
  it('should hash an API key using SHA-256', async () => {
    const key = 'ak_test_12345';
    const hash = await hashApiKey(key);

    expect(hash).toBeDefined();
    expect(hash).toHaveLength(64); // SHA-256 hex length
  });

  it('should produce consistent hashes for same input', async () => {
    const key = 'ak_test_12345';
    const hash1 = await hashApiKey(key);
    const hash2 = await hashApiKey(key);

    expect(hash1).toBe(hash2);
  });
});

describe('validateKeyFormat', () => {
  it('should accept valid API key format', () => {
    expect(validateKeyFormat('ak_prod_abc123')).toBe(true);
    expect(validateKeyFormat('ak_dev_xyz789')).toBe(true);
  });

  it('should reject invalid formats', () => {
    expect(validateKeyFormat('invalid')).toBe(false);
    expect(validateKeyFormat('ak_')).toBe(false);
    expect(validateKeyFormat('')).toBe(false);
  });
});
```

---

### 2. Integration Tests

**Purpose**: Test component interactions with mocked external services

**Requirements**:
- Mock external APIs (Ideogram, Cloudflare services)
- Test component integration points
- Verify data flow between layers
- Test error propagation

**Example**:
```typescript
// File: tests/workers/image-gen/image-gen.integration.test.ts

import { describe, it, expect, vi } from 'vitest';
import { handleImageGeneration } from '@/workers/image-gen';
import { mockD1, mockR2, mockRateLimiter } from '@/tests/mocks';

describe('Image Generation Integration', () => {
  it('should complete full image generation flow', async () => {
    const mockEnv = {
      DB: mockD1({
        instances: [{ instance_id: 'test', api_keys: { ideogram: 'test_key' }}]
      }),
      STORAGE: mockR2(),
      RATE_LIMITER: mockRateLimiter({ allowed: true })
    };

    const request = new Request('https://test.com/generate', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ak_test_123' },
      body: JSON.stringify({ prompt: 'test image' })
    });

    const response = await handleImageGeneration(request, mockEnv);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.image_url).toBeDefined();
    expect(data.metadata.provider).toBe('ideogram');
  });

  it('should handle rate limit correctly', async () => {
    const mockEnv = {
      RATE_LIMITER: mockRateLimiter({
        allowed: false,
        retry_after: 60
      })
    };

    const request = new Request('https://test.com/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'test' })
    });

    const response = await handleImageGeneration(request, mockEnv);

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
  });
});
```

---

### 3. End-to-End (E2E) Tests

**Purpose**: Test critical user journeys from start to finish

**Requirements**:
- Test at least one complete flow per worker
- Use test environment with real Cloudflare services
- Verify actual provider integration (with test API keys)
- Check database persistence

**Example**:
```typescript
// File: tests/e2e/image-generation.e2e.test.ts

import { describe, it, expect } from 'vitest';

describe('Image Generation E2E', () => {
  it('should generate and store an image end-to-end', async () => {
    // 1. Create test instance
    const instanceResponse = await fetch('https://config-service-test.workers.dev/instance', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.TEST_ADMIN_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        instance_id: 'e2e-test',
        org_id: 'test-org',
        api_keys: { ideogram: process.env.IDEOGRAM_TEST_KEY },
        rate_limits: { ideogram: { rpm: 10, tpm: 10000 }}
      })
    });
    expect(instanceResponse.status).toBe(201);

    // 2. Generate image
    const genResponse = await fetch('https://image-gen-e2e-test.workers.dev/generate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.TEST_USER_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: 'A simple test image',
        instance_id: 'e2e-test'
      })
    });
    expect(genResponse.status).toBe(200);

    const data = await genResponse.json();
    expect(data.image_url).toMatch(/^https:\/\//);

    // 3. Verify image accessible
    const imageResponse = await fetch(data.image_url);
    expect(imageResponse.status).toBe(200);
    expect(imageResponse.headers.get('content-type')).toMatch(/image\//);
  });
});
```

---

### 4. Error Case Testing

**Requirements**: Every component must test error scenarios

**Must Test**:
- Invalid input (null, empty, malformed)
- Missing authentication
- Insufficient permissions
- Resource not found
- Rate limits exceeded
- Provider timeouts
- Provider errors
- Network failures
- Database failures

**Example**:
```typescript
describe('Error Handling', () => {
  it('should return 401 for missing API key', async () => {
    const request = new Request('https://test.com/generate', {
      method: 'POST'
      // No Authorization header
    });

    const response = await handleImageGeneration(request, env);
    expect(response.status).toBe(401);
  });

  it('should return 400 for invalid prompt', async () => {
    const request = new Request('https://test.com/generate', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ak_test' },
      body: JSON.stringify({ prompt: '' }) // Empty prompt
    });

    const response = await handleImageGeneration(request, env);
    expect(response.status).toBe(400);
  });

  it('should handle provider timeout gracefully', async () => {
    const mockProvider = vi.fn().mockImplementation(() => {
      return new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 100)
      );
    });

    const result = await generateWithTimeout(mockProvider, 50);

    expect(result.error).toBe('Provider timeout');
    expect(result.status).toBe(504);
  });
});
```

---

## Test File Structure

```
/tests/
├── mocks/
│   ├── cloudflare.ts          # Mock D1, KV, R2, Durable Objects
│   ├── providers.ts           # Mock Ideogram, other providers
│   └── fixtures.ts            # Test data fixtures
│
├── infrastructure/
│   ├── database/
│   │   └── schema.test.ts
│   ├── config-service/
│   │   └── handlers.test.ts
│   ├── auth/
│   │   ├── middleware.test.ts
│   │   └── key-manager.test.ts
│   └── lookup/
│       └── instance-resolver.test.ts
│
├── workers/
│   ├── shared/
│   │   ├── provider-adapters/
│   │   │   ├── base-adapter.test.ts
│   │   │   ├── ideogram-adapter.test.ts
│   │   │   └── registry.test.ts
│   │   ├── rate-limiter/
│   │   │   └── limiter.test.ts
│   │   ├── r2-manager/
│   │   │   └── storage.test.ts
│   │   └── error-handling/
│   │       ├── retry.test.ts
│   │       └── errors.test.ts
│   └── image-gen/
│       ├── image-gen.test.ts
│       └── image-gen.integration.test.ts
│
└── e2e/
    ├── image-generation.e2e.test.ts
    ├── instance-management.e2e.test.ts
    └── user-auth.e2e.test.ts
```

---

## Test Naming Convention

### File Names
- Unit tests: `{component}.test.ts`
- Integration tests: `{component}.integration.test.ts`
- E2E tests: `{feature}.e2e.test.ts`

### Test Descriptions
```typescript
describe('ComponentName', () => {
  describe('methodName', () => {
    it('should do something when condition is met', () => {
      // Test implementation
    });

    it('should throw error when invalid input provided', () => {
      // Test implementation
    });
  });
});
```

---

## Mock Data Standards

### Consistent Test Data
```typescript
// File: tests/mocks/fixtures.ts

export const TEST_INSTANCES = {
  production: {
    instance_id: 'test-production',
    org_id: 'test-org',
    api_keys: { ideogram: 'test_ide_key' },
    rate_limits: { ideogram: { rpm: 100, tpm: 50000 }}
  },
  development: {
    instance_id: 'test-development',
    org_id: 'test-org',
    api_keys: { ideogram: 'test_ide_dev_key' },
    rate_limits: { ideogram: { rpm: 10, tpm: 5000 }}
  }
};

export const TEST_USERS = {
  admin: {
    user_id: 'test-admin',
    email: 'admin@test.com',
    role: 'admin',
    api_key: 'ak_test_admin_123'
  },
  user: {
    user_id: 'test-user',
    email: 'user@test.com',
    role: 'user',
    api_key: 'ak_test_user_456'
  }
};
```

---

## Running Tests

### Commands
```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage

# Run specific test file
npm test path/to/file.test.ts

# Run E2E tests only
npm test -- --grep e2e
```

### CI Requirements
- All tests must pass before merge
- Coverage must meet minimums
- No failing tests allowed
- Performance tests must meet benchmarks

---

## Performance Testing

### Response Time Benchmarks
- Config Service: < 50ms
- Image Generation: < 15s
- Rate Limiter: < 5ms
- R2 Upload: < 2s

### Load Testing
- Test with 100 concurrent requests
- Verify rate limiting works under load
- Check for memory leaks
- Monitor Durable Object performance

---

## Documentation in Tests

Tests should be **self-documenting**:

```typescript
it('should cache instance config for 5 minutes to reduce DB queries', async () => {
  const resolver = new InstanceResolver(env);

  // First call - hits database
  await resolver.resolve('production');
  expect(env.DB.query).toHaveBeenCalledTimes(1);

  // Second call within 5 min - uses cache
  await resolver.resolve('production');
  expect(env.DB.query).toHaveBeenCalledTimes(1); // Still 1, not 2

  // After 5 min - hits database again
  vi.advanceTimersByTime(5 * 60 * 1000);
  await resolver.resolve('production');
  expect(env.DB.query).toHaveBeenCalledTimes(2);
});
```

---

## Pre-Commit Requirements

Before committing code:
- [ ] All new code has unit tests
- [ ] Integration tests updated if needed
- [ ] All tests passing locally
- [ ] Coverage meets requirements
- [ ] No console.log statements left in code
- [ ] Error cases tested

---

**Document Version**: 1.0
**Last Updated**: 2025-11-20
**Status**: Specification for Multi-Agent Development
