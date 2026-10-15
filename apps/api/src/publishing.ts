import type { PoolConnection } from 'mysql2/promise';
import { pool } from './db.js';
import { HttpError, missingRequired } from './review.js';
import { verifyGig, verifyMany } from './verify.js';
import { unpublishInTx } from './lifecycle.js';
import { createNotification, dispatch } from './notify.js';
import { CSV_COLUMNS } from './importCsv.js';

export type Check = { rule: string; ok: boolean; blocking: boolean; message: string };

async function setting(key: string, fallback: unknown) {
  const [rows] = await pool.query('SELECT value FROM settings WHERE key_name = ?', [key]);
  const v = (rows as any[])[0]?.value;
  return v === undefined ? fallback : v;
}
const isTrue = (v: unknown) => v === true || v === 'true';

// The publish gate: everything that must be true. The live "is it still open?" check runs separately, at publish time.
export async function readiness(gigId: number, userId: number | null = null) {
  const [rows] = await pool.query(
    'SELECT g.*, s.referral_required AS source_referral_required FROM gigs g JOIN sources s ON s.id = g.source_id WHERE g.id = ?', [gigId]);
  const g = (rows as any[])[0];
  if (!g) throw new HttpError(404, 'NOT_FOUND', 'Gig not found');
  const [refs] = await pool.query('SELECT 1 FROM referrals WHERE (gig_id = ? OR source_id = ?) AND is_active = 1 LIMIT 1', [gigId, g.source_id]);
  const hasReferral = (refs as unknown[]).length > 0;
  const referralRequired = g.source_referral_required === 1 || isTrue(await setting('publish.referral_mandatory_default', false));
  const differentPublisher = isTrue(await setting('publish.require_different_publisher', false));
  const missing = missingRequired(g);

  const checks: Check[] = [
    { rule: 'approved', blocking: true, ok: ['approved', 'publish_ready'].includes(g.workflow_state) && Boolean(g.approved_by),
      message: ['approved', 'publish_ready'].includes(g.workflow_state) ? 'A person approved this gig.' : `Not approved yet (stage: ${g.workflow_state}).` },
    { rule: 'required_fields', blocking: true, ok: missing.length === 0, message: missing.length === 0 ? 'All required fields are filled in.' : `Missing: ${missing.join(', ')}.` },
    { rule: 'referral', blocking: true, ok: !referralRequired || hasReferral,
      message: !referralRequired ? 'No referral needed for this source.' : hasReferral ? 'Referral supplied.' : 'A referral is required for this source and has not been entered.' },
    { rule: 'no_duplicates', blocking: true, ok: g.duplicate_state === 'none', message: g.duplicate_state === 'none' ? 'No unresolved duplicate.' : `Duplicate flag: ${g.duplicate_state}.` },
    { rule: 'no_held_changes', blocking: true, ok: !g.pending_source_changes, message: g.pending_source_changes ? 'The source changed this gig; accept or dismiss the changes first.' : 'No held source changes.' },
  ];
  if (differentPublisher) {
    const ok = userId === null || userId !== g.approved_by;
    checks.push({ rule: 'different_publisher', blocking: true, ok, message: ok ? 'Publisher differs from the approver.' : 'The person who approved this gig may not also publish it.' });
  }
  checks.push({ rule: 'live_status', blocking: false, ok: g.availability_status === 'active',
    message: `Last known status: ${g.availability_status}. It is checked again at the moment you publish.` });
  return { gigId, ready: checks.filter((c) => c.blocking).every((c) => c.ok), checks, gig: g };
}

function snapshotOf(g: Record<string, any>) {
  const snap: Record<string, unknown> = {};
  for (const c of CSV_COLUMNS) snap[c] = g[c] ?? null;
  snap.is_featured = Boolean(g.is_featured); snap.is_local_business = Boolean(g.is_local_business);
  return snap;
}

async function tx<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try { await conn.beginTransaction(); const r = await fn(conn); await conn.commit(); return r; }
  catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

