You are Agent 4.4 working for Team Leader 4 on Monitoring Dashboard.

YOUR TASK:
Build a dashboard to monitor system health and usage.

BRANCH: agent-4-4-monitoring (create from team-4-interfaces)

CREATE:
1. /interfaces/monitoring/
   - Cloudflare Pages app
   - Dashboard with charts

2. Metrics to display:
   - Requests per instance (over time)
   - Error rate per instance
   - Average response time
   - Rate limit hits
   - Provider usage breakdown
   - Cost estimate (based on usage)

3. Charts:
   - Use Chart.js or similar
   - Time series for requests/errors
   - Pie chart for provider distribution

4. Filters:
   - By instance
   - By time range (last hour, day, week)

DATA SOURCE:
Query logs table in D1, aggregate metrics.

REFRESH:
Auto-refresh every 30 seconds.

TECH STACK:
React + Chart.js + Tailwind CSS

COMPLETION:
Deploy to Pages, test, commit, push, notify: "[AGENT-4-4] Monitoring deployed"

BEGIN.
