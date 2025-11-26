# Deployment Scripts

Automated deployment and management scripts for Cloudflare Multi-Agent instances.

## Prerequisites

- Node.js 18+
- Wrangler CLI configured with Cloudflare credentials
- Cloudflare account with Workers, D1, and R2 enabled

## Environment Variables

```bash
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
export CLOUDFLARE_API_TOKEN="your-api-token"
```

## Scripts

### deploy-instance.ts

Deploy a new instance with full infrastructure setup.

**Usage:**
```bash
npm run deploy-instance -- --config instances/production.json
```

**Options:**
- `--config <path>` - Path to instance configuration JSON (required)
- `--cloudflare-account-id <id>` - Cloudflare account ID
- `--cloudflare-api-token <token>` - Cloudflare API token
- `--dry-run` - Simulate deployment without making changes
- `--help` - Display help message

**What it does:**
1. Creates R2 bucket for instance storage
2. Deploys all workers (config-service, image-gen)
3. Creates database entry with instance configuration
4. Returns worker URLs and setup information

**Example Config:**
```json
{
  "instance_id": "production",
  "org_id": "your-org-id",
  "name": "Production Instance",
  "api_keys": {
    "ideogram": "ide_your_api_key"
  },
  "rate_limits": {
    "ideogram": {
      "rpm": 500,
      "tpm": 100000
    }
  },
  "r2_bucket": "prod-images",
  "authorized_users": ["user-123", "user-456"]
}
```

### update-instance.ts

Update an existing instance configuration and optionally redeploy workers.

**Usage:**
```bash
npm run update-instance -- --instance-id production --config instances/production-updated.json
```

**Options:**
- `--instance-id <id>` - Instance ID to update (required)
- `--config <path>` - Path to updated configuration JSON
- `--redeploy-workers` - Redeploy all workers after config update

**What it does:**
1. Updates instance configuration in database
2. Optionally redeploys workers with new configuration
3. Validates changes

### delete-instance.ts

Remove an instance and clean up all resources.

**Usage:**
```bash
npm run delete-instance -- --instance-id staging
```

**Options:**
- `--instance-id <id>` - Instance ID to delete (required)
- `--force` - Skip confirmation prompt
- `--keep-bucket` - Don't delete R2 bucket (preserves data)

**What it does:**
1. Confirms deletion (unless `--force`)
2. Deletes all workers
3. Optionally deletes R2 bucket
4. Removes database entry

**Warning:** This is a destructive operation. Always backup important data first.

## Workflow Examples

### Deploy New Production Instance

```bash
# 1. Create config file
cat > instances/production.json <<EOF
{
  "instance_id": "production",
  "org_id": "my-org",
  "name": "Production Instance",
  "api_keys": { "ideogram": "ide_prod_key" },
  "rate_limits": { "ideogram": { "rpm": 500, "tpm": 100000 } },
  "r2_bucket": "prod-images"
}
EOF

# 2. Deploy instance
npm run deploy-instance -- --config instances/production.json

# 3. Verify deployment
curl https://config-service-production.workers.dev/health
```

### Update Instance Configuration

```bash
# Update rate limits
npm run update-instance -- \\
  --instance-id production \\
  --config instances/production-updated.json \\
  --redeploy-workers
```

### Migrate from Staging to Production

```bash
# 1. Deploy new production instance
npm run deploy-instance -- --config instances/production.json

# 2. Test production instance
npm run test -- --instance production

# 3. Delete staging when ready
npm run delete-instance -- --instance-id staging
```

### Disaster Recovery

```bash
# 1. Keep bucket for data preservation
npm run delete-instance -- --instance-id production --keep-bucket

# 2. Redeploy from backup config
npm run deploy-instance -- --config backups/production-backup.json
```

## Troubleshooting

### Workers Not Deploying

```bash
# Check Wrangler authentication
wrangler whoami

# Verify worker scripts exist
ls -la workers/*/index.ts

# Deploy manually for debugging
wrangler deploy --name config-service-production
```

### Database Errors

```bash
# Check D1 database
wrangler d1 list

# Execute manual query
wrangler d1 execute DB --command "SELECT * FROM instances"

# Reset database (DESTRUCTIVE)
wrangler d1 execute DB --file infrastructure/database/migrations/001-initial.sql
```

### R2 Bucket Issues

```bash
# List all buckets
wrangler r2 bucket list

# Check bucket contents
wrangler r2 object list prod-images

# Manually create bucket
wrangler r2 bucket create prod-images
```

## Best Practices

1. **Always use dry-run first** for new deployments
2. **Backup configs** before updates
3. **Test in staging** before production
4. **Keep R2 buckets** when deleting instances (data preservation)
5. **Use environment variables** for credentials (never commit API keys)
6. **Document instance configs** in version control
7. **Monitor deployments** in Cloudflare dashboard

## CI/CD Integration

These scripts are designed to work with GitHub Actions:

```yaml
- name: Deploy Instance
  run: |
    npm run deploy-instance -- --config instances/${{ matrix.instance }}.json
  env:
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

See `.github/workflows/deploy.yml` for complete examples.

## Support

For issues or questions:
- Check Cloudflare Workers documentation
- Review Wrangler CLI documentation
- Open an issue on GitHub
- Contact DevOps team

---

**Last Updated:** 2025-11-20
**Version:** 1.0.0
