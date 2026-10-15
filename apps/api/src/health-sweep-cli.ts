import { pool } from './db.js';
import { healthSweep } from './publishing.js';

// Re-checks every published gig. Run it daily (Windows Task Scheduler / cron) or press the button via the API.
async function main() {
  const r = await healthSweep();
  console.log(`Checked ${r.checked} published gigs. Taken offline: ${r.unpublished}.`);
  for (const c of r.changes) console.log(`  #${c.gigId} ${(c.externalId ?? '-').padEnd(12)} ${c.was} -> ${c.now}  (${c.action})`);
  for (const f of r.failures) console.log(`  gig ${f.gigId} could not be checked: ${f.message}`);
  await pool.end();
}
main().catch(async (e) => { console.error('SWEEP FAILED:', e.message); await pool.end(); process.exit(1); });
