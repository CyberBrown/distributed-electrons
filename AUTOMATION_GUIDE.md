# Service Automation Guide

Automated tools for managing custom domains and services in the Cloudflare Multi-Agent System.

## Quick Start

### 1. Set Up API Token

```bash
# Copy example env file
cp .env.example .env

# Edit .env and add your Cloudflare API token
nano .env

# Or export directly
export CLOUDFLARE_API_TOKEN='your-token-here'
```

### 2. Add a New Service

The `add-service.sh` script automates:
- DNS record creation
- Custom domain configuration
- Pages/Worker setup instructions

```bash
# For a Cloudflare Worker
./add-service.sh worker api my-api-worker

# For a Cloudflare Pages project
./add-service.sh pages dashboard my-dashboard

# For a simple CNAME
./add-service.sh cname cdn cdn.example.com
```

## Examples

### Adding a New Worker API

```bash
# 1. Add DNS and setup
./add-service.sh worker analytics analytics-worker

# 2. Update your wrangler.toml
# routes = [
#   { pattern = "analytics.distributedelectrons.com/*", zone_name = "distributedelectrons.com" }
# ]

# 3. Deploy
cd workers/analytics
npx wrangler deploy
```

### Adding a New Pages Site

```bash
# 1. Add DNS and custom domain
./add-service.sh pages docs documentation-site

# 2. Build and deploy
cd interfaces/docs
npm run build
npx wrangler pages deploy dist --project-name=documentation-site
```

## Script Reference

### `add-service.sh`

**Syntax:**
```bash
./add-service.sh <service-type> <subdomain> <project-name>
```

**Parameters:**
- `service-type`: `worker`, `pages`, or `cname`
- `subdomain`: The subdomain name (e.g., `api`, `dashboard`)
- `project-name`: Worker/Pages project name or CNAME target

**What it does:**
1. ✅ Creates DNS CNAME record automatically
2. ✅ Adds custom domain to Pages project (if applicable)
3. ✅ Provides next steps for deployment
4. ✅ Handles errors and duplicate checks gracefully

### `setup-custom-domains.sh`

Initial setup script for bulk domain configuration. Use this once to set up all existing services.

**Usage:**
```bash
export CLOUDFLARE_API_TOKEN='your-token-here'
./setup-custom-domains.sh
```

## Current Services

| Subdomain | Type | Project | URL |
|-----------|------|---------|-----|
| monitoring | Pages | monitoring-dashboard | https://monitoring.distributedelectrons.com |
| admin | Pages | admin-panel | https://admin.distributedelectrons.com |
| testing | Pages | testing-gui | https://testing.distributedelectrons.com |
| api | Worker | config-service | https://api.distributedelectrons.com |
| images | Worker | image-gen | https://images.distributedelectrons.com |

## API Token Permissions

Your Cloudflare API token needs these permissions:

```
Zone Permissions:
  - DNS: Edit
  - Zone: Read

Account Permissions:
  - Cloudflare Pages: Edit
  - Workers Scripts: Edit
```

**Create token at:** https://dash.cloudflare.com/profile/api-tokens

## Troubleshooting

### DNS Not Resolving
```bash
# Check if DNS record was created
dig subdomain.distributedelectrons.com

# Typical propagation time: 1-5 minutes
```

### 522 Error (Connection Timeout)
- Custom domain is initializing on Pages (takes 1-5 minutes)
- SSL certificate is being provisioned
- Check Cloudflare dashboard: Pages → Project → Custom domains

### Authentication Error
```bash
# Verify your API token
curl -X GET "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq
```

### Pages Custom Domain Not Adding
- Ensure the Pages project exists first
- Deploy to the project at least once
- Check project name matches exactly

## Best Practices

1. **Always use the automation script** for new services instead of manual DNS
2. **Test in development** before adding production subdomains
3. **Document new services** in this guide after adding them
4. **Use descriptive subdomain names** (e.g., `api`, `cdn`, `docs`)
5. **Keep API tokens secure** - never commit .env files

## Adding to CI/CD

```yaml
# Example GitHub Action
- name: Add custom domain
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
  run: |
    ./add-service.sh pages my-app my-app-pages
```

## Support

- Cloudflare API Docs: https://developers.cloudflare.com/api/
- Pages Custom Domains: https://developers.cloudflare.com/pages/platform/custom-domains/
- Workers Routes: https://developers.cloudflare.com/workers/platform/routes/
