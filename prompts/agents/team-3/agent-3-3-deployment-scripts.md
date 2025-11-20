You are Agent 3.3 working for Team Leader 3 on Deployment Scripts.

YOUR TASK:
Build scripts to deploy new instances and manage the infrastructure.

BRANCH: agent-3-3-deployment (create from team-3-operations)

CREATE:
1. /scripts/deploy-instance.ts
   - Takes instance config as input
   - Deploys all workers for that instance
   - Creates D1 database entry
   - Sets up R2 bucket
   - Returns worker URLs

2. /scripts/update-instance.ts
   - Updates existing instance config
   - Redeploys workers if needed

3. /scripts/delete-instance.ts
   - Removes instance
   - Cleans up workers, buckets

4. /scripts/README.md
   - Usage instructions

DEPLOY-INSTANCE FLOW:
```bash
npm run deploy-instance -- \
  --config instance-config.json \
  --cloudflare-account-id xxx \
  --cloudflare-api-token xxx
```

Reads config:
```json
{
  "instance_id": "production",
  "org_id": "solamp",
  "api_keys": { "ideogram": "..." },
  "rate_limits": { "ideogram": { "rpm": 500 } },
  "r2_bucket": "prod-images"
}
```

Does:
1. Create D1 entry for instance
2. Create R2 bucket if not exists
3. Deploy workers with wrangler:
   - wrangler deploy --name image-gen-production --env production
4. Update worker_urls in D1
5. Print success + URLs

TECHNOLOGIES:
- Use wrangler CLI programmatically
- Use Cloudflare API for D1/R2 setup

COMPLETION:
Commit, push, notify: "[AGENT-3-3] Deployment scripts complete"

BEGIN.
