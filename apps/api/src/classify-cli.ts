import { pool } from './db.js';
import { classifyAll, classifyGig } from './classify.js';
import { llmConfigured } from './llm.js';

function show(results: Awaited<ReturnType<typeof classifyAll>>) {
  console.log('\nid   gig          result          module  conf   how        why');
  for (const r of results) {
    console.log(`${String(r.gigId).padEnd(4)} ${(r.externalId ?? '-').padEnd(12)} ${r.outcome.padEnd(15)} ${(r.track ?? '-').padEnd(7)} ${r.confidence.toFixed(2)}   ${r.method.padEnd(9)}  ${r.why}`);
  }
  const assigned = results.filter((r) => r.outcome === 'auto_assigned').length;
  console.log(`\nSummary: ${assigned} assigned automatically, ${results.length - assigned} left for a human.`);
}

async function main() {
  console.log(llmConfigured() ? 'AI helper: ON (used only when keywords are not clear)' : 'AI helper: OFF (rules only)');
  const mode = process.argv[2];
  if (mode === 'all') show(await classifyAll());
  else if (mode === 'gig') {
    const r = await classifyGig(Number(process.argv[3]));
    if (!r) console.log('That gig already has a module (or does not exist); nothing changed.'); else show([r]);
  } else throw new Error('Usage: npm run classify -w apps/api -- all   (or: gig <id>)');
  await pool.end();
}
main().catch(async (e) => { console.error('CLASSIFY FAILED:', e.message); await pool.end(); process.exit(1); });
