# Complete DNS & Custom Domain Setup Guide

## Current Situation

**API Token Issue**: The provided CF API token returns authentication errors when used via curl. This could be due to:
1. Token format or encoding issues
2. Token not yet fully propagated
3. Additional permissions needed

**✅ What's Been Completed**:
- API token securely stored in `config-service` worker as `CF_DNS_API_TOKEN`
- All 4 workers deployed with route configurations
- OpenAI API key added and tested successfully

## Solutions (In Order of Preference)

### Option 1: Cloudflare Dashboard (10 minutes - RECOMMENDED)

This is the most reliable method:

#### A. Worker Custom Domains (4 workers)

1. **Go to Workers Dashboard**
   - https://dash.cloudflare.com/52b1c60ff2a24fb21c1ef9a429e63261/workers-and-pages

2. **For Each Worker** (text-gen, audio-gen, stock-media, render-service):
   - Click on the worker name
   - Go to **Settings** → **Triggers** tab
   - Under **Custom Domains**, click **Add Custom Domain**
   - Enter the domain:
     - text-gen: `text.distributedelectrons.com`
     - audio-gen: `audio.distributedelectrons.com`
     - stock-media: `media.distributedelectrons.com`
     - render-service: `render.distributedelectrons.com`
   - Click **Add Custom Domain**
   - Cloudflare will automatically create DNS records and SSL certificates

#### B. Pages Custom Domains (2 projects)

1. **Go to Pages Dashboard**
   - https://dash.cloudflare.com/52b1c60ff2a24fb21c1ef9a429e63261/pages

2. **For testing-gui**:
   - Click **testing-gui** project
   - Go to **Custom domains** tab
   - Click **Set up a custom domain**
   - Enter: `testing.distributedelectrons.com`
   - Click **Continue** → **Activate domain**

3. **For text-testing-gui**:
   - Click **text-testing-gui** project
   - Go to **Custom domains** tab
   - Click **Set up a custom domain**
   - Enter: `text-testing.distributedelectrons.com`
   - Click **Continue** → **Activate domain**

### Option 2: Using Wrangler CLI (Alternative)

While wrangler doesn't have direct custom domain management, you can update the configuration:

```bash
# The routes are already configured in wrangler.toml files
# Just need DNS records pointing to the workers
```

### Option 3: Updated API Commands (Once Token Issue Resolved)

If the API token issue is resolved, use these commands:

```bash
#!/bin/bash
CF_TOKEN="4wmrkspNSsQZXZfCSdqlKKYjJfHRiQD7-GoSbFmT"
CF_ZONE_ID="417d6062ae2113dc20c4910e9f6f691f"
CF_ACCOUNT_ID="52b1c60ff2a24fb21c1ef9a429e63261"

# Create DNS CNAME records for workers
declare -A WORKERS=(
  ["text"]="text-gen.solamp.workers.dev"
  ["audio"]="audio-gen.solamp.workers.dev"
  ["media"]="stock-media.solamp.workers.dev"
  ["render"]="render-service.solamp.workers.dev"
)

for subdomain in "${!WORKERS[@]}"; do
  target="${WORKERS[$subdomain]}"
  echo "Creating DNS record for ${subdomain}.distributedelectrons.com → ${target}"

  curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
    -H "Authorization: Bearer ${CF_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{
      \"type\": \"CNAME\",
      \"name\": \"${subdomain}\",
      \"content\": \"${target}\",
      \"proxied\": true,
      \"comment\": \"Custom domain for ${subdomain} worker\"
    }"
  echo ""
done

# Add custom domains to Pages projects
for project in "testing-gui" "text-testing-gui"; do
  if [ "$project" = "testing-gui" ]; then
    domain="testing.distributedelectrons.com"
  else
    domain="text-testing.distributedelectrons.com"
  fi

  echo "Adding custom domain ${domain} to ${project}"
  curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${project}/domains" \
    -H "Authorization: Bearer ${CF_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{\"name\": \"${domain}\"}"
  echo ""
done
```

## Verification Commands

After setup (wait 2-5 minutes for DNS propagation):

```bash
# Test all custom domains
echo "=== Workers ==="
curl -s https://text.distributedelectrons.com/health | jq .
curl -s https://audio.distributedelectrons.com/health | jq .
curl -s https://media.distributedelectrons.com/health | jq .
curl -s https://render.distributedelectrons.com/health | jq .

echo "=== Pages Projects ==="
curl -I https://testing.distributedelectrons.com
curl -I https://text-testing.distributedelectrons.com
```

## Troubleshooting the API Token

If you want to debug the API token issue:

1. **Verify Token Permissions** in Dashboard:
   - Go to: https://dash.cloudflare.com/profile/api-tokens
   - Find the token and verify it has:
     - Zone:Read
     - DNS:Edit
     - Workers Scripts:Edit
     - Cloudflare Pages:Edit

2. **Test Token with Simple Request**:
   ```bash
   curl -X GET 'https://api.cloudflare.com/client/v4/user/tokens/verify' \
     -H 'Authorization: Bearer 4wmrkspNSsQZXZfCSdqlKKYjJfHRiQD7-GoSbFmT'
   ```

3. **Check Token Status**:
   - Token might need to be regenerated
   - Verify no IP restrictions
   - Ensure token hasn't expired

## What's Already Working

✅ **4 Working Domains**:
- admin.distributedelectrons.com
- monitoring.distributedelectrons.com
- api.distributedelectrons.com
- images.distributedelectrons.com

✅ **Backend Ready**:
- All 6 workers deployed and healthy
- Routes configured in wrangler.toml
- OpenAI integration working
- 10 models seeded in database

## Final Status After Setup

Once the 6 remaining domains are configured, you'll have:

**10 Live Custom Domains**:
1. admin.distributedelectrons.com (✅ Working)
2. monitoring.distributedelectrons.com (✅ Working)
3. api.distributedelectrons.com (✅ Working)
4. images.distributedelectrons.com (✅ Working)
5. testing.distributedelectrons.com (⏳ Needs setup)
6. text-testing.distributedelectrons.com (⏳ Needs setup)
7. text.distributedelectrons.com (⏳ Needs setup)
8. audio.distributedelectrons.com (⏳ Needs setup)
9. media.distributedelectrons.com (⏳ Needs setup)
10. render.distributedelectrons.com (⏳ Needs setup)

## Recommendation

**Use Option 1 (Dashboard)** - It's the most reliable and fastest:
1. Takes ~10 minutes total
2. No API token issues
3. Cloudflare handles DNS and SSL automatically
4. Visual confirmation of each step

The API token is safely stored for future use once the auth issue is resolved.

---

**Questions or Issues?** The token is stored securely in `config-service` worker as `CF_DNS_API_TOKEN` for future automated DNS management once the authentication is working.
