# Gemini Runner

On-prem Gemini CLI execution service for Distributed Electrons. Runs on Spark (home server) behind Cloudflare Tunnel.

## Architecture

```
Nexus → DE sandbox-executor → gemini-runner.shiftaltcreate.com → Spark Docker → Gemini CLI
```

## Quick Start

1. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your RUNNER_SECRET and GEMINI_API_KEY
   ```

2. **Build and run:**
   ```bash
   docker-compose up -d
   ```

3. **Verify health:**
   ```bash
   curl http://localhost:8790/health
   ```

## Authentication Options

### Option 1: API Key (Recommended for automation)
```bash
# Get key from https://aistudio.google.com/apikey
GEMINI_API_KEY=your_key_here
```

### Option 2: Google Login (Interactive)
```bash
# Run once to authenticate
docker exec -it gemini-runner gemini
# Follow the OAuth flow, credentials saved to ~/.gemini/
```

### Option 3: Vertex AI (Enterprise)
```bash
GOOGLE_CLOUD_PROJECT=your-project
GOOGLE_GENAI_USE_VERTEXAI=true
# Mount service account JSON
```

## API Endpoints

### Health Check
```bash
GET /health
```

### Execute Task
```bash
POST /execute
Headers: X-Runner-Secret: <secret>
Body: {
  "prompt": "Your task here",
  "repo_url": "https://github.com/...",  # optional
  "working_dir": "/path",                 # optional
  "timeout_ms": 300000,                   # optional (default 5min)
  "model": "gemini-2.5-pro",              # optional
  "sandbox": false                        # optional
}
```

### Auth Status
```bash
GET /auth/status
Headers: X-Runner-Secret: <secret>
```

## Cloudflare Tunnel Setup

Add to your tunnel config:
```yaml
ingress:
  - hostname: gemini-runner.shiftaltcreate.com
    service: http://localhost:8790
    originRequest:
      connectTimeout: 30s
      keepAliveTimeout: 90s
```

## Free Tier Limits

- 60 requests/minute
- 1,000 requests/day
- Gemini 2.5 Pro with 1M token context

## Related

- [claude-runner](../claude-runner/) - Claude Code CLI executor
- [sandbox-executor](../../workers/sandbox-executor/) - DE worker that routes to runners
