import type { PoolConnection } from 'mysql2/promise';
import { pool } from './db.js';
import { cleanText, cleanList, parseDate, parseMoney, parseInteger, fingerprint } from './normalize.js';
import { verifyGig } from './verify.js';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

async function tx<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const r = await fn(conn);
    await conn.commit();
    return r;
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

async function lockGig(conn: PoolConnection, id: number): Promise<Record<string, any>> {
  const [rows] = await conn.query('SELECT * FROM gigs WHERE id = ? FOR UPDATE', [id]);
  const g = (rows as any[])[0];
  if (!g) throw new HttpError(404, 'NOT_FOUND', 'Gig not found');
  return g;
}

const EDITABLE = ['title', 'payment_amount', 'compensation_type', 'min_amount', 'max_amount', 'currency', 'priority', 'is_featured',
  'is_local_business', 'posted_at', 'short_description', 'overview', 'responsibilities', 'deliverables', 'requirements', 'proof_spec'];
const LIST_FIELDS = ['responsibilities', 'deliverables', 'requirements', 'proof_spec'];
const NUMERIC = new Set(['min_amount', 'max_amount', 'priority', 'is_featured', 'is_local_business', 'track_confidence']);
const COMP_TYPES = ['hourly', 'fixed', 'per_task', 'monthly', 'other'];
const REQUIRED = ['title', 'track_id', 'short_description', 'overview', 'origin_url'];
const IN_APPROVED = ['approved', 'publish_ready'];

export const missingRequired = (g: Record<string, any>) => REQUIRED.filter((f) => !g[f]);

// ---------- Validation of human edits ----------
function validateEdit(body: Record<string, unknown>) {
  const values: Record<string, unknown> = {}; const errors: { field: string; message: string }[] = [];
  for (const [k, v] of Object.entries(body)) {
    const bad = (m: string) => errors.push({ field: k, message: m });
    if (!EDITABLE.includes(k)) { bad(k === 'track_id' ? 'change the module with the reclassify action' : 'this field cannot be edited'); continue; }
    if (v === null && ['title', 'priority', 'is_featured', 'is_local_business'].includes(k)) { bad('cannot be empty'); continue; }
    if (v === null) { values[k] = null; continue; }
    switch (k) {
      case 'title': { const t = typeof v === 'string' ? cleanText(v) : null; if (!t) bad('required'); else if (t.length > 255) bad('max 255 characters'); else values[k] = t; break; }
      case 'payment_amount': { const t = typeof v === 'string' ? cleanText(v) : null; if (t && t.length > 120) bad('max 120 characters'); else values[k] = t; break; }
      case 'short_description': { const t = typeof v === 'string' ? cleanText(v) : null; if (t && t.length > 500) bad('max 500 characters'); else values[k] = t; break; }
      case 'overview': { const t = typeof v === 'string' ? cleanText(v) : null; if (t && t.length > 20000) bad('too long'); else values[k] = t; break; }
      case 'compensation_type': if (typeof v === 'string' && COMP_TYPES.includes(v)) values[k] = v; else bad(`must be one of ${COMP_TYPES.join(', ')}`); break;
      case 'min_amount': case 'max_amount': { const r = parseMoney(String(v)); if ('error' in r) bad(r.error); else values[k] = r.value; break; }
      case 'priority': { const r = parseInteger(String(v)); if ('error' in r) bad(r.error); else values[k] = r.value; break; }
      case 'currency': if (typeof v === 'string' && /^[A-Za-z]{3}$/.test(v)) values[k] = v.toUpperCase(); else bad('must be a 3-letter code like USD'); break;
      case 'is_featured': case 'is_local_business': if (typeof v === 'boolean') values[k] = v ? 1 : 0; else bad('must be true or false'); break;
      case 'posted_at': { const r = parseDate(String(v)); if ('error' in r) bad(r.error); else values[k] = r.value; break; }
      default: if (LIST_FIELDS.includes(k)) {
        const raw = Array.isArray(v) ? v.map(String).join('|') : typeof v === 'string' ? v : null;
        if (raw === null) bad('must be text or a list'); else values[k] = cleanList(raw);
      }
    }
  }
  return { values, errors };
}

