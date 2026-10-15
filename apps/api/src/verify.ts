import './config.js'; // loads .env
import * as cheerio from 'cheerio';
import { createRequire } from 'node:module';
import { pool } from './db.js';
import { tokens, jaccard } from './similarity.js';
import { unpublishInTx } from './lifecycle.js';
import { dispatch } from './notify.js';

// robots-parser is an older-style package, so we load it this way to keep TypeScript happy
type RobotsRules = { isAllowed(url: string, userAgent?: string): boolean | undefined };
const robotsParser = createRequire(import.meta.url)('robots-parser') as (url: string, text: string) => RobotsRules;

const TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS ?? 15000);
const USER_AGENT = process.env.DISCOVERY_USER_AGENT ?? 'UpShiftGigBot/1.0';
const MAX_BYTES = Number(process.env.RAW_CONTENT_MAX_BYTES ?? 262144);

type Restriction = 'none' | 'login_required' | 'captcha' | 'paywall' | 'robots_disallowed' | 'rate_limited';
type Status = 'active' | 'paused' | 'stopped' | 'needs_review';
type Signal = 'open' | 'closed' | 'paused' | 'unclear';
type Evidence = { type: string; field?: string; value?: string | null; excerpt?: string | null; locator?: string; confidence?: number };
type Trigger = 'discovery' | 'scheduled_health' | 'manual' | 'pre_publish';

type Page = {
  reachable: boolean; status: number | null; finalUrl: string | null; ms: number;
  html: string | null; error: string | null; restriction: Restriction;
};
type Decision = {
  status: Status; confidence: number; signal: Signal; matches: boolean | null;
  restriction: Restriction; reasons: string[]; evidence: Evidence[]; outcome: 'completed' | 'error'; error: string | null;
  pageText: string | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

// ---------- 1. Polite fetching: robots.txt + rate limit + timeout ----------
const robotsCache = new Map<string, RobotsRules | null>();

async function robotsAllows(u: URL): Promise<boolean> {
  if (!robotsCache.has(u.origin)) {
    try {
      const res = await fetch(`${u.origin}/robots.txt`, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(5000) });
      robotsCache.set(u.origin, res.ok ? robotsParser(`${u.origin}/robots.txt`, await res.text()) : null);
    } catch {
      robotsCache.set(u.origin, null);
    }
  }
  const rules = robotsCache.get(u.origin);
  return rules ? rules.isAllowed(u.toString(), 'UpShiftGigBot') !== false : true;
}

const hostChain = new Map<string, Promise<void>>();
async function throttle(host: string, perMinute: number) {
  const gap = Math.ceil(60000 / Math.max(1, perMinute));
  const prev = hostChain.get(host) ?? Promise.resolve();
  let release!: () => void;
  hostChain.set(host, prev.then(() => new Promise<void>((r) => (release = r))));
  await prev;
  setTimeout(() => release?.(), gap);
}

function restrictionForStatus(status: number): Restriction {
  if (status === 401 || status === 403) return 'login_required';
  if (status === 429) return 'rate_limited';
  return 'none';
}

async function fetchPage(url: string, perMinute: number): Promise<Page> {
  const blank: Page = { reachable: false, status: null, finalUrl: null, ms: 0, html: null, error: null, restriction: 'none' };
  let u: URL;
  try { u = new URL(url); } catch { return { ...blank, error: 'Invalid URL' }; }

  if (!(await robotsAllows(u))) return { ...blank, restriction: 'robots_disallowed', error: 'Blocked by robots.txt (not fetched)' };
  await throttle(u.host, perMinute);

  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.text();
    return { reachable: true, status: res.status, finalUrl: res.url, ms: Date.now() - t0, html: body.slice(0, MAX_BYTES), error: null, restriction: restrictionForStatus(res.status) };
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    // Node's message is just "fetch failed"; the real reason (e.g. ECONNREFUSED) is in err.cause
    const reason = err.cause?.code ?? err.cause?.message ?? err.message;
    return { ...blank, ms: Date.now() - t0, error: timedOut ? `Timed out after ${TIMEOUT_MS} ms` : `Network error: ${reason}` };
  }
}

