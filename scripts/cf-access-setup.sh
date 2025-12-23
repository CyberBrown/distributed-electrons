#!/bin/bash
# cf-access-setup.sh
# Sets up Cloudflare Access to protect the Claude Runner tunnel
#
# This creates:
# 1. An Access Application for claude-runner.shiftaltcreate.com
# 2. A Service Token for sandbox-executor to use
# 3. An Access Policy requiring the service token
#
# Usage:
#   scripts/cf-access-setup.sh
#
# Prerequisites:
#   - CLOUDFLARE_API_TOKEN with Access permissions
#   - CLOUDFLARE_ACCOUNT_ID or uses default

set -e

# Configuration
DOMAIN="${RUNNER_DOMAIN:-claude-runner.shiftaltcreate.com}"
APP_NAME="${ACCESS_APP_NAME:-Claude Runner}"
CF_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-52b1c60ff2a24fb21c1ef9a429e63261}"
CF_API_TOKEN="${CLOUDFLARE_API_TOKEN:-}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

print_status() { echo -e "${GREEN}[OK]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }
print_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
print_info() { echo -e "${CYAN}[INFO]${NC} $1"; }

# Check for API token
if [ -z "$CF_API_TOKEN" ]; then
    # Try to fetch from config service
    if [ -n "$DE_API_KEY" ]; then
        print_info "Fetching Cloudflare token from Config Service..."
        CF_API_TOKEN=$(curl -s -H "Authorization: Bearer $DE_API_KEY" \
            "https://api.distributedelectrons.com/dev-credentials/cloudflare_api_token" | \
            grep -o '"value":"[^"]*"' | cut -d'"' -f4)
    fi
fi

if [ -z "$CF_API_TOKEN" ]; then
    print_error "No Cloudflare API token found"
    echo "Set CLOUDFLARE_API_TOKEN or run: source scripts/cf-auth-setup.sh"
    exit 1
fi

print_status "Using Cloudflare Account: $CF_ACCOUNT_ID"
print_status "Protecting domain: $DOMAIN"

# API base URL
API_BASE="https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}"

# Function to make CF API requests
cf_api() {
    local method=$1
    local endpoint=$2
    local data=$3

    if [ -n "$data" ]; then
        curl -s -X "$method" "${API_BASE}${endpoint}" \
            -H "Authorization: Bearer $CF_API_TOKEN" \
            -H "Content-Type: application/json" \
            -d "$data"
    else
        curl -s -X "$method" "${API_BASE}${endpoint}" \
            -H "Authorization: Bearer $CF_API_TOKEN"
    fi
}

# Check if Access Application already exists
print_info "Checking for existing Access Application..."
EXISTING_APPS=$(cf_api GET "/access/apps")
EXISTING_APP_ID=$(echo "$EXISTING_APPS" | jq -r ".result[] | select(.domain == \"$DOMAIN\") | .id" 2>/dev/null)

if [ -n "$EXISTING_APP_ID" ] && [ "$EXISTING_APP_ID" != "null" ]; then
    print_warning "Access Application already exists: $EXISTING_APP_ID"
    APP_ID="$EXISTING_APP_ID"
else
    # Create Access Application
    print_info "Creating Access Application..."

    APP_RESPONSE=$(cf_api POST "/access/apps" "{
        \"name\": \"$APP_NAME\",
        \"domain\": \"$DOMAIN\",
        \"type\": \"self_hosted\",
        \"session_duration\": \"24h\",
        \"auto_redirect_to_identity\": false,
        \"skip_interstitial\": true,
        \"http_only_cookie_attribute\": true
    }")

    APP_ID=$(echo "$APP_RESPONSE" | jq -r '.result.id')

    if [ -z "$APP_ID" ] || [ "$APP_ID" = "null" ]; then
        print_error "Failed to create Access Application"
        echo "$APP_RESPONSE" | jq .
        exit 1
    fi

    print_status "Created Access Application: $APP_ID"
fi

# Check for existing service token
print_info "Checking for existing Service Token..."
EXISTING_TOKENS=$(cf_api GET "/access/service_tokens")
EXISTING_TOKEN_ID=$(echo "$EXISTING_TOKENS" | jq -r ".result[] | select(.name == \"sandbox-executor\") | .id" 2>/dev/null)

if [ -n "$EXISTING_TOKEN_ID" ] && [ "$EXISTING_TOKEN_ID" != "null" ]; then
    print_warning "Service Token 'sandbox-executor' already exists: $EXISTING_TOKEN_ID"
    print_warning "To regenerate, delete it first in the Cloudflare dashboard"
    SERVICE_TOKEN_ID="$EXISTING_TOKEN_ID"
    CLIENT_ID=""
    CLIENT_SECRET="(already created - stored in wrangler secrets)"
else
    # Create Service Token
    print_info "Creating Service Token for sandbox-executor..."

    TOKEN_RESPONSE=$(cf_api POST "/access/service_tokens" "{
        \"name\": \"sandbox-executor\",
        \"duration\": \"8760h\"
    }")

    SERVICE_TOKEN_ID=$(echo "$TOKEN_RESPONSE" | jq -r '.result.id')
    CLIENT_ID=$(echo "$TOKEN_RESPONSE" | jq -r '.result.client_id')
    CLIENT_SECRET=$(echo "$TOKEN_RESPONSE" | jq -r '.result.client_secret')

    if [ -z "$SERVICE_TOKEN_ID" ] || [ "$SERVICE_TOKEN_ID" = "null" ]; then
        print_error "Failed to create Service Token"
        echo "$TOKEN_RESPONSE" | jq .
        exit 1
    fi

    print_status "Created Service Token: $SERVICE_TOKEN_ID"
fi

# Create Access Policy
print_info "Creating Access Policy..."

POLICY_RESPONSE=$(cf_api POST "/access/apps/${APP_ID}/policies" "{
    \"name\": \"Sandbox Executor Service Auth\",
    \"decision\": \"non_identity\",
    \"include\": [
        {
            \"service_token\": {
                \"token_id\": \"$SERVICE_TOKEN_ID\"
            }
        }
    ],
    \"precedence\": 1
}")