export async function publishGig(gigId: number, userId: number) {
  // 1. The gate (PUB-01, PUB-03, REF-03)
  const r = await readiness(gigId, userId);
  const blocked = r.checks.filter((c) => c.blocking && !c.ok);
  if (blocked.length) throw new HttpError(409, 'BLOCKED', `Cannot publish: ${blocked.map((b) => b.message).join(' ')}`, { blockedBy: blocked });

  // 2. Check the opportunity again, right now (PUB-02)
  const v = await verifyGig(gigId, 'pre_publish', userId);
  const [after] = await pool.query('SELECT availability_status FROM gigs WHERE id = ?', [gigId]);
  const liveStatus = (after as any[])[0].availability_status as string;

  if (v.status !== 'active' || liveStatus !== 'active') {
    // Stale, closed, paused or unclear: return it to review and tell admins (NOT-02). Nothing becomes public.
    const reason = `The opportunity is no longer confirmed open (${v.status}): ${v.reasons[v.reasons.length - 1]}${v.humanPinned && liveStatus !== 'active' ? ` A person set the status to ${liveStatus}.` : ''}`;
    const ids = await tx(async (conn) => {
      await conn.query("UPDATE gigs SET workflow_state = 'review_pending', approved_by = NULL, approved_at = NULL WHERE id = ? AND workflow_state IN ('approved','publish_ready')", [gigId]);
      const [pub] = await conn.query(
        "INSERT INTO publications (gig_id, status, pre_publish_verification_id, snapshot, failure_reason) VALUES (?, 'failed', ?, ?, ?)",
        [gigId, v.verificationId, JSON.stringify(snapshotOf(r.gig)), reason.slice(0, 1000)]);
      await conn.query("INSERT INTO audit_log (entity_type, entity_id, action, actor_type, actor_user_id, details) VALUES ('gig', ?, 'publish_blocked', 'user', ?, ?)",
        [gigId, userId, JSON.stringify({ reason, verification: v.verificationId })]);
      return [await createNotification(conn, { gigId, publicationId: (pub as { insertId: number }).insertId, audience: 'admins', type: 'publish_failed', payload: { gigId, title: r.gig.title, reason } })];
    });
    await dispatch(ids);
    throw new HttpError(409, 'STALE', `${reason} The gig was sent back to Review Pending.`, { verification: v });
  }

  // 3. Publish, all or nothing (PUB-04, NOT-01)
  const done = await tx(async (conn) => {
    const [lock] = await conn.query('SELECT * FROM gigs WHERE id = ? FOR UPDATE', [gigId]);
    const g = (lock as any[])[0];
    if (!['approved', 'publish_ready'].includes(g.workflow_state) || g.availability_status !== 'active') {
      throw new HttpError(409, 'WRONG_STATE', 'The gig changed while publishing. Nothing was published; try again.');
    }
    const [pub] = await conn.query(
      "INSERT INTO publications (gig_id, status, pre_publish_verification_id, snapshot, published_by, published_at) VALUES (?, 'published', ?, ?, ?, NOW(3))",
      [gigId, v.verificationId, JSON.stringify(snapshotOf(g)), userId]);
    const publicationId = (pub as { insertId: number }).insertId;
    await conn.query("UPDATE gigs SET workflow_state = 'published' WHERE id = ?", [gigId]);
    await conn.query("INSERT INTO audit_log (entity_type, entity_id, action, actor_type, actor_user_id, details) VALUES ('gig', ?, 'published', 'user', ?, ?)",
      [gigId, userId, JSON.stringify({ publicationId, verification: v.verificationId })]);
    const [mod] = await conn.query('SELECT name FROM modules WHERE id = ?', [g.track_id]);
    const payload = {
      gigId, title: g.title, externalGigId: g.external_gig_id, track: g.track_id, moduleName: (mod as any[])[0]?.name,
      paymentAmount: g.payment_amount, postedAt: g.posted_at, publicPath: `/opportunities/${gigId}`, publishedBy: userId,
    };
    const ids = [
      await createNotification(conn, { gigId, publicationId, audience: 'site', type: 'published', payload: { ...payload, paths: ['/opportunities', `/opportunities/${gigId}`] } }),
      await createNotification(conn, { gigId, publicationId, audience: 'learners', type: 'published', payload }),
    ];
    return { publicationId, ids };
  });
  const delivery = await dispatch(done.ids);
  return { gigId, publicationId: done.publicationId, workflowState: 'published', notifications: delivery };
}

export async function unpublishGig(gigId: number, userId: number, reason: string) {
  if (!reason || reason.trim().length < 3) throw new HttpError(422, 'VALIDATION', 'A reason is required to unpublish');
  const ids = await tx(async (conn) => {
    const [lock] = await conn.query('SELECT workflow_state FROM gigs WHERE id = ? FOR UPDATE', [gigId]);
    const g = (lock as any[])[0];
    if (!g) throw new HttpError(404, 'NOT_FOUND', 'Gig not found');
    if (g.workflow_state !== 'published') throw new HttpError(409, 'WRONG_STATE', `Only published gigs can be unpublished (this one is ${g.workflow_state}).`);
    return unpublishInTx(conn, gigId, { userId, reason: reason.trim() });
  });
  return { gigId, workflowState: 'unpublished', notifications: await dispatch(ids) };
}

// Re-check every published gig (FRD workflow step 20). Clear closures go offline automatically; unclear results change nothing.
export async function healthSweep() {
  const [rows] = await pool.query("SELECT id, availability_status FROM gigs WHERE workflow_state = 'published' ORDER BY id");
  const before = new Map((rows as any[]).map((r) => [r.id as number, r.availability_status as string]));
  const { results, failures } = await verifyMany([...before.keys()], 'scheduled_health');
  const changes: { gigId: number; externalId: string | null; was: string; now: string; action: string }[] = [];
  for (const r of results) {
    const was = before.get(r.gigId)!;
    const action = r.unpublished ? 'unpublished (closed)' : r.status === 'needs_review' ? 'unclear, left as is' : r.status !== was ? `status ${was} to ${r.status}` : 'no change';
    if (r.status === 'paused' && was !== 'paused') {
      const conn = await pool.getConnection();
      try {
        const id = await createNotification(conn, { gigId: r.gigId, audience: 'admins', type: 'gig_status_changed', payload: { gigId: r.gigId, was, now: 'paused', reason: r.reasons[r.reasons.length - 1] } });
        await dispatch([id]);
      } finally { conn.release(); }
    }
    changes.push({ gigId: r.gigId, externalId: r.externalId, was, now: r.unpublished ? 'stopped' : r.status, action });
  }
  return { checked: results.length, unpublished: results.filter((r) => r.unpublished).length, failures, changes };
}
