# DNS Setup Guide for Distributed Electrons Workers

## Overview

This guide provides step-by-step instructions for setting up custom domains for the remaining Cloudflare Workers that currently use `*.workers.dev` domains.

## Workers Requiring DNS Configuration

| Worker | Current Domain | Target Domain | Priority |
|--------|---------------|---------------|----------|
| Text Gen | text-gen.solamp.workers.dev | text.distributedelectrons.com | High |
| Audio Gen | audio-gen.solamp.workers.dev | audio.distributedelectrons.com | Medium |
| Stock Media | stock-media.solamp.workers.dev | media.distributedelectrons.com | Medium |
| Render Service | render-service.solamp.workers.dev | render.distributedelectrons.com | Medium |

## Prerequisites

- Access to Cloudflare Dashboard (account with `distributedelectrons.com` domain)
- Cloudflare Worker names and zones configured
- Wrangler CLI installed and authenticated

## Step-by-Step Instructions

### 1. Text Generation Worker (text-gen)

#### Via Cloudflare Dashboard

1. **Navigate to Workers**
   - Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
   - Select your account
   - Go to **Workers & Pages** section
   - Click on the `text-gen` worker

2. **Add Custom Domain**
   - Click on **Settings** tab
   - Scroll to **Domains & Routes** section
   - Click **Add Custom Domain**
   - Enter: `text.distributedelectrons.com`
   - Click **Add Custom Domain**

3. **Verify DNS Configuration**
   - Cloudflare will automatically create the necessary DNS records
   - Go to **DNS** section for `distributedelectrons.com`
   - Verify the CNAME record: `text.distributedelectrons.com` → `text-gen.solamp.workers.dev`

#### Via Wrangler CLI

```bash
cd workers/text-gen
wrangler deploy --route "text.distributedelectrons.com/*"
```

Or add to `wrangler.toml`:

```toml
routes = [
  { pattern = "text.distributedelectrons.com/*", custom_domain = true }
]
```

Then deploy:

```bash
wrangler deploy
```

### 2. Audio Generation Worker (audio-gen)

#### Via Cloudflare Dashboard

1. Navigate to **Workers & Pages** → `audio-gen` worker
2. Click **Settings** → **Domains & Routes**
3. Click **Add Custom Domain**
4. Enter: `audio.distributedelectrons.com`
5. Click **Add Custom Domain**

#### Via Wrangler CLI

```bash
cd workers/audio-gen
wrangler deploy --route "audio.distributedelectrons.com/*"
```

Or update `wrangler.toml`:

```toml
routes = [
  { pattern = "audio.distributedelectrons.com/*", custom_domain = true }
]
```

### 3. Stock Media Worker (stock-media)

#### Via Cloudflare Dashboard

1. Navigate to **Workers & Pages** → `stock-media` worker
2. Click **Settings** → **Domains & Routes**
3. Click **Add Custom Domain**
4. Enter: `media.distributedelectrons.com`
5. Click **Add Custom Domain**

#### Via Wrangler CLI

```bash
cd workers/stock-media
wrangler deploy --route "media.distributedelectrons.com/*"
```

Or update `wrangler.toml`:

```toml
routes = [
  { pattern = "media.distributedelectrons.com/*", custom_domain = true }
]
```

### 4. Render Service Worker (render-service)

#### Via Cloudflare Dashboard

1. Navigate to **Workers & Pages** → `render-service` worker
2. Click **Settings** → **Domains & Routes**
3. Click **Add Custom Domain**
4. Enter: `render.distributedelectrons.com`
5. Click **Add Custom Domain**

#### Via Wrangler CLI

```bash
cd workers/render-service
wrangler deploy --route "render.distributedelectrons.com/*"
```

Or update `wrangler.toml`:

```toml
routes = [
  { pattern = "render.distributedelectrons.com/*", custom_domain = true }
]
```

## Verification

After setting up custom domains, verify each endpoint is accessible:

### Test Text Gen Worker
```bash
curl https://text.distributedelectrons.com/health
```

Expected response:
```json
{
  "status": "healthy",
  "service": "text-gen",
  "timestamp": "2025-12-05T..."
}
```

### Test Audio Gen Worker
```bash
curl https://audio.distributedelectrons.com/health
```

Expected response:
```json
{
  "status": "healthy",
  "service": "audio-gen",
  "timestamp": "2025-12-05T..."
}
```

### Test Stock Media Worker
```bash
curl https://media.distributedelectrons.com/health
```