POLICY_ID=$(echo "$POLICY_RESPONSE" | jq -r '.result.id')

if [ -z "$POLICY_ID" ] || [ "$POLICY_ID" = "null" ]; then
    # Check if policy already exists
    if echo "$POLICY_RESPONSE" | grep -q "already exists"; then
        print_warning "Policy already exists"
    else
        print_error "Failed to create Access Policy"
        echo "$POLICY_RESPONSE" | jq .
        exit 1
    fi
else
    print_status "Created Access Policy: $POLICY_ID"
fi

# Output results
echo ""
echo "=============================================="
echo -e "${GREEN}Cloudflare Access Setup Complete${NC}"
echo "=============================================="
echo ""
echo "Domain: $DOMAIN"
echo "App ID: $APP_ID"
echo "Service Token ID: $SERVICE_TOKEN_ID"
echo ""

if [ -n "$CLIENT_ID" ] && [ -n "$CLIENT_SECRET" ] && [ "$CLIENT_SECRET" != "(already created - stored in wrangler secrets)" ]; then
    echo -e "${YELLOW}IMPORTANT: Save these credentials now!${NC}"
    echo "They will not be shown again."
    echo ""
    echo "CF-Access-Client-Id: $CLIENT_ID"
    echo "CF-Access-Client-Secret: $CLIENT_SECRET"
    echo ""
    echo "Add to sandbox-executor secrets:"
    echo "  npx wrangler secret put CF_ACCESS_CLIENT_ID --env production"
    echo "  npx wrangler secret put CF_ACCESS_CLIENT_SECRET --env production"
    echo ""

    # Optionally store in config service
    if [ -n "$DE_API_KEY" ]; then
        read -p "Store credentials in Config Service? (y/n): " STORE_CREDS
        if [ "$STORE_CREDS" = "y" ]; then
            curl -s -X POST "https://api.distributedelectrons.com/dev-credentials" \
                -H "Authorization: Bearer $DE_API_KEY" \
                -H "Content-Type: application/json" \
                -d "{\"credential_type\": \"cf_access_client_id\", \"value\": \"$CLIENT_ID\"}" > /dev/null

            curl -s -X POST "https://api.distributedelectrons.com/dev-credentials" \
                -H "Authorization: Bearer $DE_API_KEY" \
                -H "Content-Type: application/json" \
                -d "{\"credential_type\": \"cf_access_client_secret\", \"value\": \"$CLIENT_SECRET\"}" > /dev/null

            print_status "Credentials stored in Config Service"
        fi
    fi
fi

echo ""
echo "Next steps:"
echo "1. Update sandbox-executor to send CF-Access headers"
echo "2. Test access: curl -H 'CF-Access-Client-Id: ...' -H 'CF-Access-Client-Secret: ...' https://$DOMAIN/health"
echo ""