// ---------- 2. Reading the page ----------
// "not" and "no longer" in front of a phrase turn it into the opposite, so we exclude those.
const CLOSED = /(no longer (accepting|available|open)|has been filled|position (is )?filled|applications? (are |is )?closed|(job|position|role|opportunity|gig) (is |has )?(closed|expired|been removed)|\bexpired\b)/i;
const PAUSED = /(temporarily (paused|unavailable|closed)|applications? (are |is )?(temporarily )?(paused|on hold)|waitlist|check back later|not accepting (new )?applications? (right now|at the moment))/i;
const OPEN = /((?<!no longer )(?<!not )accepting (new )?applications?|(?<!not )open for applications?|applications? (are |is )?open)/i;
const LOGIN = /(log ?in|sign ?in) to (view|continue|see)/i;
const CAPTCHA = /captcha|verify (that )?you are (a )?human/i;
const PAYWALL = /(subscribe|upgrade) to (view|continue|unlock)|members only/i;

// A verbatim piece of the page around a match, so a person can see the proof.
function excerptOf(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  if (!m) return null;
  const start = Math.max(0, m.index - 60);
  let piece = text.slice(start, Math.min(text.length, m.index + m[0].length + 60));
  if (start > 0) piece = piece.replace(/^\S*\s/, ''); // do not start in the middle of a word
  return piece;
}

type GigRow = { id: number; external_gig_id: string | null; title: string | null; posted_at: string | null; payment_amount: string | null };

