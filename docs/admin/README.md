# Admin Guide

Complete guide for system administrators to manage users, monitor systems, and maintain the Cloudflare Multi-Agent System.

## Admin Panel Access

The Admin Panel provides a web interface for managing the system.

**URL**: `https://admin-panel.pages.dev`

### Login

Use your admin API key to log in.

## Managing Instances

### View All Instances

1. Navigate to **Instances** page
2. View list of all instances with:
   - Instance ID
   - Name
   - Status (active/inactive)
   - Rate limits
   - Created date

### Create New Instance

1. Click **Create Instance** button
2. Fill in details:
   - **Instance ID**: Unique identifier (e.g., `production`, `client-xyz`)
   - **Name**: Human-readable name
   - **Organization ID**: Parent organization
   - **R2 Bucket**: Storage bucket name
   - **Rate Limits**: Requests per minute
3. Click **Create**

### Edit Instance

1. Find instance in list
2. Click **Edit**
3. Modify configuration:
   - Rate limits
   - API keys (encrypted)
   - Authorized users
4. Click **Save**

### Delete Instance

1. Find instance in list
2. Click **Delete**
3. Confirm deletion (irreversible!)

**Warning**: Deleting an instance removes all configuration but does not delete R2 storage or database records.

## Managing Users

### View All Users

1. Navigate to **Users** page
2. View user list with:
   - Email
   - Role (user/admin)
   - Instance access
   - Created date

### Create New User

1. Click **Create User** button
2. Fill in details:
   - **Email**: User's email address
   - **Role**: `user` or `admin`
   - **Organization**: Parent organization
   - **Instances**: Comma-separated list (e.g., `production, development`)
3. Click **Create**

API key will be generated automatically and displayed once. **Save it immediately!**

### Assign Instance Access

1. Find user in list
2. Click **Edit**
3. Add/remove instances from access list
4. Click **Save**

## API Key Management

### Generate API Key

1. Navigate to **Users** page, scroll to API Keys section
2. Click **Generate API Key**
3. Fill in details:
   - **Key Name**: Descriptive name (e.g., "Production API Key")
   - **User**: Select user
   - **Instance**: Select instance
   - **Expires In**: Days until expiration (or leave blank for no expiration)
4. Click **Generate**
5. **Copy and save the API key** - it won't be shown again!

### Revoke API Key

1. Find API key in list
2. Click **Revoke**
3. Confirm revocation

Revoked keys are immediately invalid and cannot be restored.

### API Key Best Practices

- **Rotate regularly**: Generate new keys every 90 days
- **Use descriptive names**: Helps identify usage later
- **Monitor usage**: Check "Last Used" timestamps
- **Revoke unused keys**: Clean up old/unused keys
- **Never share keys**: Each user should have their own

## Monitoring Logs

### View System Logs

1. Navigate to **Logs** page
2. Use filters:
   - **Instance**: Filter by specific instance
   - **Level**: error, warn, info, debug
   - **Search**: Search log messages

### Log Levels

- **Error**: Critical issues requiring immediate attention
- **Warn**: Potential problems or approaching limits
- **Info**: Normal operational messages
- **Debug**: Detailed diagnostic information

### Common Log Messages

| Message | Level | Action |
|---------|-------|--------|
| Rate limit exceeded | warn | Increase rate limits or review usage |
| Provider API timeout | error | Check provider status |
| Instance config updated | info | No action needed |
| Image generation successful | info | No action needed |
| Unauthorized access attempt | warn | Review access logs |

### Export Logs

Currently logs are view-only. For programmatic access, use the Logs API:

```bash
curl -X GET "https://config-service.workers.dev/api/logs?instance_id=production&level=error" \
  -H "Authorization: Bearer ADMIN_API_KEY"
```

## Monitoring System Health

### Health Checks

Verify system components are operational:

**Config Service**:
```bash
curl https://config-service.workers.dev/health
```

**Image Gen Worker**:
```bash
curl https://image-gen-production.workers.dev/health
```

Expected response:
```json
{
  "status": "healthy",
  "database": "connected",
  "timestamp": "2025-11-20T12:00:00Z"
}
```

### Cloudflare Analytics

Access detailed analytics via Cloudflare Dashboard:

1. Log in to Cloudflare
2. Navigate to **Workers & Pages**
3. Select worker
4. View **Analytics** tab

Metrics available:
- Requests per second
- Error rate
- CPU time
- Duration (p50, p95, p99)

### Rate Limit Monitoring

