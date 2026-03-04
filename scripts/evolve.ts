import { runEvolutionCycle } from '../src/lib/brain';
import { initializeDatabase } from '../src/lib/db';
import { initializeAffiliateLinks } from '../src/lib/monetization';

async function main() {
  console.log('Aether Auto-SaaS - Evolution Script');
  console.log('===================================\n');

  try {
    console.log('Initializing database...');
    await initializeDatabase();

    console.log('Initializing affiliate links...');
    await initializeAffiliateLinks();

    console.log('\nStarting evolution cycle...\n');
    const result = await runEvolutionCycle();

    console.log('\nEvolution cycle completed successfully');
    console.log(result);
    process.exit(0);
  } catch (error) {
    console.error('\nEvolution cycle failed:', error);
    process.exit(1);
  }
}

void main();
