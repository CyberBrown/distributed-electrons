#!/usr/bin/env node
/**
 * Update Instance Script
 * Updates an existing instance configuration
 */

import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import type { InstanceConfig } from './deploy-instance.js';

interface UpdateOptions {
  instanceId: string;
  configPath?: string;
  redeployWorkers?: boolean;
}

/**
 * Update instance configuration
 */
async function updateInstance(options: UpdateOptions): Promise<void> {
  console.log(`🔄 Updating instance: ${options.instanceId}\n`);

  try {
    // Load new config if provided
    if (options.configPath) {
      const config = loadConfig(options.configPath);
      await updateDatabaseConfig(config);
    }

    // Redeploy workers if requested
    if (options.redeployWorkers) {
      await redeployWorkers(options.instanceId);
    }

    console.log('\n✨ Update complete!\n');
  } catch (error) {
    console.error('❌ Update failed:', error);
    process.exit(1);
  }
}

function loadConfig(configPath: string): InstanceConfig {
  const content = readFileSync(configPath, 'utf-8');
  return JSON.parse(content);
}

async function updateDatabaseConfig(config: InstanceConfig): Promise<void> {
  console.log('💾 Updating database configuration...');

  const sql = `
    UPDATE instances
    SET config = '${JSON.stringify(config).replace(/'/g, "''")}'
    WHERE instance_id = '${config.instance_id}'
  `;

  const tmpFile = `/tmp/update-instance-${Date.now()}.sql`;
  require('fs').writeFileSync(tmpFile, sql);

  execSync(`wrangler d1 execute DB --file=${tmpFile}`, { stdio: 'inherit' });
  require('fs').unlinkSync(tmpFile);

  console.log('   ✅ Configuration updated\n');
}

async function redeployWorkers(instanceId: string): Promise<void> {
  console.log('⚙️  Redeploying workers...');

  const workers = [`config-service-${instanceId}`, `image-gen-${instanceId}`];

  for (const workerName of workers) {
    console.log(`   Deploying ${workerName}...`);
    execSync(`wrangler deploy --name ${workerName}`, { stdio: 'pipe' });
    console.log(`   ✅ ${workerName} deployed`);
  }
}

// Parse args and run
if (require.main === module) {
  const args = process.argv.slice(2);
  const options: any = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--instance-id') options.instanceId = args[++i];
    if (args[i] === '--config') options.configPath = args[++i];
    if (args[i] === '--redeploy-workers') options.redeployWorkers = true;
  }

  if (!options.instanceId) {
    console.error('Error: --instance-id is required\n');
    process.exit(1);
  }

  updateInstance(options);
}

export { updateInstance };
export type { UpdateOptions };
