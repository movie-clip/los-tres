import { isDemoSeedEnabled } from '../config/seed';
import { getDb } from '../db/client';
import { seedDemoData } from '../server/seed';
import { runCli } from './shared';

// Loads the demo network, shops, feeds and category mappings. Plain `seed` always
// seeds (an explicit act); `seed --if-enabled` seeds only when SEED_DEMO_DATA
// is true. Loads no products: run import-feeds for those.
void runCli('seed', async () => {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== '--if-enabled');
  if (unknown.length > 0) {
    console.error('usage: seed [--if-enabled]');
    return 2;
  }
  if (args.includes('--if-enabled') && !isDemoSeedEnabled()) {
    console.log('seed: SEED_DEMO_DATA is not true, skipped');
    return 0;
  }
  const report = await seedDemoData(getDb());
  console.log(
    `seed: networks=${report.networks} shops=${report.shops} ` +
      `feeds=${report.feeds} categoryMappings=${report.categoryMappings}`,
  );
  return 0;
});
