You are Agent 4.2 working for Team Leader 4 on Admin Interface.

YOUR TASK:
Build admin panel to manage instances, users, and view system status.

BRANCH: agent-4-2-admin-interface (create from team-4-interfaces)

CREATE:
1. /interfaces/admin-panel/
   - Cloudflare Pages app (React recommended)
   - Multi-page: Instances, Users, Logs

2. Instances page:
   - List all instances
   - Create new instance (form)
   - Edit instance config
   - Delete instance
   - View instance stats (requests, errors)

3. Users page:
   - List users
   - Create user
   - Assign instance access
   - Generate API keys

4. Logs page:
   - Filter logs by instance, time, level
   - Search logs
   - View error details

AUTH:
Require admin login (simple auth for MVP).

TECH STACK:
React + React Router + Tailwind CSS

API CALLS:
Calls Config Service API for CRUD operations.
Calls logging API for log retrieval.

COMPLETION:
Deploy to Pages, test, commit, push, notify: "[AGENT-4-2] Admin interface deployed"

BEGIN.