function analyze(g: GigRow, page: Page, th: { activeMin: number; reviewBelow: number }): Decision {
  const base = { matches: null as boolean | null, restriction: page.restriction, reasons: [] as string[], evidence: [] as Evidence[], outcome: 'completed' as const, error: null as string | null, pageText: null as string | null };
  const done = (status: Status, confidence: number, signal: Signal, extra: Partial<Decision> & { reason: string }): Decision => {
    const { reason, ...rest } = extra;
    return { ...base, status, confidence: round3(confidence), signal, ...rest, reasons: [...(rest.reasons ?? base.reasons), reason] };
  };

  // Problems before we even have a page
  if (page.restriction === 'robots_disallowed') {
    return done('needs_review', 0.2, 'unclear', { reason: 'robots.txt does not allow automated access, so the page was not fetched', evidence: [{ type: 'url_check', field: 'robots', value: 'disallowed' }] });
  }
  if (!page.reachable) {
    return { ...done('needs_review', 0.1, 'unclear', { reason: page.error ?? 'Page could not be reached', evidence: [{ type: 'url_check', field: 'error', value: page.error }] }), outcome: 'error', error: page.error };
  }
  const urlEvidence: Evidence = { type: 'url_check', field: 'http_status', value: `HTTP ${page.status} in ${page.ms} ms`, locator: page.finalUrl ?? undefined };
  const status = page.status!;
  if (status === 404 || status === 410) return done('stopped', 0.8, 'closed', { reason: `The page returned HTTP ${status} (removed)`, evidence: [urlEvidence] });
  if (page.restriction !== 'none') return done('needs_review', 0.2, 'unclear', { reason: `Access restricted (HTTP ${status}); not bypassed`, evidence: [urlEvidence] });
  if (status >= 500) return done('needs_review', 0.3, 'unclear', { reason: `Server error (HTTP ${status}); cannot tell`, evidence: [urlEvidence] });
  if (status >= 400) return done('needs_review', 0.2, 'unclear', { reason: `Unexpected HTTP ${status}`, evidence: [urlEvidence] });

  // We have a page: read it
  const $ = cheerio.load(page.html ?? '');
  $('script, style, noscript').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  const heading = ($('h1').first().text() || $('title').text()).replace(/\s+/g, ' ').trim();
  const evidence: Evidence[] = [urlEvidence];

  // Walls we must not bypass
  const wall: Restriction = LOGIN.test(text) ? 'login_required' : CAPTCHA.test(text) ? 'captcha' : PAYWALL.test(text) ? 'paywall' : 'none';
  if (wall !== 'none') {
    const re = wall === 'login_required' ? LOGIN : wall === 'captcha' ? CAPTCHA : PAYWALL;
    evidence.push({ type: 'page_excerpt', field: wall, excerpt: excerptOf(text, re) });
    return { ...done('needs_review', 0.2, 'unclear', { reason: `The page asks for ${wall.replace('_', ' ')}; not bypassed`, evidence }), restriction: wall, pageText: text };
  }

  // Is this page really about this gig?
  const mine = (g.title ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const theirs = heading.toLowerCase();
  const score = !mine ? 0.5 : theirs.includes(mine) || mine.includes(theirs) ? 1 : jaccard(tokens(mine), tokens(theirs));
  const matches = score >= 0.6;
  evidence.push({ type: 'title_match', field: 'title', value: heading, excerpt: `gig title: "${g.title}" | page title: "${heading}"`, confidence: round3(score) });

  // Extra facts (evidence only, never copied into the gig automatically)
  const pagePosted = $('[data-field="posted"]').first().text().trim();
  if (pagePosted) {
    evidence.push({ type: 'posted_date', field: 'posted_at', value: pagePosted });
    if (g.posted_at && g.posted_at !== pagePosted) base.reasons.push(`Posted date differs: stored ${g.posted_at}, page ${pagePosted}`);
  }
  const pagePay = $('[data-field="pay"]').first().text().trim();
  if (pagePay) {
    evidence.push({ type: 'compensation', field: 'payment_amount', value: pagePay });
    if (g.payment_amount && g.payment_amount !== pagePay) base.reasons.push(`Pay differs: stored "${g.payment_amount}", page "${pagePay}"`);
  }

  const common = { matches, evidence, pageText: text, reasons: [...base.reasons] };
  if (!matches) {
    return done('needs_review', 0.3, 'unclear', { ...common, reason: 'The page does not look like this gig (title mismatch)' });
  }

  // Availability signals
  const closed = CLOSED.test(text);
  const paused = PAUSED.test(text);
  const openText = OPEN.test(text);
  const applyButton = $('a, button').filter((_, el) => /\bapply\b/i.test($(el).text())).length > 0;
  if (closed) evidence.push({ type: 'closed_marker', excerpt: excerptOf(text, CLOSED) });
  if (paused) evidence.push({ type: 'paused_marker', excerpt: excerptOf(text, PAUSED) });
  if (openText) evidence.push({ type: 'availability_marker', field: 'text', excerpt: excerptOf(text, OPEN) });
  if (applyButton) evidence.push({ type: 'availability_marker', field: 'apply_button', value: 'An "Apply" link or button is on the page' });

  if ((closed || paused) && (openText || applyButton)) {
    return done('needs_review', 0.4, 'unclear', { ...common, reason: 'The page gives conflicting signals (open and closed/paused)' });
  }
  const strong = round3(0.55 + 0.35 * score);
  if (closed) return done('stopped', strong, 'closed', { ...common, reason: 'The page says the opportunity is closed' });
  if (paused) return done('paused', strong, 'paused', { ...common, reason: 'The page says applications are paused' });

  const strength = openText && applyButton ? 1 : openText || applyButton ? 0.6 : 0;
  const confidence = round3(0.2 + 0.3 * score + 0.5 * strength);
  if (strength === 1 && confidence >= th.activeMin) {
    return done('active', confidence, 'open', { ...common, reason: 'Page matches the gig, says it accepts applications, and has an Apply button' });
  }
  if (strength > 0) {
    return done('needs_review', confidence, 'unclear', { ...common, reason: 'Only one sign that it is open (text or Apply button); not enough for Active' });
  }
  return done('needs_review', confidence, 'unclear', { ...common, reason: 'The page gives no clear sign of whether applications are open' });
}

// ---------- 3. Verify one gig and save the evidence ----------
export async function verifyGig(gigId: number, trigger: Trigger = 'manual', userId: number | null = null) {
  const [rows] = await pool.query(
    `SELECT g.id, g.external_gig_id, g.title, g.posted_at, g.payment_amount, g.origin_url, g.source_id, g.availability_set_by, g.workflow_state,
            s.rate_limit_per_minute FROM gigs g JOIN sources s ON s.id = g.source_id WHERE g.id = ?`, [gigId]);
  const gig = (rows as any[])[0];
  if (!gig) throw new Error(`Gig ${gigId} not found`);

  const [setRows] = await pool.query("SELECT key_name, value FROM settings WHERE key_name IN ('verification.confidence_active_min','verification.confidence_review_below')");
  const set = Object.fromEntries((setRows as any[]).map((r) => [r.key_name, Number(r.value)]));
  const th = { activeMin: set['verification.confidence_active_min'] ?? 0.85, reviewBelow: set['verification.confidence_review_below'] ?? 0.6 };

  const t0 = Date.now();
  const page = await fetchPage(gig.origin_url, gig.rate_limit_per_minute);
  const d = analyze(gig, page, th);
  // Below the review threshold we never trust a positive result
  if (d.status === 'active' && d.confidence < th.reviewBelow) { d.status = 'needs_review'; d.reasons.push('Confidence too low'); }

  let notifyIds: number[] = [];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [ins] = await conn.query(
      `INSERT INTO verifications (gig_id, trigger_type, checked_at, url_reachable, http_status, final_url, access_restriction,
         page_matches_opportunity, availability_signal, result_status, confidence, reasons, outcome, error_message, duration_ms)
       VALUES (?, ?, NOW(3), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [gigId, trigger, page.reachable ? 1 : 0, page.status, page.finalUrl, d.restriction, d.matches === null ? null : d.matches ? 1 : 0,
       d.signal, d.status, d.confidence, JSON.stringify(d.reasons), d.outcome, d.error?.slice(0, 1000) ?? null, Date.now() - t0]);
    const vid = (ins as { insertId: number }).insertId;
    for (const e of d.evidence) {
      await conn.query(
        'INSERT INTO verification_evidence (verification_id, gig_id, evidence_type, field_name, extracted_value, excerpt, locator, is_ai_generated, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
        [vid, gigId, e.type, e.field ?? null, e.value ?? null, e.excerpt ?? null, e.locator ?? null, e.confidence ?? null]);
    }
    if (d.pageText) {
      await conn.query('INSERT INTO raw_extracts (gig_id, source_id, fetched_url, final_url, http_status, content_type, raw_content) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [gigId, gig.source_id, gig.origin_url, page.finalUrl, page.status, 'text/plain', d.pageText.slice(0, MAX_BYTES)]);
    }
    const pinned = gig.availability_set_by === 'human';
    // A published gig is treated carefully: it goes offline only on clear proof (closed).
    // An unclear result (timeout, login wall...) is recorded but never takes a live gig down.
    const isPublished = gig.workflow_state === 'published';
    const goOffline = isPublished && d.status === 'stopped';
    const keepStatus = isPublished && d.status === 'needs_review';
    const setStatus = !goOffline && !keepStatus;
    await conn.query(
      `UPDATE gigs SET ${setStatus ? "availability_status = IF(availability_set_by = 'system', ?, availability_status)," : ''}
         verification_confidence = ?, last_verified_at = NOW(3), latest_verification_id = ?,
         workflow_state = IF(workflow_state = 'discovered', 'review_pending', workflow_state) WHERE id = ?`,
      setStatus ? [d.status, d.confidence, vid, gigId] : [d.confidence, vid, gigId]);
    if (goOffline) notifyIds = await unpublishInTx(conn, gigId, { userId: null, reason: `Closed (found by a ${trigger} check): ${d.reasons[d.reasons.length - 1]}`, availability: 'stopped' });
    await conn.query(
      "INSERT INTO audit_log (entity_type, entity_id, action, actor_type, actor_user_id, details) VALUES ('gig', ?, 'verified', ?, ?, ?)",
      [gigId, userId ? 'user' : 'verification_engine', userId, JSON.stringify({ trigger, result: d.status, confidence: d.confidence, human_pinned: pinned })]);
    await conn.commit();
    if (notifyIds.length) await dispatch(notifyIds); // tell the website and admins after the change is saved
    return { unpublished: goOffline, gigId, externalId: gig.external_gig_id as string | null, verificationId: vid, status: d.status, confidence: d.confidence, signal: d.signal, restriction: d.restriction, reasons: d.reasons, humanPinned: pinned };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ---------- 4. Verify many gigs, a few at a time. One failure never stops the others. ----------
export async function verifyMany(ids: number[], trigger: Trigger = 'discovery', concurrency = 4) {
  const results: Awaited<ReturnType<typeof verifyGig>>[] = [];
  const failures: { gigId: number; message: string }[] = [];
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const id = ids[next++];
      try { results.push(await verifyGig(id, trigger)); }
      catch (e) { failures.push({ gigId: id, message: (e as Error).message }); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return { results, failures };
}
