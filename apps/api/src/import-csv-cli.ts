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
  const c = r.counts;
  console.log(`\nRun #${r.runId} finished: ${r.runStatus}`);
  console.log(`  rows in file        : ${c.total}`);
  console.log(`  new gigs            : ${c.created}   (flagged as look-alikes: ${c.similar})`);
  console.log(`  already known       : ${c.unchanged + c.updated + c.held + c.conflict}`);
  console.log(`     unchanged        : ${c.unchanged}`);
  console.log(`     updated (new version): ${c.updated}`);
  console.log(`     changes held for review: ${c.held}`);
  console.log(`     id/link conflicts: ${c.conflict}`);
  console.log(`  failed rows         : ${c.failed}`);
  if (r.notes.length) {
    console.log('\nWhat happened to known or similar gigs:');
    for (const n of r.notes) console.log('  ' + n);
  }
  const problems = r.issues.filter((i) => i.severity === 'error' || i.severity === 'warning');
  if (problems.length) {
    console.log('\nProblems found:');
    for (const i of problems) console.log(`  line ${i.row} [${i.severity}] ${i.field}: ${i.message}`);
  }
  await pool.end();
}

main().catch(async (e) => {
  console.error('IMPORT FAILED:', e.message);
  await pool.end();
  process.exit(1);
});