const same = (f: string, a: unknown, b: unknown) => (NUMERIC.has(f) ? Number(a) === Number(b) : String(a ?? '') === String(b ?? ''));

// ---------- The one place where a gig's content changes ----------
async function applyChanges(
  conn: PoolConnection, g: Record<string, any>, userId: number, values: Record<string, unknown>,
  action: 'edit' | 'reclassify' | 'accept_source_changes', note: string | null, extraSets: { sql: string; val: unknown }[] = [],
) {
  if (g.workflow_state === 'published') throw new HttpError(409, 'PUBLISHED', 'This gig is published. Unpublish it before changing it.');
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  for (const [k, v] of Object.entries(values)) if (!same(k, g[k], v)) changes[k] = { old: g[k] ?? null, new: v };
  const keys = Object.keys(changes);
  if (keys.length === 0) return { changed: [] as string[], version: g.current_version, workflowState: g.workflow_state as string };

  const merged = { ...g, ...Object.fromEntries(keys.map((k) => [k, changes[k].new])) };
  if (merged.min_amount !== null && merged.max_amount !== null && Number(merged.min_amount) > Number(merged.max_amount)) {
    throw new HttpError(422, 'VALIDATION', 'Validation failed', [{ field: 'min_amount', message: 'min_amount is bigger than max_amount' }]);
  }
  const provenance = { ...(g.field_provenance ?? {}) } as Record<string, string>;
  for (const k of keys) provenance[k] = 'human';
  const missing = missingRequired(merged).filter((f) => f !== 'origin_url');
  const sets = keys.map((k) => `${k} = ?`); const vals: unknown[] = keys.map((k) => changes[k].new);
  if (keys.includes('posted_at')) sets.push(`posted_at_status = '${changes.posted_at.new ? 'found' : 'not_found'}'`);
  for (const e of extraSets) { sets.push(e.sql); vals.push(e.val); }

  // Editing an approved gig means it must be approved again
  const reopen = IN_APPROVED.includes(g.workflow_state);
  const toState = reopen ? 'review_pending' : g.workflow_state;
  await conn.query(
    `UPDATE gigs SET ${sets.join(', ')}, field_provenance = ?, missing_fields = ?, data_completeness = ?, content_fingerprint = ?,
       current_version = current_version + 1, workflow_state = ?${reopen ? ', approved_by = NULL, approved_at = NULL' : ''} WHERE id = ?`,
    [...vals, JSON.stringify(provenance), JSON.stringify(missing), missing.length === 0 ? 'complete' : 'partial',
     fingerprint([merged.title, merged.short_description, merged.overview, merged.payment_amount, merged.responsibilities, merged.deliverables, merged.requirements, merged.proof_spec]),
     toState, g.id]);
  await conn.query(
    "INSERT INTO gig_versions (gig_id, version_no, change_origin, changed_by, changed_fields, snapshot) VALUES (?, ?, 'reviewer', ?, ?, ?)",
    [g.id, g.current_version + 1, userId, JSON.stringify(changes), JSON.stringify(Object.fromEntries(Object.keys({ ...values }).map((k) => [k, (merged as any)[k]])))]);
  await conn.query(
    'INSERT INTO reviews (gig_id, reviewer_id, action, from_workflow_state, to_workflow_state, field_changes, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [g.id, userId, action, g.workflow_state, toState, JSON.stringify(changes), note]);
  await conn.query("INSERT INTO audit_log (entity_type, entity_id, action, actor_type, actor_user_id, details) VALUES ('gig', ?, ?, 'user', ?, ?)",
    [g.id, action, userId, JSON.stringify({ fields: keys, reopened_for_approval: reopen })]);
  return { changed: keys, version: g.current_version + 1, workflowState: toState as string };
}

export async function editGig(gigId: number, userId: number, body: Record<string, unknown>, note: string | null) {
  const { values, errors } = validateEdit(body);
  if (errors.length) throw new HttpError(422, 'VALIDATION', 'Validation failed', errors);
  if (Object.keys(values).length === 0) throw new HttpError(400, 'BAD_REQUEST', 'No fields to change');
  return tx(async (conn) => applyChanges(conn, await lockGig(conn, gigId), userId, values, 'edit', note));
}

export async function reclassifyGig(gigId: number, userId: number, trackId: string, note: string | null) {
  const [mods] = await pool.query('SELECT id FROM modules WHERE id = ? AND is_active = 1', [trackId]);
  if ((mods as any[]).length === 0) throw new HttpError(422, 'VALIDATION', 'Validation failed', [{ field: 'trackId', message: 'must be M1 to M6' }]);
  return tx(async (conn) => {
    const g = await lockGig(conn, gigId);
    const r = await applyChanges(conn, g, userId, { track_id: trackId }, 'reclassify', note, [{ sql: 'track_confidence = ?', val: 1 }]);
    if (r.changed.length) {
      await conn.query("UPDATE gigs SET track_set_by = 'human' WHERE id = ?", [gigId]);
      await conn.query(
        "INSERT INTO ai_classifications (gig_id, proposed_track_id, confidence, rationale, model, prompt_version, outcome) VALUES (?, ?, 1, ?, 'human', 'n/a', 'overridden_by_human')",
        [gigId, trackId, note ?? 'Chosen by a reviewer']);
    }
    return r;
  });
}

// ---------- Approve / reject / reopen / pause / stop / resume ----------
export async function transition(gigId: number, userId: number, action: 'approve' | 'reject' | 'reopen' | 'pause' | 'stop' | 'resume', note: string | null) {
  const result = await tx(async (conn) => {
    const g = await lockGig(conn, gigId);
    const from = g.workflow_state as string; const fromAv = g.availability_status as string;
    let to = from; let toAv = fromAv;
    const needsUnpublish = () => { if (from === 'published') throw new HttpError(409, 'PUBLISHED', 'This gig is published. Unpublish it first.'); };

    if (action === 'approve') {
      if (from !== 'review_pending') throw new HttpError(409, 'WRONG_STATE', `Only gigs in review_pending can be approved (this one is ${from}).`);
      const missing = missingRequired(g);
      if (missing.length) throw new HttpError(409, 'MISSING_FIELDS', `Fill in these fields before approving: ${missing.join(', ')}`, { missing });
      if (g.availability_status === 'stopped') throw new HttpError(409, 'STOPPED', 'A stopped opportunity cannot be approved.');
      if (g.duplicate_state === 'suspected') throw new HttpError(409, 'DUPLICATE_OPEN', 'Resolve the suspected duplicate before approving.');
      to = 'approved';
    } else if (action === 'reject') {
      needsUnpublish();
      if (!note || note.trim().length < 3) throw new HttpError(422, 'VALIDATION', 'A reason (note) is required to reject');
      if (from === 'rejected') throw new HttpError(409, 'WRONG_STATE', 'Already rejected.');
      to = 'rejected';
    } else if (action === 'reopen') {
      needsUnpublish();
      if (!['rejected', 'approved', 'publish_ready', 'unpublished'].includes(from)) throw new HttpError(409, 'WRONG_STATE', `Cannot reopen a gig that is ${from}.`);
      to = 'review_pending';
    } else if (action === 'pause' || action === 'stop') {
      needsUnpublish();
      toAv = action === 'pause' ? 'paused' : 'stopped';
      if (IN_APPROVED.includes(from)) to = 'review_pending'; // approval no longer valid
    } else if (action === 'resume') {
      needsUnpublish();
      if (g.availability_set_by !== 'human') throw new HttpError(409, 'WRONG_STATE', 'The status was not set by a person; nothing to release.');
    }

    const leavingApproval = ['reject', 'reopen'].includes(action) && IN_APPROVED.includes(from);
    const stopsApproved = (action === 'pause' || action === 'stop') && IN_APPROVED.includes(from);
    await conn.query(
      `UPDATE gigs SET workflow_state = ?, availability_status = ?,
         availability_set_by = ${action === 'pause' || action === 'stop' ? "'human'" : action === 'resume' ? "'system'" : 'availability_set_by'}
         ${action === 'approve' ? ', approved_by = ?, approved_at = NOW(3)' : leavingApproval || stopsApproved ? ', approved_by = NULL, approved_at = NULL' : ''}
       WHERE id = ?`,
      action === 'approve' ? [to, toAv, userId, gigId] : [to, toAv, gigId]);
    const finalState = to;
    await conn.query(
      'INSERT INTO reviews (gig_id, reviewer_id, action, from_workflow_state, to_workflow_state, from_availability, to_availability, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [gigId, userId, action, from, finalState, fromAv, toAv, note]);
    await conn.query("INSERT INTO audit_log (entity_type, entity_id, action, actor_type, actor_user_id, details) VALUES ('gig', ?, ?, 'user', ?, ?)",
      [gigId, action, userId, JSON.stringify({ from, to: finalState, availability: toAv })]);
    return { gigId, action, workflowState: finalState, availability: toAv };
  });
  // Releasing a person's status hands control back to the engine, which checks the page again now
  if (action === 'resume') {
    const v = await verifyGig(gigId, 'manual', userId);
    return { ...result, availability: v.status, reverified: true };
  }
  return result;
}

// ---------- Changes the source made that were held back (Block 1.5) ----------
export async function resolvePending(gigId: number, userId: number, decision: 'accept' | 'dismiss', note: string | null) {
  return tx(async (conn) => {
    const g = await lockGig(conn, gigId);
    const pending = g.pending_source_changes as { reason: string; changes: Record<string, { new: unknown }> } | null;
    if (!pending) throw new HttpError(409, 'NOTHING_PENDING', 'This gig has no held source changes.');
    if (decision === 'dismiss') {
      await conn.query('UPDATE gigs SET pending_source_changes = NULL WHERE id = ?', [gigId]);
      await conn.query('INSERT INTO reviews (gig_id, reviewer_id, action, from_workflow_state, to_workflow_state, note) VALUES (?, ?, ?, ?, ?, ?)',
        [gigId, userId, 'dismiss_source_changes', g.workflow_state, g.workflow_state, note]);
      return { gigId, decision, applied: [] as string[] };
    }
    if (pending.reason === 'same_external_id_different_url') {
      throw new HttpError(409, 'NOT_ACCEPTABLE', 'A different link with the same id cannot be accepted automatically. Dismiss it, or edit the gig by hand.');
    }
    const values: Record<string, unknown> = {};
    for (const [k, c] of Object.entries(pending.changes)) if (EDITABLE.includes(k) || k === 'track_id') values[k] = (c as { new: unknown }).new;
    const r = await applyChanges(conn, g, userId, values, 'accept_source_changes', note);
    await conn.query('UPDATE gigs SET pending_source_changes = NULL WHERE id = ?', [gigId]);
    return { gigId, decision, applied: r.changed, workflowState: r.workflowState };
  });
}

// ---------- Referral (entered by a human only) ----------
export async function setReferral(gigId: number, userId: number, type: string, value: string) {
  const v = (value ?? '').trim();
  const errors: { field: string; message: string }[] = [];
  if (!['id', 'link'].includes(type)) errors.push({ field: 'type', message: 'must be id or link' });
  else if (type === 'id' && !/^[A-Za-z0-9._~-]{1,128}$/.test(v)) errors.push({ field: 'value', message: 'a referral id may use letters, numbers and . _ ~ - (max 128)' });
  else if (type === 'link') {
    try { const u = new URL(v); if (!['http:', 'https:'].includes(u.protocol) || v.length > 1024) throw new Error(); }
    catch { errors.push({ field: 'value', message: 'must be a valid http/https link (max 1024 characters)' }); }
  }
  if (errors.length) throw new HttpError(422, 'VALIDATION', 'Validation failed', errors);
  return tx(async (conn) => {
    await lockGig(conn, gigId);
    const [rows] = await conn.query('SELECT * FROM referrals WHERE gig_id = ? AND is_active = 1 FOR UPDATE', [gigId]);
    const cur = (rows as any[])[0];
    if (cur && cur.referral_type === type && cur.referral_value === v) return { gigId, changed: false };
    let refId: number;
    if (cur) {
      await conn.query('UPDATE referrals SET referral_type = ?, referral_value = ?, updated_by = ?, updated_at = NOW(3) WHERE id = ?', [type, v, userId, cur.id]);
      refId = cur.id;
    } else {
      const [ins] = await conn.query('INSERT INTO referrals (gig_id, referral_type, referral_value, entered_by) VALUES (?, ?, ?, ?)', [gigId, type, v, userId]);
      refId = (ins as { insertId: number }).insertId;
    }
    await conn.query('INSERT INTO referral_history (referral_id, change_type, old_value, new_value, changed_by) VALUES (?, ?, ?, ?, ?)',
      [refId, cur ? 'update' : 'create', cur?.referral_value ?? null, v, userId]);
    await conn.query("INSERT INTO audit_log (entity_type, entity_id, action, actor_type, actor_user_id, details) VALUES ('gig', ?, 'referral_set', 'user', ?, ?)",
      [gigId, userId, JSON.stringify({ type })]);
    return { gigId, changed: true };
  });
}

export async function removeReferral(gigId: number, userId: number) {
  return tx(async (conn) => {
    await lockGig(conn, gigId);
    const [rows] = await conn.query('SELECT * FROM referrals WHERE gig_id = ? AND is_active = 1 FOR UPDATE', [gigId]);
    const cur = (rows as any[])[0];
    if (!cur) throw new HttpError(404, 'NOT_FOUND', 'No active referral on this gig');
    await conn.query('UPDATE referrals SET is_active = 0, updated_by = ?, updated_at = NOW(3) WHERE id = ?', [userId, cur.id]);
    await conn.query('INSERT INTO referral_history (referral_id, change_type, old_value, new_value, changed_by) VALUES (?, ?, ?, NULL, ?)', [cur.id, 'deactivate', cur.referral_value, userId]);
    await conn.query("INSERT INTO audit_log (entity_type, entity_id, action, actor_type, actor_user_id, details) VALUES ('gig', ?, 'referral_removed', 'user', ?, '{}')", [gigId, userId]);
    return { gigId, removed: true };
  });
}

// ---------- Duplicates ----------
export async function resolveDuplicate(candidateId: number, userId: number, resolution: 'confirmed_duplicate' | 'dismissed', note: string | null) {
  return tx(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM duplicate_candidates WHERE id = ? FOR UPDATE', [candidateId]);
    const c = (rows as any[])[0];
    if (!c) throw new HttpError(404, 'NOT_FOUND', 'Duplicate flag not found');
    if (c.resolution !== 'open') throw new HttpError(409, 'ALREADY_RESOLVED', `Already resolved as ${c.resolution}`);
    const g = await lockGig(conn, c.gig_id);
    await conn.query('UPDATE duplicate_candidates SET resolution = ?, resolved_by = ?, resolved_at = NOW(3) WHERE id = ?', [resolution, userId, candidateId]);
    let to = g.workflow_state as string;
    if (resolution === 'confirmed_duplicate') {
      if (g.workflow_state === 'published') throw new HttpError(409, 'PUBLISHED', 'Unpublish the gig first.');
      to = 'rejected';
      await conn.query("UPDATE gigs SET duplicate_state = 'confirmed', workflow_state = 'rejected', approved_by = NULL, approved_at = NULL WHERE id = ?", [g.id]);
    } else {
      const [open] = await conn.query("SELECT COUNT(*) AS n FROM duplicate_candidates WHERE gig_id = ? AND resolution = 'open'", [g.id]);
      if ((open as any[])[0].n === 0) await conn.query("UPDATE gigs SET duplicate_state = 'none', duplicate_of_gig_id = NULL WHERE id = ?", [g.id]);
    }
    await conn.query('INSERT INTO reviews (gig_id, reviewer_id, action, from_workflow_state, to_workflow_state, note) VALUES (?, ?, ?, ?, ?, ?)',
      [g.id, userId, 'resolve_duplicate', g.workflow_state, to, note ?? `${resolution} (matched gig #${c.matched_gig_id})`]);
    return { candidateId, resolution, gigId: g.id, workflowState: to };
  });
}

// ---------- Read models ----------
export async function getGigDetail(id: number) {
  const [rows] = await pool.query(
    `SELECT g.*, s.code AS source_code, s.referral_required AS source_referral_required FROM gigs g JOIN sources s ON s.id = g.source_id WHERE g.id = ?`, [id]);
  const g = (rows as any[])[0];
  if (!g) throw new HttpError(404, 'NOT_FOUND', 'Gig not found');
  const [[ver], [ref], [setting]] = await Promise.all([
    pool.query('SELECT * FROM verifications WHERE id = ?', [g.latest_verification_id ?? 0]),
    pool.query('SELECT r.id, r.referral_type, r.referral_value, r.entered_at, r.updated_at, u.display_name AS entered_by FROM referrals r JOIN users u ON u.id = r.entered_by WHERE r.gig_id = ? AND r.is_active = 1', [id]),
    pool.query("SELECT value FROM settings WHERE key_name = 'publish.referral_mandatory_default'"),
  ]) as any[];
  const referral = ref[0] ?? null;
  const referralRequired = g.source_referral_required === 1 || setting[0]?.value === true || setting[0]?.value === 'true';
  return {
    ...g, latest_verification: ver[0] ?? null, referral,
    flags: {
      referralRequired, missingReferral: referralRequired && !referral,
      duplicateOpen: g.duplicate_state === 'suspected', hasPendingSourceChanges: Boolean(g.pending_source_changes),
      missingRequiredFields: missingRequired(g), statusSetByHuman: g.availability_set_by === 'human',
    },
  };
}

export async function getHistory(id: number) {
  const [reviews] = await pool.query(
    `SELECT r.id, r.action, r.from_workflow_state, r.to_workflow_state, r.from_availability, r.to_availability, r.field_changes, r.note, r.created_at, u.display_name AS reviewer
       FROM reviews r JOIN users u ON u.id = r.reviewer_id WHERE r.gig_id = ? ORDER BY r.id DESC`, [id]);
  const [versions] = await pool.query(
    `SELECT v.version_no, v.change_origin, v.changed_fields, v.created_at, u.display_name AS changed_by
       FROM gig_versions v LEFT JOIN users u ON u.id = v.changed_by WHERE v.gig_id = ? ORDER BY v.version_no DESC`, [id]);
  const [referrals] = await pool.query(
    `SELECT h.change_type, h.old_value, h.new_value, h.created_at, u.display_name AS changed_by
       FROM referral_history h JOIN referrals r ON r.id = h.referral_id JOIN users u ON u.id = h.changed_by WHERE r.gig_id = ? ORDER BY h.id DESC`, [id]);
  const [audit] = await pool.query(
    `SELECT a.action, a.actor_type, u.display_name AS actor, a.details, a.created_at
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id WHERE a.entity_type = 'gig' AND a.entity_id = ? ORDER BY a.id DESC LIMIT 100`, [id]);
  return { reviews, versions, referralChanges: referrals, audit };
}
