# DNS API Token Troubleshooting Guide

## Problem Identified

**Root Cause**: The Cloudflare API token provided is invalid and cannot be used for DNS management.

### Error Details

```bash
# Token verification test
curl -X GET 'https://api.cloudflare.com/client/v4/user/tokens/verify' \
  -H 'Authorization: Bearer 4wmrkspNSsQZXZfCSdqlKKYjJfHRiQD7-GoSbFmT' \
  -H 'Content-Type: application/json'

# Response
{
  "success": false,
  "errors": [{"code": 1000, "message": "Invalid API Token"}],
  "messages": [],
  "result": null
}
```

**Error Code 1000**: Invalid API Token - The token string is not recognized as a valid Cloudflare API token.

## Investigation Results

### Tested Solutions

1. **Wrangler CLI DNS Management** ❌
   - Wrangler does not have DNS record management commands
   - Wrangler Pages does not have custom domain commands
   - Must use Cloudflare API or Dashboard

2. **API Token Storage** ✅
   - Token successfully stored in config-service worker as `CF_DNS_API_TOKEN`
   - Accessible for future use once token issue is resolved

3. **API Documentation Review** ✅
   - Confirmed correct API syntax and authentication method
   - Confirmed required permission: "DNS Write"

## Possible Causes

The invalid token error can occur due to:

1. **Token Expired or Revoked**
   - API tokens can have expiration dates
   - Tokens can be manually revoked in the dashboard

2. **Incorrect Token String**
   - Copy-paste error or truncation
   - Extra whitespace or special characters
   - Token might be incomplete

3. **Token Type Mismatch**
   - Attempting to use an API Key instead of API Token
   - Using Global API Key format with Bearer auth

4. **Account Permissions**
   - Token created by user without sufficient permissions
   - Token permissions don't match required scopes

## Solutions (In Order of Likelihood)

### Solution 1: Generate New API Token (RECOMMENDED)

The most reliable solution is to create a fresh API token:

#### Step 1: Create Token via Dashboard

1. Go to: https://dash.cloudflare.com/profile/api-tokens
2. Click **Create Token**
3. Click **Create Custom Token**
4. Configure:
   - **Token name**: `distributed-electrons-dns`
   - **Permissions**:
     - Account → Workers Scripts → Edit
     - Account → Account Settings → Read
     - Zone → DNS → Edit
     - Zone → Zone → Read
   - **Zone Resources**:
     - Include → Specific zone → `distributedelectrons.com`
   - **IP Filtering**: (Optional) Add your deployment IP if known
   - **TTL**: Set expiration or leave blank for no expiration
5. Click **Continue to summary**
6. Click **Create Token**
7. **COPY THE TOKEN IMMEDIATELY** (shown only once)

#### Step 2: Test New Token

```bash
# Replace <NEW_TOKEN> with the token you just created
export CF_TOKEN="<NEW_TOKEN>"

# Test token verification
curl -X GET 'https://api.cloudflare.com/client/v4/user/tokens/verify' \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H 'Content-Type: application/json'

# Expected success response:
# {
#   "success": true,
#   "errors": [],
#   "messages": [],
#   "result": {
#     "id": "f267e341f3dd4697bd3b9f71dd96247f",
#     "status": "active",
#     "not_before": "2024-12-05T00:00:00Z",
#     "expires_on": null
#   }
# }
```

#### Step 3: Store New Token in Cloudflare Secrets

```bash
# Store in config-service worker
cd infrastructure/config-service
echo "${CF_TOKEN}" | npx wrangler secret put CF_DNS_API_TOKEN

# Verify stored
npx wrangler secret list
```

#### Step 4: Create DNS Records

Once token is verified, create the DNS records:

