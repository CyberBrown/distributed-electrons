#!/usr/bin/env node
/**
 * Deploy Instance Script
 * Deploys a new instance with all required infrastructure
 */

import { readFileSync } from 'fs';
import { execSync } from 'child_process';

interface InstanceConfig {
  instance_id: string;
  org_id: string;
  name: string;
  api_keys: Record<string, string>;
  rate_limits: Record<string, { rpm: number; tpm: number }>;
  r2_bucket: string;
  authorized_users?: string[];
}

interface DeployOptions {
  configPath: string;
  cloudflareAccountId: string;
  cloudflareApiToken: string;
  dryRun?: boolean;
}

/**
 * Main deployment function
 */
async function deployInstance(options: DeployOptions): Promise<void> {
  console.log('🚀 Starting instance deployment...\n');

  // Read and validate config
  const config = loadConfig(options.configPath);
  console.log(`📋 Instance: ${config.instance_id} (${config.name})`);
  console.log(`🏢 Organization: ${config.org_id}\n`);

  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  try {
    // Step 1: Create R2 bucket
    await createR2Bucket(config, options);

    // Step 2: Deploy workers
    await deployWorkers(config, options);

    // Step 3: Create database entry
    await createDatabaseEntry(config, options);

    // Step 4: Display success
    displaySuccess(config);
  } catch (error) {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  }
}

/**
 * Load and validate configuration file
 */
function loadConfig(configPath: string): InstanceConfig {
  try {
    const content = readFileSync(configPath, 'utf-8');
    const config: InstanceConfig = JSON.parse(content);

    // Validate required fields
    const required = ['instance_id', 'org_id', 'name', 'r2_bucket'];
    for (const field of required) {
      if (!(field in config)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    return config;
  } catch (error) {
    throw new Error(`Failed to load config: ${error}`);
  }
}

/**
 * Create R2 bucket if it doesn't exist
 */
async function createR2Bucket(
  config: InstanceConfig,
  options: DeployOptions
): Promise<void> {
  console.log(`📦 Creating R2 bucket: ${config.r2_bucket}`);

  if (options.dryRun) {
    console.log('   [DRY RUN] Would create R2 bucket\n');
    return;
  }

  try {
    // Check if bucket exists
    const listCmd = `wrangler r2 bucket list --json`;
    const result = execSync(listCmd, { encoding: 'utf-8' });
    const buckets = JSON.parse(result);

    const bucketExists = buckets.some(
      (b: any) => b.name === config.r2_bucket
    );

    if (!bucketExists) {
      const createCmd = `wrangler r2 bucket create ${config.r2_bucket}`;
      execSync(createCmd, { stdio: 'inherit' });
      console.log('   ✅ R2 bucket created\n');
    } else {
      console.log('   ℹ️  R2 bucket already exists\n');
    }
  } catch (error) {
    throw new Error(`R2 bucket creation failed: ${error}`);
  }
}

/**
 * Deploy all workers for this instance
 */
async function deployWorkers(
  config: InstanceConfig,
  options: DeployOptions
): Promise<void> {
  console.log('⚙️  Deploying workers...');

  if (options.dryRun) {
    console.log('   [DRY RUN] Would deploy workers\n');
    return;
  }

  const workers = [
    {
      name: `config-service-${config.instance_id}`,
      script: 'workers/config-service/index.ts',
      type: 'config-service',
    },
    {
      name: `image-gen-${config.instance_id}`,
      script: 'workers/image-gen/index.ts',
      type: 'image-gen',
    },
  ];

  for (const worker of workers) {
    try {
      console.log(`   Deploying ${worker.name}...`);

      // Deploy worker using wrangler
      const deployCmd = `wrangler deploy --name ${worker.name} --env ${config.instance_id}`;
      execSync(deployCmd, { stdio: 'pipe' });

      console.log(`   ✅ ${worker.name} deployed`);
    } catch (error) {
      console.error(`   ❌ Failed to deploy ${worker.name}`);
      throw error;
    }
  }

  console.log('');
}

/**
 * Create database entry for instance
 */
async function createDatabaseEntry(
  config: InstanceConfig,
  options: DeployOptions
): Promise<void> {
  console.log('💾 Creating database entry...');

  if (options.dryRun) {
    console.log('   [DRY RUN] Would create database entry\n');
    return;
  }

  try {
    // Build SQL insert statement
    const sql = `
      INSERT INTO instances (instance_id, org_id, name, config, created_at)
      VALUES (
        '${config.instance_id}',
        '${config.org_id}',
        '${config.name}',
        '${JSON.stringify({
          api_keys: config.api_keys,
          rate_limits: config.rate_limits,
          r2_bucket: config.r2_bucket,
          worker_urls: {
            config_service: `https://config-service-${config.instance_id}.workers.dev`,
            image_gen: `https://image-gen-${config.instance_id}.workers.dev`,
          },
          authorized_users: config.authorized_users || [],
        }).replace(/'/g, "''")}',
        datetime('now')
      )
      ON CONFLICT(instance_id) DO UPDATE SET
        config = excluded.config,
        name = excluded.name
    `;

    // Execute SQL
    const tmpFile = `/tmp/deploy-instance-${Date.now()}.sql`;
    require('fs').writeFileSync(tmpFile, sql);

    const dbCmd = `wrangler d1 execute DB --file=${tmpFile}`;
    execSync(dbCmd, { stdio: 'inherit' });

    // Cleanup
    require('fs').unlinkSync(tmpFile);

    console.log('   ✅ Database entry created\n');
  } catch (error) {
    throw new Error(`Database entry creation failed: ${error}`);
  }
}

/**
 * Display success message with URLs
 */
function displaySuccess(config: InstanceConfig): void {
  console.log('✨ Deployment complete!\n');
  console.log('Worker URLs:');
  console.log(
    `   Config Service: https://config-service-${config.instance_id}.workers.dev`
  );
  console.log(
    `   Image Gen:      https://image-gen-${config.instance_id}.workers.dev`
  );
  console.log('');
  console.log(`R2 Bucket: ${config.r2_bucket}`);
  console.log('');
}

