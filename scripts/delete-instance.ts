#!/usr/bin/env node
/**
 * Delete Instance Script
 * Removes an instance and cleans up all resources
 */

import { execSync } from 'child_process';
import * as readline from 'readline';

interface DeleteOptions {
  instanceId: string;
  force?: boolean;
  keepBucket?: boolean;
}

/**
 * Delete instance and clean up resources
 */
async function deleteInstance(options: DeleteOptions): Promise<void> {
  console.log(`🗑️  Deleting instance: ${options.instanceId}\n`);

  // Confirmation prompt unless --force
  if (!options.force) {
    const confirmed = await confirmDeletion(options.instanceId);
    if (!confirmed) {
      console.log('Deletion cancelled');
      return;
    }
  }

  try {
    // Step 1: Delete workers
    await deleteWorkers(options.instanceId);

    // Step 2: Delete R2 bucket
    if (!options.keepBucket) {
      await deleteR2Bucket(options.instanceId);
    }

    // Step 3: Delete database entry
    await deleteDatabaseEntry(options.instanceId);

    console.log('\n✨ Instance deleted successfully!\n');
  } catch (error) {
    console.error('❌ Deletion failed:', error);
    process.exit(1);
  }
}

async function confirmDeletion(instanceId: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      `Are you sure you want to delete instance "${instanceId}"? (yes/no): `,
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'yes');
      }
    );
  });
}

async function deleteWorkers(instanceId: string): Promise<void> {
  console.log('⚙️  Deleting workers...');

  const workers = [`config-service-${instanceId}`, `image-gen-${instanceId}`];

  for (const workerName of workers) {
    try {
      console.log(`   Deleting ${workerName}...`);
      execSync(`wrangler delete --name ${workerName} --force`, {
        stdio: 'pipe',
      });
      console.log(`   ✅ ${workerName} deleted`);
    } catch (error) {
      console.log(`   ⚠️  ${workerName} not found or already deleted`);
    }
  }

  console.log('');
}

async function deleteR2Bucket(_instanceId: string): Promise<void> {
  console.log('📦 Deleting R2 bucket...');

  try {
    // Note: This requires the bucket name from instance config
    // For now, we'll skip automatic bucket deletion to avoid data loss
    console.log(
      '   ℹ️  R2 bucket must be deleted manually to prevent accidental data loss'
    );
    console.log('   Run: wrangler r2 bucket delete <bucket-name>\n');
  } catch (error) {
    console.log('   ⚠️  Could not delete R2 bucket\n');
  }
}

async function deleteDatabaseEntry(instanceId: string): Promise<void> {
  console.log('💾 Deleting database entry...');

  const sql = `DELETE FROM instances WHERE instance_id = '${instanceId}'`;

  const tmpFile = `/tmp/delete-instance-${Date.now()}.sql`;
  require('fs').writeFileSync(tmpFile, sql);

  execSync(`wrangler d1 execute DB --file=${tmpFile}`, { stdio: 'inherit' });
  require('fs').unlinkSync(tmpFile);

  console.log('   ✅ Database entry deleted');
}

// Parse args and run
if (require.main === module) {
  const args = process.argv.slice(2);
  const options: any = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--instance-id') options.instanceId = args[++i];
    if (args[i] === '--force') options.force = true;
    if (args[i] === '--keep-bucket') options.keepBucket = true;
  }

  if (!options.instanceId) {
    console.error('Error: --instance-id is required\n');
    process.exit(1);
  }

  deleteInstance(options);
}

export { deleteInstance };
export type { DeleteOptions };
