# Team 3 - Operations Team TODO List

**Branch**: `team-3-operations`
**Team Leader**: Team Lead 3
**Current Status**: 85% Complete - Grade B+
**Blocking Issues**: MISSING CI/CD workflows

---

## 🚨 PRIORITY 1 - CRITICAL MISSING COMPONENTS

### Task 3.1: CREATE GitHub Actions CI/CD Workflows
**Status**: ❌ DOES NOT EXIST - CRITICAL BLOCKER
**Expected Location**: `/.github/workflows/`
**Issue**: No CI/CD automation created despite being Agent 3.4's responsibility

**What's Missing**:
- `/.github/workflows/test.yml` - Run tests on PRs
- `/.github/workflows/deploy.yml` - Deploy on merge to main
- `/.github/workflows/deploy-instance.yml` - Manual instance deployment

**Impact**: 🔴 CRITICAL - Cannot merge to main without CI/CD

---

#### Task 3.1a: Create Test Workflow
**File to Create**: `/.github/workflows/test.yml`

**Action Required**:
Create complete test workflow that runs on all PRs:

```yaml
name: Test

on:
  pull_request:
    branches: [main, master]
  push:
    branches: [main, master]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run linter
        run: npm run lint

      - name: Run type checking
        run: npm run typecheck

      - name: Run tests
        run: npm test

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        if: always()
        with:
          files: ./coverage/coverage-final.json
          fail_ci_if_error: false

  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run security audit
        run: npm audit --audit-level=moderate
```

**Acceptance Criteria**:
- ✅ Workflow file exists
- ✅ Runs on every PR
- ✅ All tests must pass
- ✅ Lint and typecheck enforced
- ✅ Test results visible in PR

---

#### Task 3.1b: Create Deploy Workflow
**File to Create**: `/.github/workflows/deploy.yml`

**Action Required**:
Create automated deployment on merge to main:

```yaml
name: Deploy to Cloudflare

on:
  push:
    branches: [main, master]
  workflow_dispatch:  # Allow manual trigger

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Deploy Config Service
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
          workingDirectory: './infrastructure/config-service'

      - name: Deploy Image Gen Worker
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
          workingDirectory: './workers/image-gen'

      - name: Deploy Rate Limiter
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
          workingDirectory: './workers/shared/rate-limiter'

      - name: Run smoke tests
        run: npm run test:e2e
        env:
          TEST_API_KEY: ${{ secrets.TEST_API_KEY }}

  notify:
    needs: deploy
    runs-on: ubuntu-latest
    if: always()
    steps:
      - name: Notify deployment status
        run: |
          echo "Deployment ${{ needs.deploy.result }}"
          # Add Slack/Discord notification here
```

**GitHub Secrets Required**:
Add these to repository settings:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `TEST_API_KEY`

**Acceptance Criteria**:
- ✅ Workflow deploys all workers automatically
- ✅ Smoke tests run after deployment
- ✅ Deployment status tracked
- ✅ Rollback possible if tests fail

---

#### Task 3.1c: Create Manual Instance Deployment Workflow
**File to Create**: `/.github/workflows/deploy-instance.yml`

**Action Required**:
Create workflow for deploying new instances on demand:

```yaml
name: Deploy New Instance

on:
  workflow_dispatch:
    inputs:
      instance_id:
        description: 'Instance ID (e.g., production, staging)'
        required: true
        type: string
      org_id:
        description: 'Organization ID'
        required: true
        type: string
      environment:
        description: 'Environment type'
        required: true
        type: choice
        options:
          - production
          - staging
          - development

jobs:
  deploy-instance:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Create instance configuration
        run: |
          cat > instances/${{ inputs.instance_id }}.json << EOF
          {
            "instance_id": "${{ inputs.instance_id }}",
            "org_id": "${{ inputs.org_id }}",
            "environment": "${{ inputs.environment }}"
          }
          EOF

      - name: Deploy instance
        run: npm run deploy-instance -- --config instances/${{ inputs.instance_id }}.json
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - name: Verify deployment
        run: |
          echo "Instance ${{ inputs.instance_id }} deployed"
          # Add verification checks
```

