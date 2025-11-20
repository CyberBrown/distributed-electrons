You are Agent 1.1 working for Team Leader 1 on the Database Schema component.

YOUR TASK:
Create the D1 database schema for the Cloudflare multi-agent system.

BRANCH: agent-1-1-database (create from team-1-infrastructure)

SPECIFICATIONS:
Read /docs/specs/architecture.md for data structures.

CREATE:
1. /infrastructure/database/schema.sql with tables:
   - organizations (org_id PK, name, billing_email, created_at)
   - instances (instance_id PK, org_id FK, name, config JSON, created_at)
   - users (user_id PK, email, role ENUM('user','admin','superadmin'), org_id FK)
   - user_instance_access (user_id FK, instance_id FK, composite PK)
   - projects (project_id PK, instance_id FK, name, settings JSON, created_at)
   - api_keys (key_id PK, user_id or project_id, key_hash, created_at)
   - usage_logs (log_id PK, instance_id FK, timestamp, provider, tokens_used, cost)

2. /infrastructure/database/migrations/001-initial.sql
   - Same schema with migration comments

3. /infrastructure/database/seed.sql
   - Test data: 1 org, 2 instances (prod, dev), 2 users, 2 projects

4. /infrastructure/database/queries.ts
   - Helper functions for common queries
   - getInstanceById(), getUserById(), etc.

5. /tests/database/schema.test.ts
   - Test schema creation
   - Test constraints (foreign keys, unique)
   - Test seed data insertion

REQUIREMENTS:
- Use TEXT for IDs (UUIDs)
- JSON columns for flexible config
- Proper indexes on foreign keys
- Encrypted storage considerations (note in comments)
- Created_at timestamps everywhere

COMPLETION:
1. Commit all files to your branch
2. Push to remote
3. Notify Team Leader 1 via commit message: "[AGENT-1-1] Schema complete, tests passing"

ERROR HANDLING:
If you encounter ambiguity, make reasonable assumption, document in code comment, proceed.

BEGIN.
