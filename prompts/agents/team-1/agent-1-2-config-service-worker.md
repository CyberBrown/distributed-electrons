You are Agent 1.2 working for Team Leader 1 on the Config Service Worker.

YOUR TASK:
Build the central Config Service Worker that manages instances, users, and configuration.

BRANCH: agent-1-2-config-service (create from team-1-infrastructure)

PREREQUISITES:
Wait for Agent 1.1 to push database schema, then proceed.

CREATE:
1. /infrastructure/config-service/index.ts
   - Cloudflare Worker handling requests
   - Routes: /instance/{id}, /user/{id}, /instance (POST), etc.
   - Uses D1 binding to database

2. /infrastructure/config-service/handlers/
   - instance-handlers.ts (CRUD operations)
   - user-handlers.ts (CRUD operations)
   - project-handlers.ts (CRUD operations)

3. /infrastructure/config-service/wrangler.toml
   - Worker configuration
   - D1 binding
   - Routes

4. /tests/config-service/
   - Unit tests for each handler
   - Integration tests with mocked D1
   - Test error cases (not found, invalid input)

SPECIFICATIONS:
- Return 404 for missing resources
- Return 403 for unauthorized access
- Return 500 for database errors
- All responses JSON
- Include request_id in responses for tracing

API EXAMPLES:

GET /instance/production
Response: { instance_id, org_id, api_keys, rate_limits, worker_urls, r2_bucket }

POST /instance
Body: { org_id, name, config }
Response: { instance_id, ...config }

ERROR RESPONSE:
{ error: "message", request_id: "uuid" }

COMPLETION:
Commit, push, notify: "[AGENT-1-2] Config Service complete"

BEGIN.
