/**
 * Evolution Script - ESM Version
 * 
 * This script can be run manually or via cron to trigger the autonomous evolution cycle.
 */

import { runEvolutionCycle } from '../src/lib/brain.js';
import { initializeDatabase } from '../src/lib/db.js';
import { initializeAffiliateLinks } from '../src/lib/monetization.js';

async function main() {
  console.log('🚀 Aether Auto-SaaS - Evolution Script');
  console.log('======================================\n');

  try {
    // Initialize database
    console.log('📦 Initializing database...');
    await initializeDatabase();

    // Initialize affiliate links (if not already done)
    console.log('💰 Initializing affiliate links...');
    await initializeAffiliateLinks();

    // Run evolution cycle
    console.log('\n🧠 Starting evolution cycle...\n');
    const result = await runEvolutionCycle();

    console.log('\n✅ Evolution cycle completed successfully!');
    console.log('Result:', result);

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Evolution cycle failed:', error);
    process.exit(1);
  }
}

main();