**Acceptance Criteria**:
- ✅ Can deploy new instances via GitHub UI
- ✅ Instance config created automatically
- ✅ All workers deployed for instance
- ✅ Verification runs after deployment

---

### Task 3.2: Complete Deployment Scripts
**Status**: ⚠️ INCOMPLETE
**Files**: `/workspace/scripts/deploy-instance.ts`, `/workspace/scripts/deploy-all-instances.ts`

**What's Missing**:
Scripts exist but don't have actual Cloudflare API integration

**Action Required**:

#### 3.2a: Complete `deploy-instance.ts`
```typescript
import * as fs from 'fs';
import { execSync } from 'child_process';

interface InstanceConfig {
  instance_id: string;
  org_id: string;
  api_keys: Record<string, string>;
  rate_limits: Record<string, { rpm: number; tpm: number }>;
  r2_bucket?: string;
}

async function deployInstance(configPath: string) {
  // 1. Read config
  const config: InstanceConfig = JSON.parse(
    fs.readFileSync(configPath, 'utf-8')
  );

  console.log(`Deploying instance: ${config.instance_id}`);

  // 2. Create D1 entry
  console.log('Creating D1 database entry...');
  execSync(`wrangler d1 execute multiagent_system --command="
    INSERT INTO instances (instance_id, org_id, name, config)
    VALUES (
      '${config.instance_id}',
      '${config.org_id}',
      '${config.instance_id}',
      '${JSON.stringify(config)}'
    )
  "`);

  // 3. Create R2 bucket if needed
  if (config.r2_bucket) {
    console.log(`Creating R2 bucket: ${config.r2_bucket}...`);
    try {
      execSync(`wrangler r2 bucket create ${config.r2_bucket}`);
    } catch (e) {
      console.log('Bucket may already exist, continuing...');
    }
  }

  // 4. Deploy workers with instance-specific names
  console.log('Deploying Config Service...');
  execSync(`wrangler deploy --name config-service-${config.instance_id}`, {
    cwd: './infrastructure/config-service'
  });

  console.log('Deploying Image Gen Worker...');
  execSync(`wrangler deploy --name image-gen-${config.instance_id}`, {
    cwd: './workers/image-gen'
  });

  // 5. Update instance with worker URLs
  const configServiceUrl = `https://config-service-${config.instance_id}.YOUR_ACCOUNT.workers.dev`;
  const imageGenUrl = `https://image-gen-${config.instance_id}.YOUR_ACCOUNT.workers.dev`;

  execSync(`wrangler d1 execute multiagent_system --command="
    UPDATE instances
    SET config = json_set(config, '$.worker_urls', json_object(
      'config_service', '${configServiceUrl}',
      'image_gen', '${imageGenUrl}'
    ))
    WHERE instance_id = '${config.instance_id}'
  "`);

  console.log('\n✅ Instance deployed successfully!');
  console.log(`Config Service: ${configServiceUrl}`);
  console.log(`Image Gen: ${imageGenUrl}`);
}

// Run if called directly
if (require.main === module) {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error('Usage: npm run deploy-instance -- --config <path>');
    process.exit(1);
  }
  deployInstance(configPath).catch(console.error);
}
```

#### 3.2b: Complete `deploy-all-instances.ts`
```typescript
import * as fs from 'fs';
import * as path from 'path';
import { deployInstance } from './deploy-instance';

