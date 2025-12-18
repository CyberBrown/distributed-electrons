# Sandbox Executor Worker

Executes Claude Code tasks in sandboxes with support for:
- Cloudflare Worker deployment
- GitHub code commits
- Auto-deploy/auto-commit from execution results

## Endpoints

### Health Check
```bash
GET /health

# Response
{
  "status": "healthy",
  "service": "sandbox-executor",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "version": "1.0.0",
  "checks": {
    "cloudflare": true,
    "github": true,
    "anthropic": true
  }
}
```

### Execute Task

Execute a task with Claude. Optionally fetches repository context and commits changes.

```bash
POST /execute
Content-Type: application/json

{
  "task": "Add a health check endpoint to the API",
  "context": "Optional additional instructions",

  # GitHub Integration (optional)
  "repo": "owner/repo",           # Repository to work with (fetches context, commits changes)
  "branch": "feature-branch",     # Target branch (created if doesn't exist)
  "commitMessage": "feat: add health check",
  "paths": ["src/"],              # Specific paths to fetch (optional, defaults to common code files)
  "skipCommit": false,            # Set true to skip auto-commit

  # Cloudflare Deployment (optional)
  "auto_deploy": true,
  "worker_name": "my-worker",

  # Claude Options
  "options": {
    "max_tokens": 8192,
    "temperature": 0.3
  }
}

# Response
{
  "success": true,
  "execution_id": "uuid",
  "result": {
    "output": "Generated code...",
    "files": [
      { "path": "index.ts", "content": "...", "type": "typescript" }
    ],
    "metadata": {
      "tokens_used": 500,
      "execution_time_ms": 1234
    }
  },
  "deployment": {
    "success": true,
    "url": "https://time-worker.your-subdomain.workers.dev",
    "worker_id": "...",
    "deployed_at": "2024-01-01T00:00:00.000Z"
  },
  "commit": {
    "success": true,
    "sha": "abc123",
    "url": "https://github.com/owner/repo/commit/abc123",
    "branch": "main"
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Deploy Worker
```bash
POST /deploy
Content-Type: application/json

{
  "worker_name": "my-worker",
  "code": "export default { async fetch(request) { return new Response('Hello!'); } }",
  "compatibility_date": "2024-01-01",
  "workers_dev": true,
  "env_vars": {
    "API_URL": "https://api.example.com"
  },
  "secrets": {
    "API_KEY": "secret-value"
  }
}

# Response
{
  "success": true,
  "deployment": {
    "success": true,
    "url": "https://my-worker.your-subdomain.workers.dev",
    "worker_id": "...",
    "version": "...",
    "deployed_at": "2024-01-01T00:00:00.000Z"
  },
  "request_id": "uuid"
}
```

### GitHub Commit
```bash
POST /github/commit
Content-Type: application/json

{
  "repo": "owner/repo",
  "branch": "feature-branch",
  "files": [
    { "path": "src/index.ts", "content": "// New file content" },
    { "path": "src/old.ts", "content": null }
  ],
  "message": "Add new feature",
  "create_branch": true,
  "base_branch": "main",
  "create_pr": true,
  "pr_title": "New Feature",
  "pr_body": "This PR adds a new feature."
}

# Response
{
  "success": true,
  "commit": {
    "success": true,
    "sha": "abc123",
    "url": "https://github.com/owner/repo/commit/abc123",
    "branch": "feature-branch",
    "pr_url": "https://github.com/owner/repo/pull/1"
  },
  "request_id": "uuid"
}
```

## Setup

### Required Secrets

Set these secrets for the deployed worker:

```bash
cd workers/sandbox-executor

# For Claude Code execution
bun wrangler secret put ANTHROPIC_API_KEY

# For Cloudflare Worker deployment
bun wrangler secret put CLOUDFLARE_API_TOKEN
bun wrangler secret put CLOUDFLARE_ACCOUNT_ID

# For GitHub integration
bun wrangler secret put GITHUB_PAT
```

### Cloudflare API Token

Create an API token at https://dash.cloudflare.com/profile/api-tokens with these permissions:
- Account > Workers Scripts > Edit
- Account > Workers Routes > Edit
- Account > Workers KV Storage > Edit (if using KV)

### GitHub PAT

Create a Personal Access Token at https://github.com/settings/tokens with these scopes:
- `repo` (full control of private repositories)

Or for fine-grained tokens:
- Contents: Read and write
- Pull requests: Read and write (if using create_pr)

## Development

```bash
cd workers/sandbox-executor

# Install dependencies
bun install

# Run locally
bun wrangler dev

# Deploy
bun wrangler deploy

# View logs
bun wrangler tail
```

## Local Development

Copy `.dev.vars.example` to `.dev.vars` and fill in your credentials:

```bash
ANTHROPIC_API_KEY=sk-ant-...
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ACCOUNT_ID=...
GITHUB_PAT=ghp_...
```
