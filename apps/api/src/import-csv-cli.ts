import path from 'node:path';
import { importCsv } from './importCsv.js';
import { pool } from './db.js';

async function main() {
  const arg = process.argv[2];
  if (!arg) throw new Error('Usage: npm run import:csv -w apps/api -- data\\sample\\sample_gigs.csv');
  // npm runs inside apps/api, so resolve the path from where you typed the command
  const file = path.resolve(process.env.INIT_CWD ?? process.cwd(), arg);
  console.log('Importing', file);
  const r = await importCsv(file);
  console.log(`\nRun #${r.runId} finished: ${r.runStatus}`);
  console.log(`  rows in file : ${r.counts.total}`);
  console.log(`  new gigs     : ${r.counts.created}`);
  console.log(`  duplicates   : ${r.counts.duplicate}  (skipped)`);
  console.log(`  failed rows  : ${r.counts.failed}`);
  if (r.issues.length) {
    console.log('\nProblems found:');
    for (const i of r.issues) console.log(`  line ${i.row} [${i.severity}] ${i.field}: ${i.message}`);
  }
  await pool.end();
}

main().catch(async (e) => {
  console.error('IMPORT FAILED:', e.message);
  await pool.end();
  process.exit(1);
});
