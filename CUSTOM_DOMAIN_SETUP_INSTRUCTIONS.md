# Custom Domain Setup Instructions

## Current Status

### ✅ What's Working
- **admin.distributedelectrons.com** - Admin Panel (✅ Live)
- **monitoring.distributedelectrons.com** - Monitoring Dashboard (✅ Live)
- **api.distributedelectrons.com** - Config Service (✅ Live)
- **images.distributedelectrons.com** - Image Gen Worker (✅ Live)

### ⏳ What Needs Setup

**Pages Projects** (2 sites):
1. testing.distributedelectrons.com
2. text-testing.distributedelectrons.com

**Workers** (4 services):
3. text.distributedelectrons.com
4. audio.distributedelectrons.com
5. media.distributedelectrons.com
6. render.distributedelectrons.com

---

## Option 1: Cloudflare Dashboard (Recommended - 10 minutes)

### A. Pages Custom Domains

1. **Go to Cloudflare Dashboard**
   - Navigate to: https://dash.cloudflare.com
   - Select your account → **Pages**

2. **Configure testing-gui**
   - Click on **testing-gui** project
   - Go to **Custom domains** tab
   - Click **Set up a custom domain**
   - Enter: `testing.distributedelectrons.com`
   - Click **Continue** → **Activate domain**
   - Cloudflare will automatically create DNS records

3. **Configure text-testing-gui**
   - Click on **text-testing-gui** project
   - Go to **Custom domains** tab
   - Click **Set up a custom domain**
   - Enter: `text-testing.distributedelectrons.com`
   - Click **Continue** → **Activate domain**

### B. Worker Custom Domains (Already Deployed!)

The workers are deployed with routes, but need DNS records:

1. **Go to DNS Settings**
   - Dashboard → Websites → **distributedelectrons.com** → **DNS** → **Records**

2. **Add CNAME Records** (one for each worker):

   | Type | Name | Target | Proxy |
   |------|------|--------|-------|
   | CNAME | text | text-gen.solamp.workers.dev | ✅ Proxied |
   | CNAME | audio | audio-gen.solamp.workers.dev | ✅ Proxied |
   | CNAME | media | stock-media.solamp.workers.dev | ✅ Proxied |
   | CNAME | render | render-service.solamp.workers.dev | ✅ Proxied |

   **Important**: Make sure "Proxy status" is set to "Proxied" (orange cloud)

---

## Option 2: Using Cloudflare API (Advanced)

If you prefer automation, here are the API calls:

### Prerequisites
```bash
export CF_API_TOKEN="your-cloudflare-api-token"
export CF_ACCOUNT_ID="52b1c60ff2a24fb21c1ef9a429e63261"
export CF_ZONE_ID="417d6062ae2113dc20c4910e9f6f691f"
```

### Add DNS Records for Workers

```bash
# Text Gen Worker
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "CNAME",
    "name": "text",
    "content": "text-gen.solamp.workers.dev",
    "proxied": true
  }'

# Audio Gen Worker
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "CNAME",
    "name": "audio",
    "content": "audio-gen.solamp.workers.dev",
    "proxied": true
  }'

# Stock Media Worker
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "CNAME",
    "name": "media",
    "content": "stock-media.solamp.workers.dev",
    "proxied": true
  }'

# Render Service Worker
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "CNAME",
    "name": "render",
    "content": "render-service.solamp.workers.dev",
    "proxied": true
  }'
```

### Add Custom Domains to Pages Projects

```bash
# Testing GUI
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/testing-gui/domains" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"name": "testing.distributedelectrons.com"}'

# Text Testing GUI
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/text-testing-gui/domains" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"name": "text-testing.distributedelectrons.com"}'
```

---

## Verification

After setup, wait 2-5 minutes for DNS propagation, then test:

```bash
# Pages Projects
curl -I https://testing.distributedelectrons.com
curl -I https://text-testing.distributedelectrons.com

# Workers
curl https://text.distributedelectrons.com/health
curl https://audio.distributedelectrons.com/health
curl https://media.distributedelectrons.com/health
curl https://render.distributedelectrons.com/health
```

All should return HTTP 200 or valid JSON responses.

---

## Troubleshooting

### Issue: 522 Error (Connection Timeout)
**Cause**: DNS not configured or not pointing to correct target
**Solution**: Verify CNAME records exist and are proxied

### Issue: 404 Not Found
**Cause**: Worker deployed but route not matching
**Solution**: Check that DNS record matches the route pattern in wrangler.toml

### Issue: SSL/TLS Errors
**Cause**: SSL mode mismatch
**Solution**:
1. Go to SSL/TLS settings in Cloudflare
2. Set to "Full" or "Full (Strict)"
3. Ensure "Always Use HTTPS" is enabled

### Issue: Pages Domain Shows "Not Found"
**Cause**: Custom domain not added to Pages project
**Solution**: Add custom domain through Dashboard or API as shown above

---

## What's Been Done Already

✅ **OpenAI API Key** - Added to text-gen worker secrets
✅ **Workers Deployed** - All 4 workers deployed with routes configured
✅ **wrangler.toml Updated** - Route patterns already configured
✅ **Pages Projects** - Already deployed and live on *.pages.dev domains

## What You Need to Do

Only the DNS/domain configuration step remains - everything else is ready!

1. **Option 1**: Use Cloudflare Dashboard (10 minutes, recommended)
2. **Option 2**: Run the API commands above (5 minutes, requires API token)

---

## Summary of All URLs

After setup is complete, you'll have:

### Frontends (Pages)
- https://admin.distributedelectrons.com (✅ Already working)
- https://monitoring.distributedelectrons.com (✅ Already working)
- https://testing.distributedelectrons.com (⏳ Needs custom domain)
- https://text-testing.distributedelectrons.com (⏳ Needs custom domain)

### Backend Workers
- https://api.distributedelectrons.com (✅ Already working)
- https://images.distributedelectrons.com (✅ Already working)
- https://text.distributedelectrons.com (⏳ Needs DNS)
- https://audio.distributedelectrons.com (⏳ Needs DNS)
- https://media.distributedelectrons.com (⏳ Needs DNS)
- https://render.distributedelectrons.com (⏳ Needs DNS)

---

**Questions?** All the backend code is deployed and ready - only DNS configuration remains!
