import path from 'node:path';
import { pool } from './db.js';
import { importCsv } from './importCsv.js';
import { classifyAll } from './classify.js';
import { verifyMany } from './verify.js';

// One command for the whole automatic part: import -> classify -> verify -> Review Pending
async function main() {
  const arg = process.argv[2];
  if (!arg) throw new Error('Usage: npm run pipeline -w apps/api -- data\\sample\\file.csv');
  const file = path.resolve(process.env.INIT_CWD ?? process.cwd(), arg);

  console.log('STEP 1/3  Import', file);
  const imp = await importCsv(file);
  console.log(`  new: ${imp.counts.created}, known: ${imp.counts.unchanged + imp.counts.updated + imp.counts.held + imp.counts.conflict}, failed rows: ${imp.counts.failed}`);

  console.log('STEP 2/3  Classify gigs that have no module');
  const cls = await classifyAll();
  console.log(`  assigned: ${cls.filter((c) => c.outcome === 'auto_assigned').length}, left for a human: ${cls.filter((c) => c.outcome === 'needs_manual').length}`);

  console.log('STEP 3/3  Verify new gigs (is each one really open?)');
  const [rows] = await pool.query("SELECT id FROM gigs WHERE workflow_state = 'discovered' ORDER BY id");
  const { results, failures } = await verifyMany((rows as { id: number }[]).map((r) => r.id), 'discovery');
  const tally: Record<string, number> = {};
  for (const r of results) tally[r.status] = (tally[r.status] ?? 0) + 1;
  console.log('  results:', tally, failures.length ? `| errors: ${failures.length}` : '');
  console.log('\nDone. New gigs are now in Review Pending.');
  await pool.end();
}
main().catch(async (e) => { console.error('PIPELINE FAILED:', e.message); await pool.end(); process.exit(1); });