Monitor rate limit usage:

1. Check logs for "Rate limit" warnings
2. Review Durable Object analytics
3. Use Monitoring Dashboard (Agent 4.4) for real-time view

## Scaling

### Increase Rate Limits

When nearing capacity:

1. Go to **Instances** page
2. Find instance
3. Click **Edit**
4. Increase **Rate Limit (RPM)**
5. Click **Save**

Changes take effect immediately.

### Add More Instances

For new clients or environments:

1. Click **Create Instance**
2. Configure with appropriate limits
3. Generate API keys for new instance
4. Provide keys to users

### Scale Workers

Cloudflare Workers scale automatically, but you can:

- Monitor usage in Analytics
- Upgrade Cloudflare plan if hitting limits
- Configure Durable Objects alarm thresholds

## Troubleshooting

### Users Can't Authenticate

**Symptoms**: 401 Unauthorized errors

**Solutions**:
1. Verify API key is correct
2. Check key hasn't expired (Users page → API Keys)
3. Verify key hasn't been revoked
4. Check user has access to the instance

### Rate Limit Exceeded

**Symptoms**: 429 Too Many Requests errors

**Solutions**:
1. Review rate limit configuration (Instances page)
2. Check if legitimate traffic spike
3. Increase limits if needed
4. Investigate potential abuse

### Image Generation Failures

**Symptoms**: 502 Bad Gateway or timeout errors

**Solutions**:
1. Check provider API status (e.g., Ideogram status page)
2. Verify provider API key is valid (Instances → Edit)
3. Review error logs for details
4. Test with simple prompt

### Database Connection Issues

**Symptoms**: 500 errors, "database connection failed"

**Solutions**:
1. Verify D1 database exists: `wrangler d1 list`
2. Check worker bindings in `wrangler.toml`
3. Review worker logs: `wrangler tail`
4. Verify migrations ran successfully

### R2 Storage Issues

**Symptoms**: Images not uploading, 404 on CDN URLs

**Solutions**:
1. Verify R2 bucket exists: `wrangler r2 bucket list`
2. Check bucket name in instance config
3. Verify worker has R2 binding
4. Check bucket CORS settings (if accessing from browser)

## Security Best Practices

### API Key Security

- ✅ Store API keys encrypted in D1
- ✅ Never log API keys
- ✅ Rotate keys regularly
- ✅ Use minimum necessary permissions
- ❌ Never commit keys to git
- ❌ Never share keys via email/chat

### Access Control

- Assign users only to instances they need
- Use `user` role by default, `admin` only when necessary
- Review user access quarterly
- Remove access for departed users immediately

### Monitoring

- Review error logs daily
- Set up alerts for error spikes
- Monitor for unusual access patterns
- Track API key usage

### Incident Response

1. **Identify**: Monitor alerts and logs
2. **Contain**: Revoke compromised keys immediately
3. **Investigate**: Review logs for scope
4. **Recover**: Rotate all affected keys
5. **Document**: Record incident and response

## Maintenance

### Regular Tasks

**Daily**:
- Review error logs
- Check system health endpoints

**Weekly**:
- Review rate limit usage
- Monitor provider costs
- Check for unused API keys

**Monthly**:
- Review user access list
- Audit API key usage
- Update documentation

**Quarterly**:
- Rotate all API keys
- Review instance configurations
- Performance optimization review

### Updates

Monitor for updates:

```bash
# Check for updates
npm outdated

# Update dependencies
npm update

# Deploy updated workers
npm run deploy-all
```

### Backups

**Database**: D1 automatically backs up. To export:

```bash
wrangler d1 export multi-agent-db-prod --output backup.sql
```

**Configuration**: Export instance configs regularly:

```bash
curl -X GET "https://config-service.workers.dev/api/instances" \
  -H "Authorization: Bearer ADMIN_API_KEY" \
  > instances-backup.json
```

## Support

### Getting Help

1. **Documentation**: Search these docs first
2. **Logs**: Check worker logs for error details
3. **GitHub Issues**: File issue with:
   - Description
   - Steps to reproduce
   - Log snippets (remove sensitive data!)
   - Expected vs actual behavior

### Escalation

For critical issues:

1. Check Cloudflare Status: https://www.cloudflarestatus.com/
2. Review provider status pages
3. Contact Cloudflare support (for infrastructure issues)
4. Contact provider support (for API issues)

---

**Next Steps**: [API Reference](../api/README.md) | [Monitoring Dashboard](../monitoring/README.md)