Expected response:
```json
{
  "status": "healthy",
  "service": "stock-media"
}
```

### Test Render Service Worker
```bash
curl https://render.distributedelectrons.com/health
```

Expected response:
```json
{
  "status": "healthy",
  "service": "render"
}
```

## Update Configuration References

After DNS setup is complete, update all references to the old `*.workers.dev` domains:

### 1. Update Testing GUIs

**Text Testing GUI** (`interfaces/text-testing-gui/public/app.js`):
```javascript
// Old
const API_URL = 'https://text-gen.solamp.workers.dev';

// New
const API_URL = 'https://text.distributedelectrons.com';
```

### 2. Update Documentation

Update the following files to reference new domains:
- `PROJECT_OVERVIEW.md` - Update service URLs table
- `README.md` - Update API endpoints section
- `docs/api/README.md` - Update endpoint documentation

### 3. Update Environment Variables

If any workers reference these endpoints in environment variables, update them:

```bash
# Example for updating config service references
wrangler secret put TEXT_GEN_URL --value "https://text.distributedelectrons.com"
wrangler secret put AUDIO_GEN_URL --value "https://audio.distributedelectrons.com"
wrangler secret put MEDIA_API_URL --value "https://media.distributedelectrons.com"
wrangler secret put RENDER_API_URL --value "https://render.distributedelectrons.com"
```

## SSL/TLS Configuration

Cloudflare automatically provisions SSL certificates for custom domains. The default settings are:

- **SSL Mode**: Full (Strict)
- **Always Use HTTPS**: Enabled
- **Minimum TLS Version**: TLS 1.2
- **Automatic HTTPS Rewrites**: Enabled

These settings are inherited from the zone configuration and don't require additional setup.

## Troubleshooting

### Issue: Custom Domain Not Working

**Symptoms**: Domain returns 404 or doesn't resolve

**Solutions**:
1. Verify DNS records are propagated (can take up to 5 minutes)
2. Check that the domain is in the same Cloudflare account as the worker
3. Ensure the worker is deployed and healthy
4. Verify SSL/TLS mode is set to "Full" or "Full (Strict)"

### Issue: Old Domain Still Being Used

**Symptoms**: Applications still hitting `*.workers.dev` domains

**Solutions**:
1. Update all hardcoded URLs in frontend applications
2. Clear browser cache and CDN cache
3. Update environment variables in CI/CD pipelines
4. Check for cached DNS responses (flush DNS cache)

### Issue: CORS Errors

**Symptoms**: Browser console shows CORS policy errors

**Solutions**:
1. Verify CORS headers are set correctly in worker
2. Update allowed origins to include new custom domain
3. Check that OPTIONS preflight requests are handled

## Automation Script

For batch DNS setup, use this script:

```bash
#!/bin/bash
# setup-custom-domains.sh

WORKERS=(
  "text-gen:text.distributedelectrons.com"
  "audio-gen:audio.distributedelectrons.com"
  "stock-media:media.distributedelectrons.com"
  "render-service:render.distributedelectrons.com"
)

for worker_domain in "${WORKERS[@]}"; do
  IFS=':' read -r worker domain <<< "$worker_domain"

  echo "Setting up custom domain for $worker..."
  cd "workers/$worker"

  # Add custom domain to wrangler.toml if not present
  if ! grep -q "custom_domain = true" wrangler.toml; then
    echo "" >> wrangler.toml
    echo "[[routes]]" >> wrangler.toml
    echo "pattern = \"$domain/*\"" >> wrangler.toml
    echo "custom_domain = true" >> wrangler.toml
  fi

  # Deploy with custom domain
  wrangler deploy

  echo "✓ $worker configured with $domain"
  cd ../..
done

echo ""
echo "All custom domains configured!"
echo "Run verification tests to confirm setup."
```

## Next Steps

After completing DNS setup:

1. ✅ Test all endpoints using the verification commands above
2. ✅ Update all application references to use new domains
3. ✅ Update documentation with new URLs
4. ✅ Monitor for any issues in production
5. ✅ Consider deprecating old `*.workers.dev` URLs after migration period

## Related Documentation

- [Custom Domain Setup](../CUSTOM_DOMAIN_SETUP.md) - General custom domain configuration
- [Deployment Guide](../DEPLOYMENT_GUIDE.md) - Worker deployment procedures
- [Cloudflare DNS Documentation](https://developers.cloudflare.com/dns/)
- [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
