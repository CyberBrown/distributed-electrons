# Multi-Agent Prompts

This directory contains all prompts for Team Leaders and their Agents.

## Structure

```
prompts/
├── team-leaders/
│   ├── team-leader-1-infrastructure.md
│   ├── team-leader-2-workers.md
│   ├── team-leader-3-operations.md
│   └── team-leader-4-interfaces.md
└── agents/
    ├── team-1/
    │   ├── agent-1-1-database-schema.md
    │   ├── agent-1-2-config-service.md
    │   ├── agent-1-3-auth-middleware.md
    │   └── agent-1-4-instance-lookup.md
    ├── team-2/
    │   ├── agent-2-1-provider-adapters.md
    │   ├── agent-2-2-rate-limiter.md
    │   ├── agent-2-3-r2-storage.md
    │   └── agent-2-4-image-gen-worker.md
    ├── team-3/
    │   ├── agent-3-1-error-handling.md
    │   ├── agent-3-2-logging.md
    │   ├── agent-3-3-deployment-scripts.md
    │   └── agent-3-4-github-actions.md
    └── team-4/
        ├── agent-4-1-testing-gui.md
        ├── agent-4-2-admin-interface.md
        ├── agent-4-3-documentation.md
        └── agent-4-4-monitoring-dashboard.md
```

## Execution Order

1. **Team Leader 1** (Sequential - must complete first)
   - Spawns Agents 1.1, 1.2, 1.3, 1.4 in parallel

2. **Team Leaders 2 & 3** (Parallel - after Team 1)
   - Team Leader 2 spawns Agents 2.1, 2.2, 2.3, 2.4
   - Team Leader 3 spawns Agents 3.1, 3.2, 3.3, 3.4

3. **Team Leader 4** (Sequential - after Teams 1 & 2)
   - Spawns Agents 4.1, 4.2, 4.3, 4.4 in parallel

## Usage

Each prompt file is ready to be passed to Claude Code CLI or used with the Task tool.

Team Leaders will spawn their agents autonomously using these prompts.