async function deployAllInstances() {
  const instancesDir = path.join(__dirname, '../instances');

  if (!fs.existsSync(instancesDir)) {
    console.error('No instances directory found');
    process.exit(1);
  }

  const configFiles = fs.readdirSync(instancesDir)
    .filter(f => f.endsWith('.json'));

  console.log(`Found ${configFiles.length} instance configs`);

  for (const configFile of configFiles) {
    const configPath = path.join(instancesDir, configFile);
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Deploying: ${configFile}`);
    console.log('='.repeat(50));

    await deployInstance(configPath);
  }

  console.log('\n✅ All instances deployed!');
}

deployAllInstances().catch(console.error);
```

**Acceptance Criteria**:
- ✅ Scripts deploy real infrastructure
- ✅ D1 entries created
- ✅ R2 buckets created
- ✅ Workers deployed with instance names
- ✅ Worker URLs stored in database

---

## ⚙️ PRIORITY 2 - Configuration

### Task 3.3: Configure All Wrangler.toml Files
**Status**: ⚠️ ALL HAVE COMMENTED BINDINGS
**Files Affected**: All worker wrangler.toml files

**Action Required**:
Work with Team 1 to get real binding IDs, then update:

1. `/workspace/infrastructure/config-service/wrangler.toml`
2. `/workspace/workers/image-gen/wrangler.toml`
3. `/workspace/workers/shared/rate-limiter/wrangler.toml`

See Team 1 Task 1.4 and Team 2 Task 2.4 for details.

**This is a COORDINATION task** - ensure all teams use same binding IDs.

---

### Task 3.4: Set Up GitHub Secrets
**Status**: ⏳ NOT STARTED
**Location**: GitHub Repository Settings → Secrets

**Secrets to Add**:
```bash
CLOUDFLARE_API_TOKEN=<from user's .env>
CLOUDFLARE_ACCOUNT_ID=<from user's .env>
IDEOGRAM_API_KEY=<from user's .env>
TEST_API_KEY=<generate test API key>
```

**How to Add**:
1. Go to: https://github.com/CyberBrown/cloudflare-multiagent-system/settings/secrets/actions
2. Click "New repository secret"
3. Add each secret from the list above
4. Values should come from `/workspace/.env` file

**Acceptance Criteria**:
- ✅ All 4 secrets configured
- ✅ GitHub Actions can access them
- ✅ Values match production environment

---

## 📚 PRIORITY 3 - Enhancement & Documentation

### Task 3.5: Add Rollback Capability
**Status**: ⏳ NOT STARTED
**Why**: Deployments might fail or introduce bugs

**Action Required**:
1. Create `/workspace/scripts/rollback.ts`:
```typescript
async function rollback(workerName: string, version?: string) {
  if (version) {
    // Rollback to specific version
    execSync(`wrangler rollback ${workerName} --version ${version}`);
  } else {
    // Rollback to previous version
    execSync(`wrangler rollback ${workerName}`);
  }
}
```

2. Add rollback workflow:
```yaml
# .github/workflows/rollback.yml
name: Rollback
on:
  workflow_dispatch:
    inputs:
      worker:
        description: 'Worker to rollback'
        required: true
        type: choice
        options:
          - config-service
          - image-gen
          - rate-limiter
```

**Acceptance Criteria**:
- ✅ Can rollback any worker
- ✅ Version history tracked
- ✅ Manual trigger available in GitHub

---

### Task 3.6: Add Deployment Notifications
**Status**: ⏳ NOT STARTED
**Why**: Team should know when deployments happen

**Action Required**:
1. Choose notification method (Slack, Discord, email)
2. Add webhook URL to GitHub Secrets
3. Update deploy.yml workflow:
```yaml
- name: Notify Success
  if: success()
  run: |
    curl -X POST ${{ secrets.SLACK_WEBHOOK }} \
      -H 'Content-Type: application/json' \
      -d '{
        "text": "✅ Deployment successful",
        "blocks": [...]
      }'
```

**Acceptance Criteria**:
- ✅ Notifications sent on deployment
- ✅ Includes deployment status
- ✅ Links to GitHub Actions run

---

### Task 3.7: Create Deployment Documentation
**Status**: ⏳ NOT STARTED
**File**: `/workspace/docs/deployment/README.md`

**Content to Include**:
1. Prerequisites (Cloudflare account, wrangler, secrets)
2. Initial setup (D1, KV, R2 creation)
3. Deploying first instance
4. Adding new instances
5. Updating existing instances
6. Rollback procedures
7. Troubleshooting common issues

**Acceptance Criteria**:
- ✅ Complete deployment guide
- ✅ Step-by-step instructions
- ✅ Screenshots/examples
- ✅ Troubleshooting section

---

## 🧪 PRIORITY 4 - Testing

### Task 3.8: Test CI/CD Workflows
**Status**: ⏳ NOT STARTED (Depends on Task 3.1)

**Action Required**:
1. Create test PR to trigger test workflow
2. Verify all checks pass
3. Merge to trigger deploy workflow
4. Verify deployment succeeds
5. Test manual instance deployment workflow
6. Document any issues

**Test Checklist**:
- [ ] Test workflow runs on PR
- [ ] Deploy workflow runs on merge
- [ ] All workers deploy successfully
- [ ] Smoke tests pass
- [ ] Manual instance deployment works
- [ ] Rollback works

---

### Task 3.9: Add Deployment Integration Tests
**Status**: ⏳ NOT STARTED
**File**: `/workspace/tests/deployment/deployment.test.ts`

**Test Scenarios**:
```typescript
describe('Deployment Scripts', () => {
  it('should deploy a new instance', async () => {
    // Create test config
    // Run deployment script
    // Verify workers deployed
    // Verify D1 entry created
  });

  it('should update existing instance', async () => {
    // Modify instance config
    // Redeploy
    // Verify config updated
  });

  it('should handle deployment failures gracefully', async () => {
    // Simulate deployment failure
    // Verify rollback or error handling
  });
});
```

**Acceptance Criteria**:
- ✅ Deployment scripts tested
- ✅ Error handling verified
- ✅ Tests run in CI

---

### Task 3.10: Create Deployment Checklist
**Status**: ⏳ NOT STARTED
**File**: `/workspace/docs/deployment/CHECKLIST.md`

**Checklist Content**:
```markdown
# Pre-Deployment Checklist

## Before First Deployment
- [ ] Cloudflare account set up
- [ ] API token created with correct permissions
- [ ] GitHub secrets configured
- [ ] All tests passing locally
- [ ] D1 database created
- [ ] KV namespaces created
- [ ] R2 buckets created

## Before Each Deployment
- [ ] All tests passing
- [ ] Code reviewed and approved
- [ ] Database migrations reviewed
- [ ] Breaking changes documented
- [ ] Rollback plan ready

## After Deployment
- [ ] Smoke tests pass
- [ ] Health checks responding
- [ ] Monitoring shows green
- [ ] Team notified of deployment
```

**Acceptance Criteria**:
- ✅ Comprehensive checklist
- ✅ Used before every deployment
- ✅ Prevents deployment issues

---

## 📊 Progress Tracking

**Total Tasks**: 10
**Critical (P1)**: 2 (CI/CD + Scripts)
**Configuration (P2)**: 2
**Enhancement (P3)**: 3
**Testing (P4)**: 3

### Estimated Time:
- **P1 Tasks**: 4-6 hours (CRITICAL)
- **P2 Tasks**: 1-2 hours
- **P3 Tasks**: 2-3 hours
- **P4 Tasks**: 2-3 hours
- **Total Critical**: 5-8 hours
- **Total**: 9-14 hours

---

## ✅ Checklist for Merge Readiness

Before requesting merge to main:
- [ ] All 3 GitHub Actions workflows created and tested
- [ ] Deployment scripts complete with real Cloudflare integration
- [ ] GitHub secrets configured
- [ ] All wrangler configs have real bindings
- [ ] Deployment tested in staging environment
- [ ] Rollback capability tested
- [ ] Documentation complete
- [ ] Code reviewed by Team Lead

---

## 🆘 Need Help?

**CRITICAL**: Task 3.1 (CI/CD) is BLOCKING for merge!

**Escalate if**:
- GitHub Actions not triggering after 1 hour
- Wrangler deployment failing repeatedly
- Need access to Cloudflare account
- Coordination issues with Team 1 or 2

**Coordination Needed**:
- With Team 1: Get D1/KV binding IDs
- With Team 2: Get worker deployment order
- With Project Manager: Configure GitHub secrets

**Resources**:
- GitHub Actions Docs: https://docs.github.com/en/actions
- Wrangler Docs: https://developers.cloudflare.com/workers/wrangler/
- Review Report: `/workspace/TEAM_REVIEW_REPORT.md`
