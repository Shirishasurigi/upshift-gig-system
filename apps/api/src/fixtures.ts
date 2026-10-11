import type { FastifyInstance } from 'fastify';
import { pool } from './db.js';

// Our OWN fake job pages, used to test verification without touching any real website.
// Each gig's page behaves according to its "state". Default state is "open".
export type FixtureState = 'open' | 'closed' | 'paused' | 'thin' | 'login' | 'captcha' | 'wrong' | 'gone' | 'slow';
const VALID: FixtureState[] = ['open', 'closed', 'paused', 'thin', 'login', 'captcha', 'wrong', 'gone', 'slow'];

const states = new Map<string, FixtureState>([
  ['GIG-DA-202', 'closed'],   // closed       -> expect Stopped
  ['GIG-CD-303', 'paused'],   // paused       -> expect Paused
  ['GIG-AU-503', 'thin'],     // no signals   -> expect Needs Review
  ['GIG-ED-604', 'thin'],     // no signals   -> expect Needs Review
  ['GIG-MK-403', 'login'],    // login wall   -> expect Needs Review (never bypassed)
  ['GIG-VF-103', 'captcha'],  // captcha      -> expect Needs Review (never bypassed)
  ['GIG-VF-104', 'wrong'],    // other job    -> expect Needs Review
  ['GIG-CD-302', 'gone'],     // HTTP 410     -> expect Stopped
  ['GIG-AU-502', 'slow'],     // too slow     -> expect Needs Review (timeout is not "stopped")
]);

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fixtureRoutes(app: FastifyInstance) {
  // Polite crawlers read this first. Our verifier obeys it.
  app.get('/robots.txt', async (_req, reply) => {
    reply.type('text/plain');
    return 'User-agent: *\nDisallow: /fixtures/private/\nAllow: /fixtures/\n';
  });

  app.get('/fixtures/gigs/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const [rows] = await pool.query('SELECT title, payment_amount, posted_at, short_description FROM gigs WHERE external_gig_id = ?', [slug]);
    const gig = (rows as any[])[0];
    if (!gig) return reply.code(404).type('text/html').send('<h1>Not found</h1>');

    const state = states.get(slug) ?? 'open';
    if (state === 'gone') return reply.code(410).type('text/html').send('<h1>Gone</h1><p>This page was removed.</p>');
    if (state === 'login') return reply.type('text/html').send('<html><body><h1>Sign in</h1><p>Please log in to view this opportunity.</p></body></html>');
    if (state === 'captcha') return reply.type('text/html').send('<html><body><h1>Checking your browser</h1><p>Please verify you are human to continue. CAPTCHA</p></body></html>');
    if (state === 'slow') await sleep(20000);

    const title = state === 'wrong' ? 'Senior Plumbing Technician' : gig.title;
    const open = `<p>We are accepting applications for this role.</p><a class="apply-button" href="/fixtures/apply/${esc(slug)}">Apply now</a>`;
    const block =
      state === 'closed' ? '<p>This position has been filled and is no longer accepting applications.</p>'
      : state === 'paused' ? '<p>Applications are temporarily paused. Please check back later.</p>'
      : state === 'thin' ? ''
      : open;

    reply.type('text/html');
    return `<!doctype html><html><head><title>${esc(title)} | Test Jobs</title></head><body>
<h1>${esc(title)}</h1>
${gig.posted_at ? `<p>Posted: <span data-field="posted">${esc(gig.posted_at)}</span></p>` : ''}
${gig.payment_amount ? `<p>Pay: <span data-field="pay">${esc(gig.payment_amount)}</span></p>` : ''}
<p>${esc(gig.short_description)}</p>
${block}
</body></html>`;
  });

  // Development helper: change how a gig's page behaves (used to test "approved, then it closed")
  app.put('/fixtures/state/:slug', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') return reply.code(404).send({ error: 'not found' });
    const { slug } = request.params as { slug: string };
    const { state } = (request.body ?? {}) as { state?: string };
    if (!state || !VALID.includes(state as FixtureState)) {
      return reply.code(400).send({ error: `state must be one of: ${VALID.join(', ')}` });
    }
    states.set(slug, state as FixtureState);
    return { slug, state };
  });
}
