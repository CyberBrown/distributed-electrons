# Claude Runner - On-Prem Claude Code Execution

An on-prem service that runs Claude Code CLI with persistent OAuth credentials, exposed via Cloudflare Tunnel.

## Why?

Running Claude Code on Cloudflare edge containers causes OAuth failures due to:
- Shared egress IPs flagged as suspicious
- Geographic mismatch between login location and execution
- Container restarts losing OAuth state

This service runs on your home server with persistent OAuth, eliminating these issues.

## Architecture

```
[API Request]
      │
      ▼
[sandbox-executor (Cloudflare Worker)]
      │
      ▼ (via Cloudflare Tunnel)
[Spark @ Home]
      │
      ├── Claude Code CLI (persistent OAuth)
      ├── ~/.claude/.credentials.json
      └── Cached git repos
      │
      ▼
[Results back to Worker]
```

## Quick Start

### 1. Deploy on Spark

```bash
# Clone the repo
cd /path/to/distributed-electrons/services/claude-runner

# Copy environment file
cp .env.example .env

# Generate a runner secret
echo "RUNNER_SECRET=$(openssl rand -hex 32)" >> .env

# Build and start
docker compose up -d
```

### 2. Configure Claude OAuth

```bash
# SSH into the container
docker compose exec claude-runner bash

# Login to Claude (opens browser URL)
claude login

# Verify
claude --version
```

### 3. Set Up Cloudflare Tunnel

```bash
# Install cloudflared
brew install cloudflared  # or apt/yum

# Login to Cloudflare
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create claude-runner

# Create DNS route
cloudflared tunnel route dns claude-runner claude-runner.distributedelectrons.com

# Copy and configure
cp cloudflared-config.example.yml ~/.cloudflared/config.yml
# Edit config.yml with your tunnel ID

# Run tunnel
cloudflared tunnel run claude-runner

# Or install as systemd service
sudo cloudflared service install
```

### 4. Configure sandbox-executor

```bash
# Add secrets to the worker
cd ../workers/sandbox-executor

wrangler secret put CLAUDE_RUNNER_URL
# Enter: https://claude-runner.distributedelectrons.com

wrangler secret put RUNNER_SECRET
# Enter the same secret from .env

# Deploy
wrangler deploy
```

## API Endpoints

### POST /execute

Execute a Claude Code task.

```bash
curl -X POST https://claude-runner.distributedelectrons.com/execute \
  -H "Content-Type: application/json" \
  -H "X-Runner-Secret: your-secret" \
  -d '{
    "prompt": "Create a hello world function in Python",
    "repo_url": "https://github.com/your/repo",
    "timeout_ms": 300000
  }'
```

### GET /health

Health check (no auth required).

```bash
curl https://claude-runner.distributedelectrons.com/health
```

### GET /oauth/status

Check OAuth credential status.

```bash
curl https://claude-runner.distributedelectrons.com/oauth/status \
  -H "X-Runner-Secret: your-secret"
```

## Mobile Re-Auth

When OAuth expires and needs re-authentication:

### Option A: SSH via Cloudflare Access

```bash
# From phone using Termius, Prompt, etc.
cloudflared access ssh --hostname spark.yourdomain.com

# Then run
docker compose exec claude-runner claude login
```

### Option B: Web Terminal (future)

Add a web terminal endpoint for browser-based `claude login`.

## Monitoring

The `/health` endpoint returns OAuth status:

```json
{
  "status": "healthy",
  "timestamp": "2025-01-20T10:30:00Z",
  "oauth": {
    "configured": true,
    "expired": false,
    "expires_at": "2025-01-20T18:30:00Z",
    "hours_remaining": 8
  }
}
```

Set up monitoring to alert when `hours_remaining` < 2.

## Fallback Behavior

If the runner is unreachable, sandbox-executor falls back to edge container execution (existing behavior). This ensures the system remains functional even if Spark is offline.

## Security

- Runner only accepts requests with valid `RUNNER_SECRET` header
- Cloudflare Tunnel encrypts all traffic (no ports exposed)
- OAuth credentials never leave Spark
- Consider adding Cloudflare Access for additional authentication
