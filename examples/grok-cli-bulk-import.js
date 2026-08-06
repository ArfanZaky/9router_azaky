#!/usr/bin/env node
/**
 * Grok CLI Bulk Import - Standalone Usage Script
 * 
 * This script demonstrates how to use the Grok CLI bulk import manager.
 * You can run this directly or integrate it into your workflow.
 * 
 * Usage:
 *   node examples/grok-cli-bulk-import.js
 * 
 * Account Format (one per line):
 *   email@gmail.com:password123
 *   another@gmail.com:securepass456
 * 
 * Or with pipe separator:
 *   email@gmail.com|password123
 * 
 * Or with tab separator (paste from spreadsheet):
 *   email@gmail.com	password123
 */

const { getGrokCliBulkImportManager } = require('../src/lib/oauth/services');

async function main() {
  console.log('🚀 Grok CLI Bulk Import\n');

  // Example accounts (replace with your actual accounts)
  const accounts = [
    'test1@example.com:password123',
    'test2@example.com:password456',
    'test3@example.com:password789',
  ];

  console.log(`📋 Importing ${accounts.length} accounts...\n`);

  try {
    // Get bulk import manager instance
    const manager = getGrokCliBulkImportManager();

    // Start import job
    const job = await manager.startJob({
      accounts,
      concurrency: 4, // Process 4 accounts in parallel
      // Optional: Add proxy configuration
      // proxyUrl: 'http://proxy.example.com:8080',
      // proxyUrls: ['http://proxy1:8080', 'http://proxy2:8080'],
      // proxyMode: 'round-robin', // or 'single'
    });

    console.log(`✅ Job started: ${job.jobId}`);
    console.log(`   Status: ${job.status}`);
    console.log(`   Total accounts: ${job.accounts.length}`);
    console.log(`   Concurrency: ${job.concurrency}\n`);

    // Monitor job progress
    const pollInterval = setInterval(async () => {
      const currentJob = manager.getJob(job.jobId);
      
      if (!currentJob) {
        clearInterval(pollInterval);
        return;
      }

      const summary = {
        queued: currentJob.accounts.filter(a => a.status === 'queued').length,
        running: currentJob.accounts.filter(a => a.status === 'running').length,
        success: currentJob.accounts.filter(a => a.status === 'success').length,
        failed: currentJob.accounts.filter(a => a.status.startsWith('failed')).length,
        needsManual: currentJob.accounts.filter(a => a.status === 'needs_manual').length,
      };

      console.log(`📊 Progress: ${summary.success}/${currentJob.accounts.length} complete | ` +
                  `Running: ${summary.running} | Failed: ${summary.failed} | Manual: ${summary.needsManual}`);

      // Check if job is complete
      if (currentJob.status === 'completed' || currentJob.status === 'cancelled') {
        clearInterval(pollInterval);
        console.log(`\n✅ Job ${currentJob.status}`);
        console.log(`   Total time: ${Math.round((new Date(currentJob.finishedAt) - new Date(currentJob.startedAt)) / 1000)}s`);
        console.log(`   Success: ${summary.success}`);
        console.log(`   Failed: ${summary.failed}`);
        console.log(`   Needs Manual: ${summary.needsManual}\n`);
      }
    }, 3000); // Poll every 3 seconds

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };
