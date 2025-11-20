# Team 1 Infrastructure Deployment Setup Guide

## Prerequisites

1. **Cloudflare Account** with Workers, D1, and KV access
2. **Wrangler CLI** installed and authenticated
3. **CLOUDFLARE_API_TOKEN** environment variable set

## Quick Start

### 1. Authenticate with Cloudflare

```bash
# Login to Cloudflare
wrangler login

# Or set API token
export CLOUDFLARE_API_TOKEN="your-token-here"
```

### 2. Create D1 Databases

```bash
# Development database
wrangler d1 create multi_tenant_db_dev

# Staging database
wrangler d1 create multi_tenant_db_staging

# Production database
wrangler d1 create multi_tenant_db_production
```

**Note:** Save the database IDs from the output!

### 3. Create KV Namespaces

```bash
# Development KV namespace
wrangler kv:namespace create CONFIG_CACHE --preview

# Staging KV namespace
wrangler kv:namespace create CONFIG_CACHE_STAGING

# Production KV namespace
wrangler kv:namespace create CONFIG_CACHE_PRODUCTION
```

**Note:** Save the namespace IDs from the output!

### 4. Update wrangler.toml

Edit `/workspace/infrastructure/config-service/wrangler.toml` and fill in the IDs:

```toml
# Development
[[d1_databases]]
binding = "DB"
database_name = "multi_tenant_db"
database_id = "xxxx-xxxx-xxxx-xxxx"  # From step 2

[[kv_namespaces]]
binding = "CONFIG_CACHE"
id = "xxxx-xxxx-xxxx-xxxx"  # From step 3

# Production
[[env.production.d1_databases]]
binding = "DB"
database_name = "multi_tenant_db_production"
database_id = "yyyy-yyyy-yyyy-yyyy"  # From step 2

[[env.production.kv_namespaces]]
binding = "CONFIG_CACHE"
id = "yyyy-yyyy-yyyy-yyyy"  # From step 3

# Staging
[[env.staging.d1_databases]]
binding = "DB"
database_name = "multi_tenant_db_staging"
database_id = "zzzz-zzzz-zzzz-zzzz"  # From step 2

[[env.staging.kv_namespaces]]
binding = "CONFIG_CACHE"
id = "zzzz-zzzz-zzzz-zzzz"  # From step 3
```

### 5. Run Database Migrations

```bash
# Development
wrangler d1 execute multi_tenant_db_dev --file=infrastructure/database/migrations/001-initial.sql

# Staging
wrangler d1 execute multi_tenant_db_staging --file=infrastructure/database/migrations/001-initial.sql

# Production
wrangler d1 execute multi_tenant_db_production --file=infrastructure/database/migrations/001-initial.sql
```

### 6. Verify Database Schema

```bash
# Check tables were created
wrangler d1 execute multi_tenant_db_dev --command="SELECT name FROM sqlite_master WHERE type='table'"

# Expected tables:
# - instances
# - users
# - user_instance_access
# - api_keys
# - projects
# - usage_logs
# - request_logs
```

### 7. (Optional) Seed Test Data

```bash
# Development only
wrangler d1 execute multi_tenant_db_dev --file=infrastructure/database/seed.sql
```

### 8. Deploy Config Service

```bash
cd infrastructure/config-service

# Deploy to development
wrangler deploy

# Deploy to staging
wrangler deploy --env staging

# Deploy to production
wrangler deploy --env production
```

### 9. Test Deployment

```bash
# Get the worker URL from deployment output
curl https://config-service-dev.<your-subdomain>.workers.dev/health

# Expected response:
# {"status":"healthy","timestamp":"2024-01-01T00:00:00Z"}
```

## Environment Configuration

### Development
- Database: `multi_tenant_db_dev`
- KV Namespace: `CONFIG_CACHE` (preview)
- Worker: `config-service-dev`

### Staging
- Database: `multi_tenant_db_staging`
- KV Namespace: `CONFIG_CACHE_STAGING`
- Worker: `config-service-staging`

### Production
- Database: `multi_tenant_db_production`
- KV Namespace: `CONFIG_CACHE_PRODUCTION`
- Worker: `config-service-production`

## Sharing Configuration with Other Teams

After deployment, share the following with other teams:

### For Team 2 (Workers)
```bash
# Share these IDs for their wrangler.toml
echo "D1 Database ID (dev): $(wrangler d1 list | grep multi_tenant_db_dev)"
echo "KV Namespace ID (dev): $(wrangler kv:namespace list | grep CONFIG_CACHE)"
```

### Config Service URL
```bash
# After deployment, share the worker URL
# Development: https://config-service-dev.<your-subdomain>.workers.dev
# Production: https://config-service-production.<your-subdomain>.workers.dev
```

## Troubleshooting

### Issue: "CLOUDFLARE_API_TOKEN not set"
**Solution:** Run `wrangler login` or set the token:
```bash
export CLOUDFLARE_API_TOKEN="your-token"
```

### Issue: "Database already exists"
**Solution:** List existing databases:
```bash
wrangler d1 list
```
Use existing database ID or delete and recreate.

### Issue: "Migration failed"
**Solution:** Check SQL syntax and run migrations manually:
```bash
wrangler d1 execute <database-name> --command="<SQL-statement>"
```

### Issue: "Worker deployment failed"
**Solution:** Check wrangler.toml syntax:
```bash
cd infrastructure/config-service
wrangler deploy --dry-run
```

## Health Checks

After deployment, verify all services are healthy:

```bash
# Config Service health
curl https://config-service-dev.<subdomain>.workers.dev/health

# Database connectivity
wrangler d1 execute multi_tenant_db_dev --command="SELECT 1"

# KV accessibility
wrangler kv:key list --namespace-id=<your-kv-id>
```

## Next Steps

1. ✅ Complete this setup guide
2. ✅ Deploy Config Service
3. ✅ Share Config Service URL with Team 2
4. ✅ Team 2 updates their Image Gen Worker to use real Config Service
5. ✅ Run integration tests
6. ✅ Deploy to staging
7. ✅ QA testing
8. ✅ Deploy to production

## Resources

- [Cloudflare D1 Documentation](https://developers.cloudflare.com/d1/)
- [Cloudflare KV Documentation](https://developers.cloudflare.com/kv/)
- [Wrangler CLI Documentation](https://developers.cloudflare.com/workers/wrangler/)
- [Workers Documentation](https://developers.cloudflare.com/workers/)

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review Wrangler logs: `~/.config/.wrangler/logs/`
3. Consult the Cloudflare Workers documentation
4. Contact the infrastructure team lead
