# Sandbox Executor Worker

Cloudflare Worker that executes Claude Agent SDK tasks. Supports two execution modes:
1. **SDK Mode** (`/execute/sdk`) - Direct SDK usage, lighter weight, faster (recommended)
2. **Sandbox Mode** (`/execute`) - Full container isolation with CLI, for tasks needing filesystem/git

## Overview

This worker provides an HTTP API for executing autonomous code tasks using Claude Code. It's designed to handle `claude-code` tasks dispatched from Nexus.

## Features

- **Two Execution Modes**: SDK (fast, lightweight) and Sandbox (isolated container)
- **Git Integration**: Clone repositories and apply changes (Sandbox mode)
- **Diff Output**: Returns git diffs for applied changes (Sandbox mode)
- **Configurable**: Customizable system prompts, models, and tools

## API Endpoints

### POST /execute/sdk (Recommended)

Execute a task using Claude Agent SDK directly. This is the lightweight approach - no container overhead.

**Request:**
```json
{
  "prompt": "Explain how async/await works in JavaScript",
  "options": {
    "max_turns": 10,
    "model": "sonnet",
    "system_prompt": "You are a helpful coding assistant",
    "allowed_tools": ["WebFetch", "WebSearch"]
  }
}
```

**Response:**
```json
{
  "success": true,
  "request_id": "uuid",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "result": "The assistant's final response...",
  "messages": [
    {
      "type": "assistant",
      "message": { "content": [...] }
    },
    {
      "type": "result",
      "subtype": "success",
      "result": "...",
      "total_cost_usd": 0.01,
      "num_turns": 3
    }
  ],
  "metadata": {
    "execution_time_ms": 5000,
    "total_cost_usd": 0.01,
    "num_turns": 3,
    "model": "sonnet"
  }
}
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `max_turns` | number | 10 | Maximum conversation turns |
| `model` | string | "sonnet" | Model: "opus", "sonnet", or "haiku" |
| `system_prompt` | string | claude_code preset | Custom system prompt |
| `append_system_prompt` | string | - | Append to default system prompt |
| `allowed_tools` | string[] | ["WebFetch", "WebSearch", "TodoWrite"] | Tools the agent can use |

### POST /execute (Sandbox Mode)

Execute a task using Claude Code CLI in an isolated sandbox container. Use this for tasks that need filesystem access or git operations.

**Request:**
```json
{
  "task": "Fix the bug in the login function",
  "repo": "https://github.com/owner/repo",
  "options": {
    "include_diff": true,
    "permission_mode": "acceptEdits",
    "system_prompt": "Custom instructions..."
  }
}
```

**Response:**
```json
{
  "success": true,
  "request_id": "uuid",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "logs": "Claude Code execution output...",
  "diff": "git diff output...",
  "metadata": {
    "execution_time_ms": 5000,
    "sandbox_id": "abc123",
    "repo": "https://github.com/owner/repo"
  }
}
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "service": "sandbox-executor",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "version": "1.0.0"
}
```

## Local Development

### Prerequisites

- Node.js 20+ / Bun
- Docker running locally (for Sandbox mode only)
- Anthropic API key

### Setup

1. Install dependencies:
```bash
cd workers/sandbox-executor
bun install
```

2. Create `.dev.vars` from example:
```bash
cp .dev.vars.example .dev.vars
# Edit .dev.vars and add your ANTHROPIC_API_KEY
```

3. Start local development server:
```bash
bun run dev
```

Note: First run with Sandbox mode will take 2-3 minutes to build the Docker container.

### Testing

**Test SDK endpoint (recommended):**
```bash
curl -X POST http://localhost:8787/execute/sdk \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What is 2 + 2? Just give me the number.",
    "options": {
      "max_turns": 1
    }
  }'
```

**Test Sandbox endpoint:**
```bash
curl -X POST http://localhost:8787/execute \
  -H "Content-Type: application/json" \
  -d '{
    "task": "Create a hello world Python script",
    "options": {
      "permission_mode": "acceptEdits"
    }
  }'
```

**Test with a repository (Sandbox mode):**
```bash
curl -X POST http://localhost:8787/execute \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "https://github.com/cloudflare/workers-sdk",
    "task": "Add a comment to the README explaining what this repo does",
    "options": {
      "include_diff": true
    }
  }'
```

## Deployment

### Set Secrets

```bash
wrangler secret put ANTHROPIC_API_KEY
```

### Deploy

```bash
bun run deploy
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CONFIG_SERVICE_URL` | DE Config Service URL | `https://api.distributedelectrons.com` |
| `MAX_EXECUTION_TIME` | Max execution time in ms | `300000` (5 min) |

### Secrets

| Secret | Description |
|--------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude Code |

## Architecture

```
┌─────────────────────┐
│    HTTP Request     │
└──────────┬──────────┘
           │
           ▼
┌──────────────────────────────────────────────────────┐
│              Sandbox Executor Worker                  │
├──────────────────────┬───────────────────────────────┤
│                      │                               │
│  POST /execute/sdk   │      POST /execute            │
│  (SDK Mode)          │      (Sandbox Mode)           │
│                      │                               │
│  ┌────────────────┐  │  ┌─────────────────────────┐  │
│  │ Claude Agent   │  │  │  Cloudflare Sandbox     │  │
│  │ SDK (direct)   │  │  │  (Isolated Container)   │  │
│  │                │  │  │                         │  │
│  │ - Fast startup │  │  │  - Ubuntu Linux         │  │
│  │ - No container │  │  │  - Claude Code CLI      │  │
│  │ - Web tools    │  │  │  - Git available        │  │
│  └────────────────┘  │  │  - Full filesystem      │  │
│                      │  └─────────────────────────┘  │
└──────────────────────┴───────────────────────────────┘
```

## When to Use Each Mode

| Use Case | Recommended Mode |
|----------|-----------------|
| Simple Q&A, explanations | SDK (`/execute/sdk`) |
| Web research tasks | SDK (`/execute/sdk`) |
| Code review (read-only) | SDK (`/execute/sdk`) |
| Modifying repository files | Sandbox (`/execute`) |
| Running shell commands | Sandbox (`/execute`) |
| Git operations | Sandbox (`/execute`) |

## Phase 2 TODOs

- [ ] Wire up to Nexus task dispatch
- [ ] Add rate limiting via RATE_LIMITER Durable Object
- [ ] Add instance configuration via Config Service
- [ ] Add result storage to R2
- [ ] Add execution tracking to D1
- [ ] Add streaming support for SDK mode
