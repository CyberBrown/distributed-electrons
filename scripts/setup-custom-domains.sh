#!/bin/bash
#
# DNS Custom Domain Setup Automation Script
#
# This script automates the process of configuring custom domains
# for Cloudflare Workers that currently use *.workers.dev domains.
#
# Requirements:
# - wrangler CLI installed and authenticated
# - Access to the Cloudflare account with the domain
# - Workers already deployed
#
# Usage:
#   ./scripts/setup-custom-domains.sh
#

set -e  # Exit on error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Domain and worker configuration
DOMAIN="distributedelectrons.com"

# Define workers and their target custom domains
declare -A WORKERS=(
  ["text-gen"]="text.${DOMAIN}"
  ["audio-gen"]="audio.${DOMAIN}"
  ["stock-media"]="media.${DOMAIN}"
  ["render-service"]="render.${DOMAIN}"
)

# Functions
print_header() {
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}  $1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_success() {
  echo -e "${GREEN}✓${NC} $1"
}

print_error() {
  echo -e "${RED}✗${NC} $1"
}

print_warning() {
  echo -e "${YELLOW}⚠${NC} $1"
}

print_info() {
  echo -e "${BLUE}ℹ${NC} $1"
}

# Check prerequisites
check_prerequisites() {
  print_header "Checking Prerequisites"

  # Check if wrangler is installed
  if ! command -v wrangler &> /dev/null; then
    print_error "wrangler CLI is not installed"
    echo "Please install it with: npm install -g wrangler"
    exit 1
  fi
  print_success "wrangler CLI is installed"

  # Check if wrangler is authenticated
  if ! wrangler whoami &> /dev/null; then
    print_error "wrangler is not authenticated"
    echo "Please login with: wrangler login"
    exit 1
  fi
  print_success "wrangler is authenticated"

  echo ""
}

# Update wrangler.toml with custom domain route
update_wrangler_config() {
  local worker_dir=$1
  local domain=$2
  local wrangler_file="${worker_dir}/wrangler.toml"

  if [ ! -f "$wrangler_file" ]; then
    print_error "wrangler.toml not found in $worker_dir"
    return 1
  fi

  # Check if routes section already exists
  if grep -q "^\[\[routes\]\]" "$wrangler_file" || grep -q "^routes =" "$wrangler_file"; then
    print_warning "Routes already configured in $wrangler_file (skipping update)"
    return 0
  fi

  # Add custom domain route
  echo "" >> "$wrangler_file"
  echo "# Custom domain configuration" >> "$wrangler_file"
  echo "[[routes]]" >> "$wrangler_file"
  echo "pattern = \"${domain}/*\"" >> "$wrangler_file"
  echo "custom_domain = true" >> "$wrangler_file"

  print_success "Updated $wrangler_file with custom domain route"
  return 0
}

# Deploy worker with custom domain
deploy_worker() {
  local worker_name=$1
  local domain=$2
  local worker_dir="workers/${worker_name}"

  print_info "Configuring ${worker_name} with domain ${domain}"

  # Check if worker directory exists
  if [ ! -d "$worker_dir" ]; then
    print_error "Worker directory not found: $worker_dir"
    return 1
  fi

  # Update wrangler.toml
  if ! update_wrangler_config "$worker_dir" "$domain"; then
    return 1
  fi

  # Deploy the worker
  print_info "Deploying ${worker_name}..."
  if cd "$worker_dir" && wrangler deploy; then
    print_success "Successfully deployed ${worker_name} to ${domain}"
    cd - > /dev/null
    return 0
  else
    print_error "Failed to deploy ${worker_name}"
    cd - > /dev/null
    return 1
  fi
}

# Verify endpoint is accessible
verify_endpoint() {
  local domain=$1
  local url="https://${domain}/health"

  print_info "Verifying ${url}"

  # Wait a moment for DNS propagation
  sleep 2

  local response=$(curl -s -o /dev/null -w "%{http_code}" "$url" || echo "000")

  if [ "$response" == "200" ]; then
    print_success "Endpoint is accessible (HTTP $response)"
    return 0
  else
    print_warning "Endpoint returned HTTP $response (may need DNS propagation time)"
    return 1
  fi
}

# Main execution
main() {
  print_header "Distributed Electrons - Custom Domain Setup"
  echo "This script will configure custom domains for workers"
  echo ""

  # Check prerequisites
  check_prerequisites

  # Track results
  local success_count=0
  local total_count=${#WORKERS[@]}

  # Process each worker
  for worker_name in "${!WORKERS[@]}"; do
    domain="${WORKERS[$worker_name]}"

    print_header "Processing: ${worker_name} → ${domain}"

    if deploy_worker "$worker_name" "$domain"; then
      ((success_count++))

      # Verify the deployment
      verify_endpoint "$domain"
    else
      print_error "Skipping verification due to deployment failure"
    fi

    echo ""
  done

  # Summary
  print_header "Setup Complete"
  echo -e "Successfully configured: ${GREEN}${success_count}${NC} / ${total_count} workers"
  echo ""

  if [ $success_count -eq $total_count ]; then
    print_success "All workers configured successfully!"
    echo ""
    echo "Next steps:"
    echo "1. Wait 5-10 minutes for full DNS propagation"
    echo "2. Test all endpoints:"
    for worker_name in "${!WORKERS[@]}"; do
      domain="${WORKERS[$worker_name]}"
      echo "   curl https://${domain}/health"
    done
    echo "3. Update application references to use new domains"
  else
    print_warning "Some workers failed to configure"
    echo ""
    echo "To retry failed workers, run this script again"
    echo "Check logs above for specific error details"
  fi

  echo ""
}

# Run main function
main "$@"