```bash
export CF_TOKEN="<your-verified-token>"
export CF_ZONE_ID="417d6062ae2113dc20c4910e9f6f691f"
export CF_ACCOUNT_ID="52b1c60ff2a24fb21c1ef9a429e63261"

# Test with a single DNS record first
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "CNAME",
    "name": "text",
    "content": "text-gen.solamp.workers.dev",
    "proxied": true,
    "comment": "Custom domain for text-gen worker"
  }'

# If successful, create the rest:
for subdomain in audio media render; do
  case $subdomain in
    audio) target="audio-gen.solamp.workers.dev" ;;
    media) target="stock-media.solamp.workers.dev" ;;
    render) target="render-service.solamp.workers.dev" ;;
  esac

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
```

#### Step 5: Add Custom Domains to Pages Projects

```bash
# Testing GUI
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/testing-gui/domains" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"name": "testing.distributedelectrons.com"}'

# Text Testing GUI
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/text-testing-gui/domains" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"name": "text-testing.distributedelectrons.com"}'
```

#### Step 6: Verify All Domains

Wait 2-5 minutes for DNS propagation, then test:

```bash
# Test workers
echo "=== Worker Endpoints ==="
curl -s https://text.distributedelectrons.com/health | jq .
curl -s https://audio.distributedelectrons.com/health | jq .
curl -s https://media.distributedelectrons.com/health | jq .
curl -s https://render.distributedelectrons.com/health | jq .

# Test Pages projects
echo "=== Pages Endpoints ==="
curl -I https://testing.distributedelectrons.com
curl -I https://text-testing.distributedelectrons.com
```

All should return HTTP 200 or valid JSON responses.

---

### Solution 2: Verify Existing Token (Alternative)

If you believe the token should be valid:

1. **Check token in dashboard**:
   - Go to: https://dash.cloudflare.com/profile/api-tokens
   - Find the token in the list
   - Verify status is "Active"
   - Check expiration date

2. **Regenerate token**:
   - Click on the token name
   - Click "Roll" to generate a new token value
   - Copy the new value immediately

3. **Test and store** as shown in Solution 1 Steps 2-3

---

## Why This Matters for Future Work

The user explicitly stated:

> "we do not want to use the dashboard method - we need to make sure that when working on this app, or any future apps, that claude code can set up the DNS"

Having a working API token enables:

1. **Automated Deployments**: CI/CD can manage DNS programmatically
2. **Reproducible Setup**: Scripts can configure new environments
3. **Infrastructure as Code**: DNS configuration tracked in version control
4. **Future Projects**: Same approach works for other Cloudflare projects

## Testing Checklist

After implementing Solution 1:

- [ ] New API token created with correct permissions
- [ ] Token verification returns `"status": "active"`
- [ ] Token stored in CF_DNS_API_TOKEN secret
- [ ] Test DNS record created successfully via API
- [ ] All 4 worker DNS records created
- [ ] Both Pages custom domains added
- [ ] All 6 new domains resolve correctly
- [ ] All health checks return 200
- [ ] Documentation updated with working commands

## Reference Information

**Account Details**:
- Account ID: `52b1c60ff2a24fb21c1ef9a429e63261`
- Zone ID: `417d6062ae2113dc20c4910e9f6f691f`
- Domain: `distributedelectrons.com`

**Domains to Configure**:
1. text.distributedelectrons.com → text-gen.solamp.workers.dev
2. audio.distributedelectrons.com → audio-gen.solamp.workers.dev
3. media.distributedelectrons.com → stock-media.solamp.workers.dev
4. render.distributedelectrons.com → render-service.solamp.workers.dev
5. testing.distributedelectrons.com → testing-gui Pages project
6. text-testing.distributedelectrons.com → text-testing-gui Pages project

**API Documentation**:
- Token Verification: https://developers.cloudflare.com/fundamentals/api/troubleshooting/
- DNS Records: https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/
- Pages Domains: https://developers.cloudflare.com/pages/configuration/custom-domains/

---

**Status**: Awaiting new valid API token to proceed with automated DNS setup.
