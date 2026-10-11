import { pool } from './db.js';
import { verifyGig, verifyMany } from './verify.js';

async function main() {
  const mode = process.argv[2];
  if (mode === 'gig') {
    const id = Number(process.argv[3]);
    if (!id) throw new Error('Usage: npm run verify -w apps/api -- gig 5');
    console.log(await verifyGig(id, 'manual'));
  } else if (mode === 'all') {
    // every gig that has not been checked yet
    const [rows] = await pool.query("SELECT id FROM gigs WHERE workflow_state = 'discovered' ORDER BY id");
    const ids = (rows as { id: number }[]).map((r) => r.id);
    console.log(`Verifying ${ids.length} gigs (4 at a time)...`);
    const { results, failures } = await verifyMany(ids, 'discovery');
    results.sort((a, b) => a.gigId - b.gigId);
    console.log('\nid   gig          result        conf   why');
    for (const r of results) {
      console.log(`${String(r.gigId).padEnd(4)} ${(r.externalId ?? '-').padEnd(12)} ${r.status.padEnd(13)} ${r.confidence.toFixed(2)}   ${r.reasons[r.reasons.length - 1]}`);
    }
    const tally: Record<string, number> = {};
    for (const r of results) tally[r.status] = (tally[r.status] ?? 0) + 1;
    console.log('\nSummary:', tally, failures.length ? `| errors: ${failures.length}` : '');
    for (const f of failures) console.log(`  gig ${f.gigId} failed: ${f.message}`);
  } else {
    throw new Error('Usage: npm run verify -w apps/api -- all   (or: gig <id>)');
  }
  await pool.end();
}

main().catch(async (e) => { console.error('VERIFY FAILED:', e.message); await pool.end(); process.exit(1); });
