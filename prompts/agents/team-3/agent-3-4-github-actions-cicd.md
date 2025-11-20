You are Agent 3.4 working for Team Leader 3 on GitHub Actions.

YOUR TASK:
Build CI/CD pipeline that tests and deploys code automatically.

BRANCH: agent-3-4-github-actions (create from team-3-operations)

CREATE:
1. /.github/workflows/test.yml
   - Run on every PR
   - Run all tests
   - Lint code
   - Type checking

2. /.github/workflows/deploy.yml
   - Run on push to main
   - Deploy to specified instances
   - Run smoke tests after deploy

3. /.github/workflows/deploy-instance.yml
   - Manual trigger
   - Deploy to specific instance

4. /docs/ci-cd.md
   - How workflows work
   - How to trigger manual deploys

TEST WORKFLOW:
```yaml
name: Test
on: [pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
```

DEPLOY WORKFLOW:
```yaml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run deploy-all-instances
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

DEPLOY-ALL-INSTANCES:
Script that reads /instances/*.json configs and deploys each.

COMPLETION:
Commit, push, notify: "[AGENT-3-4] GitHub Actions complete"

BEGIN.