/**
 * Parse command line arguments
 */
function parseArgs(): DeployOptions {
  const args = process.argv.slice(2);
  const options: any = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--config' && args[i + 1]) {
      options.configPath = args[++i];
    } else if (arg === '--cloudflare-account-id' && args[i + 1]) {
      options.cloudflareAccountId = args[++i];
    } else if (arg === '--cloudflare-api-token' && args[i + 1]) {
      options.cloudflareApiToken = args[++i];
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help') {
      displayHelp();
      process.exit(0);
    }
  }

  // Validate required options
  if (!options.configPath) {
    console.error('Error: --config is required\n');
    displayHelp();
    process.exit(1);
  }

  // Use environment variables as fallback
  options.cloudflareAccountId =
    options.cloudflareAccountId || process.env.CLOUDFLARE_ACCOUNT_ID;
  options.cloudflareApiToken =
    options.cloudflareApiToken || process.env.CLOUDFLARE_API_TOKEN;

  if (!options.cloudflareAccountId || !options.cloudflareApiToken) {
    console.error(
      'Error: Cloudflare credentials required (via args or env vars)\n'
    );
    displayHelp();
    process.exit(1);
  }

  return options;
}

/**
 * Display help message
 */
function displayHelp(): void {
  console.log(`
Usage: npm run deploy-instance -- [options]

Options:
  --config <path>                 Path to instance config JSON file (required)
  --cloudflare-account-id <id>    Cloudflare account ID (or use CLOUDFLARE_ACCOUNT_ID env var)
  --cloudflare-api-token <token>  Cloudflare API token (or use CLOUDFLARE_API_TOKEN env var)
  --dry-run                       Simulate deployment without making changes
  --help                          Display this help message

Example:
  npm run deploy-instance -- --config instances/production.json

Environment Variables:
  CLOUDFLARE_ACCOUNT_ID    Cloudflare account ID
  CLOUDFLARE_API_TOKEN     Cloudflare API token
  `);
}

// Run if called directly
if (require.main === module) {
  const options = parseArgs();
  deployInstance(options).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { deployInstance };
export type { DeployOptions, InstanceConfig };
