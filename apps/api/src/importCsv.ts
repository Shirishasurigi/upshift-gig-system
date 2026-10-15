import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import type { PoolConnection } from 'mysql2/promise';
import { pool } from './db.js';
import {
  normalizeUrl, cleanText, cleanList, parseBool, parseDate, parseMoney, parseInteger, fingerprint,
} from './normalize.js';
import { toGigText, similarity, type GigText } from './similarity.js';

export const CSV_COLUMNS = [
  'external_gig_id', 'title', 'track_id', 'payment_amount', 'compensation_type', 'min_amount',
  'max_amount', 'currency', 'priority', 'is_featured', 'is_local_business', 'posted_at',
  'origin_url', 'short_description', 'overview', 'responsibilities', 'deliverables',
  'requirements', 'proof_spec',
] as const;

const COMPENSATION_TYPES = ['hourly', 'fixed', 'per_task', 'monthly', 'other'];
const TRACKS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'];

type Issue = { row: number; severity: 'error' | 'warning'; field: string; message: string };

// Turn one CSV row into a clean record, or a list of errors. Nothing is guessed.
// On export, cells that start with = + - @ get a leading apostrophe so spreadsheets cannot run them as formulas.
// On import that single apostrophe is removed again, so a file survives a round trip unchanged.
const unguard = (v: string | undefined) => (typeof v === 'string' && /^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v);

function buildRecord(rawIn: Record<string, string>, rowNo: number) {
  const raw: Record<string, string> = Object.fromEntries(Object.entries(rawIn).map(([k, v]) => [k, unguard(v) as string]));
  const issues: Issue[] = [];
  const err = (field: string, message: string) => issues.push({ row: rowNo, severity: 'error', field, message });
  const warn = (field: string, message: string) => issues.push({ row: rowNo, severity: 'warning', field, message });

  const originUrl = (raw.origin_url ?? '').trim();
  const normalized = originUrl ? normalizeUrl(originUrl) : null;
  if (!originUrl) err('origin_url', 'origin_url is required');
  else if (!normalized) err('origin_url', 'origin_url must be a valid http/https link');

  const title = cleanText(raw.title);
  if (title && title.length > 255) err('title', 'title is longer than 255 characters');
  const shortDescription = cleanText(raw.short_description);
  if (shortDescription && shortDescription.length > 500) err('short_description', 'longer than 500 characters');

  let trackId: string | null = (raw.track_id ?? '').trim().toUpperCase() || null;
  if (trackId && !TRACKS.includes(trackId)) {
    warn('track_id', `"${raw.track_id}" is not M1-M6; left empty for classification`);
    trackId = null;
  }

  let compType: string | null = (raw.compensation_type ?? '').trim().toLowerCase() || null;
  if (compType && !COMPENSATION_TYPES.includes(compType)) {
    err('compensation_type', `"${raw.compensation_type}" must be one of ${COMPENSATION_TYPES.join(', ')}`);
    compType = null;
  }

  const take = <T>(field: string, r: { value: T } | { error: string }, fallback: T): T => {
    if ('error' in r) { err(field, r.error); return fallback; }
    return r.value;
  };
  const minAmount = take('min_amount', parseMoney(raw.min_amount), null);
  const maxAmount = take('max_amount', parseMoney(raw.max_amount), null);
  const priority = take('priority', parseInteger(raw.priority, 0), 0);
  const isFeatured = take('is_featured', parseBool(raw.is_featured), false);
  const isLocal = take('is_local_business', parseBool(raw.is_local_business), false);
  const postedAt = take('posted_at', parseDate(raw.posted_at), null);

  if (minAmount !== null && maxAmount !== null && minAmount > maxAmount) {
    err('min_amount', `min_amount (${minAmount}) is bigger than max_amount (${maxAmount})`);
  }

  let currency: string | null = (raw.currency ?? '').trim().toUpperCase() || null;
  if (currency && !/^[A-Z]{3}$/.test(currency)) {
    err('currency', `"${raw.currency}" must be a 3-letter code like USD`);
    currency = null;
  }
  if ((minAmount !== null || maxAmount !== null) && !currency) warn('currency', 'amount given but currency is missing');

  const paymentAmount = cleanText(raw.payment_amount);
  const overview = cleanText(raw.overview);
  const responsibilities = cleanList(raw.responsibilities);
  const deliverables = cleanList(raw.deliverables);
  const requirements = cleanList(raw.requirements);
  const proofSpec = cleanList(raw.proof_spec);

  // Fields that must exist before publishing. Missing ones are recorded, never invented.
  const missing: string[] = [];
  if (!title) missing.push('title');
  if (!trackId) missing.push('track_id');
  if (!shortDescription) missing.push('short_description');
  if (!overview) missing.push('overview');

  const record = {
    external_gig_id: cleanText(raw.external_gig_id),
    origin_url: originUrl,
    origin_url_normalized: normalized,
    title, track_id: trackId,
    payment_amount: paymentAmount, payment_source_text: paymentAmount,
    compensation_type: compType, min_amount: minAmount, max_amount: maxAmount, currency,
    priority, is_featured: isFeatured ? 1 : 0, is_local_business: isLocal ? 1 : 0,
    posted_at: postedAt, posted_at_status: postedAt ? 'found' : 'not_found',
    short_description: shortDescription, overview, responsibilities, deliverables, requirements,
    proof_spec: proofSpec,
    missing_fields: missing,
    data_completeness: missing.length === 0 ? 'complete' : 'partial',
    content_fingerprint: fingerprint([title, shortDescription, overview, paymentAmount, responsibilities, deliverables, requirements, proofSpec]),
  };
  const hasError = issues.some((i) => i.severity === 'error');
  return { record: hasError ? null : record, issues };
}

type Record19 = NonNullable<ReturnType<typeof buildRecord>['record']>;

// Fields that re-discovery may update. Editorial fields (priority, featured, local business,
// referral) are managed by humans in the back office and are never touched here.
const COMPARABLE = [
  'title', 'track_id', 'payment_amount', 'compensation_type', 'min_amount', 'max_amount', 'currency',
  'posted_at', 'short_description', 'overview', 'responsibilities', 'deliverables', 'requirements', 'proof_spec',
] as const;
const NUMERIC_FIELDS = new Set(['min_amount', 'max_amount']);
// Pay fields belong together: if a human edited any of them, none is changed automatically.
const PAY_GROUP = ['payment_amount', 'min_amount', 'max_amount', 'currency', 'compensation_type'];
const LOCKED_STATES = ['approved', 'publish_ready', 'published'];

type Change = { old: unknown; new: unknown };

function sameValue(field: string, a: unknown, b: unknown): boolean {
  return NUMERIC_FIELDS.has(field) ? Number(a) === Number(b) : String(a) === String(b);
}

// What did the source change? A missing value in the source never erases a stored value.
function diffRecord(existing: Record<string, unknown>, record: Record<string, unknown>) {
  const changes: Record<string, Change> = {};
  for (const f of COMPARABLE) {
    const incoming = record[f];
    if (incoming === null || incoming === undefined || incoming === '') continue;
    const current = existing[f];
    if (current !== null && current !== undefined && sameValue(f, current, incoming)) continue;
    changes[f] = { old: current ?? null, new: incoming };
  }
  return changes;
}

function computeMissing(g: Record<string, unknown>): string[] {
  return ['title', 'track_id', 'short_description', 'overview'].filter((f) => !g[f]);
}

async function findExisting(conn: PoolConnection, sourceId: number, r: Record19) {
  const [rows] = await conn.query(
    `SELECT g.*, (g.origin_url_hash = SHA2(?, 256)) AS url_match FROM gigs g
      WHERE g.origin_url_hash = SHA2(?, 256)
         OR (? IS NOT NULL AND g.source_id = ? AND g.external_gig_id = ?)
      ORDER BY url_match DESC LIMIT 1 FOR UPDATE`,
    [r.origin_url_normalized, r.origin_url_normalized, r.external_gig_id, sourceId, r.external_gig_id],
  );
  const row = (rows as Record<string, any>[])[0];
  return row ? { row, byUrl: row.url_match === 1 || row.url_match === '1' } : null;
}

type Counts = {
  total: number; created: number; unchanged: number; updated: number; held: number;
  conflict: number; similar: number; failed: number;
};

async function audit(conn: PoolConnection, gigId: number, action: string, details: unknown) {
  await conn.query(
    "INSERT INTO audit_log (entity_type, entity_id, action, actor_type, details) VALUES ('gig', ?, ?, 'discovery_agent', ?)",
    [gigId, action, JSON.stringify(details)]);
}

// The gig already exists: decide between "unchanged", "update", "hold for a human" or "conflict".
async function handleKnownGig(
  conn: PoolConnection, runId: number, match: NonNullable<Awaited<ReturnType<typeof findExisting>>>,
  record: Record19, counts: Counts, notes: string[], rowNo: number,
) {
  const { row, byUrl } = match;
  const changes = diffRecord(row, record as unknown as Record<string, unknown>);
  const keys = Object.keys(changes);
  await conn.query('UPDATE gigs SET last_seen_at = NOW(3), last_run_id = ? WHERE id = ?', [runId, row.id]);
  const pending = (reason: string, ch: Record<string, Change>) =>
    JSON.stringify({ reason, run_id: runId, detected_at: new Date().toISOString(), changes: ch });

  // Same external id but a different link: could be a repost or a moved page. A human decides.
  if (!byUrl) {
    const ch = { ...changes, origin_url: { old: row.origin_url, new: record.origin_url } };
    await conn.query('UPDATE gigs SET pending_source_changes = ? WHERE id = ?', [pending('same_external_id_different_url', ch), row.id]);
    await audit(conn, row.id, 'rediscovery_conflict', { run_id: runId, fields: Object.keys(ch) });
    counts.conflict++;
    notes.push(`line ${rowNo}: external id ${record.external_gig_id} already exists with a different link. Nothing changed; flagged for a reviewer.`);
    return;
  }

  if (keys.length === 0) {
    if (row.pending_source_changes) await conn.query('UPDATE gigs SET pending_source_changes = NULL WHERE id = ?', [row.id]);
    counts.unchanged++;
    return;
  }

  // Approved / published gigs are never changed behind the reviewer's back.
  if (LOCKED_STATES.includes(row.workflow_state)) {
    await conn.query('UPDATE gigs SET pending_source_changes = ? WHERE id = ?', [pending('source_changed_after_approval', changes), row.id]);
    await audit(conn, row.id, 'rediscovery_held', { run_id: runId, fields: keys, state: row.workflow_state });
    counts.held++;
    notes.push(`line ${rowNo}: ${row.external_gig_id} is ${row.workflow_state}; source changed (${keys.join(', ')}). Held for review.`);
    return;
  }

  // Fields a human edited are protected; everything else is updated and versioned.
  const provenance = (row.field_provenance ?? {}) as Record<string, string>;
  const humanEdited = (k: string) =>
    provenance[k] === 'human' || (PAY_GROUP.includes(k) && PAY_GROUP.some((p) => provenance[p] === 'human'));
  const applyKeys = keys.filter((k) => !humanEdited(k));
  const protectedKeys = keys.filter((k) => humanEdited(k));

  if (applyKeys.length > 0) {
    const merged: Record<string, unknown> = { ...row };
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const k of applyKeys) { sets.push(`${k} = ?`); vals.push(changes[k].new); merged[k] = changes[k].new; }
    if (applyKeys.includes('posted_at')) sets.push("posted_at_status = 'found'");
    if (applyKeys.includes('payment_amount')) { sets.push('payment_source_text = ?'); vals.push(changes.payment_amount.new); }
    const missing = computeMissing(merged);
    const protectedChanges = Object.fromEntries(protectedKeys.map((k) => [k, changes[k]]));
    await conn.query(
      `UPDATE gigs SET ${sets.join(', ')}, current_version = current_version + 1, content_fingerprint = ?,
         missing_fields = ?, data_completeness = ?, pending_source_changes = ? WHERE id = ?`,
      [...vals, fingerprint([merged.title, merged.short_description, merged.overview, merged.payment_amount,
        merged.responsibilities, merged.deliverables, merged.requirements, merged.proof_spec] as (string | null)[]),
       JSON.stringify(missing), missing.length === 0 ? 'complete' : 'partial',
       protectedKeys.length ? pending('human_edited_fields', protectedChanges) : null, row.id]);
    const [snap] = await conn.query(`SELECT ${COMPARABLE.join(', ')} FROM gigs WHERE id = ?`, [row.id]);
    await conn.query(
      "INSERT INTO gig_versions (gig_id, version_no, change_origin, changed_fields, snapshot) VALUES (?, ?, 'discovery', ?, ?)",
      [row.id, row.current_version + 1, JSON.stringify(Object.fromEntries(applyKeys.map((k) => [k, changes[k]]))), JSON.stringify((snap as unknown[])[0])]);
    await audit(conn, row.id, 'rediscovery_update', { run_id: runId, fields: applyKeys, protected: protectedKeys });
    counts.updated++;
    notes.push(`line ${rowNo}: ${row.external_gig_id ?? row.id} updated to version ${row.current_version + 1} (${applyKeys.join(', ')})${protectedKeys.length ? `; protected human edits: ${protectedKeys.join(', ')}` : ''}.`);
  } else {
    await conn.query('UPDATE gigs SET pending_source_changes = ? WHERE id = ?', [pending('human_edited_fields', changes), row.id]);
    await audit(conn, row.id, 'rediscovery_held', { run_id: runId, fields: keys, reason: 'human_edited_fields' });
    counts.held++;
    notes.push(`line ${rowNo}: ${row.external_gig_id ?? row.id} source changed only fields a human edited (${keys.join(', ')}). Kept the human values.`);
  }
}

export type ImportOptions = { dryRun?: boolean; maxRows?: number };

// Reads a file from disk (used by the command line tools)
export async function importCsv(filePath: string, sourceCode = 'SAMPLE_CSV', userId: number | null = null) {
  return importCsvText(await fs.readFile(filePath, 'utf8'), path.basename(filePath), sourceCode, userId);
}

// The importer. With dryRun it does exactly the same work, then undoes everything, so the answer is exactly what a real import would do.
export async function importCsvText(text: string, fileName: string, sourceCode = 'SAMPLE_CSV', userId: number | null = null, opts: ImportOptions = {}) {
  const dry = opts.dryRun === true;
  const [srcRows] = await pool.query('SELECT id, enablement FROM sources WHERE code = ?', [sourceCode]);
  const source = (srcRows as { id: number; enablement: string }[])[0];
  if (!source) throw new Error(`Source "${sourceCode}" does not exist`);
  if (source.enablement !== 'enabled') throw new Error(`Source "${sourceCode}" is not enabled`);

  // In a dry run every write happens inside one transaction that is rolled back at the end.
  const root: PoolConnection | null = dry ? await pool.getConnection() : null;
  if (root) await root.beginTransaction();
  const db = root ?? pool;
  const finishDry = async () => { if (root) { await root.rollback(); root.release(); } };

  const [jobRes] = await db.query(
    "INSERT INTO csv_jobs (direction, file_name, status, requested_by) VALUES ('import', ?, 'running', ?)", [fileName, userId]);
  const jobId = (jobRes as { insertId: number }).insertId;
  const [runRes] = await db.query(
    "INSERT INTO discovery_runs (source_id, trigger_type, status, started_at, initiated_by) VALUES (?, 'csv_import', 'running', NOW(3), ?)",
    [source.id, userId]);
  const runId = (runRes as { insertId: number }).insertId;

  const counts: Counts = { total: 0, created: 0, unchanged: 0, updated: 0, held: 0, conflict: 0, similar: 0, failed: 0 };
  const notes: string[] = [];

  // Existing gigs, kept in memory to spot look-alikes (content similarity)
  const [thr] = await db.query("SELECT value FROM settings WHERE key_name = 'dedup.similarity_threshold'");
  const threshold = Number((thr as { value: unknown }[])[0]?.value ?? 0.88);
  const [known] = await db.query('SELECT id, title, overview FROM gigs');
  const knownText: { id: number; text: GigText }[] = (known as { id: number; title: string | null; overview: string | null }[])
    .map((g) => ({ id: g.id, text: toGigText(g.title, g.overview) }));
  const issues: Issue[] = [];

  try {
    let rows: Record<string, string>[];
    try {
      rows = parse(text, { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true, trim: false });
    } catch (e) {
      throw new Error(`This does not look like a valid CSV file (${(e as Error).message})`);
    }
    const header = rows.length > 0 ? Object.keys(rows[0]) : [];
    if (rows.length === 0) throw new Error('The file has no data rows');
    const missingCols = CSV_COLUMNS.filter((c) => !header.includes(c));
    if (missingCols.length > 0) throw new Error(`CSV is missing columns: ${missingCols.join(', ')}`);
    if (opts.maxRows && rows.length > opts.maxRows) throw new Error(`Too many rows (${rows.length}); the limit is ${opts.maxRows} per file`);

    counts.total = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const rowNo = i + 2; // line 1 is the header
      const { record, issues: rowIssues } = buildRecord(rows[i], rowNo);
      issues.push(...rowIssues);

      if (!record) { // invalid row: log it and carry on with the next one
        counts.failed++;
        for (const is of rowIssues.filter((x) => x.severity === 'error')) {
          await db.query(
            "INSERT INTO discovery_errors (run_id, source_id, stage, origin_url, error_code, message) VALUES (?, ?, 'normalize', ?, 'VALIDATION', ?)",
            [runId, source.id, (rows[i].origin_url ?? '').slice(0, 2000) || null, `Row ${rowNo} ${is.field}: ${is.message}`]);
        }
        continue;
      }

      const conn = root ?? (await pool.getConnection());
      const commit = async () => { if (!root) await conn.commit(); };
      try {
        if (!root) await conn.beginTransaction();
        const match = await findExisting(conn, source.id, record);
        if (match) {
          await handleKnownGig(conn, runId, match, record, counts, notes, rowNo);
          await commit();
          continue;
        }
        const [ins] = await conn.query(
          `INSERT INTO gigs (source_id, first_run_id, last_run_id, external_gig_id, origin_url, origin_url_normalized,
             title, track_id, payment_amount, payment_source_text, compensation_type, min_amount, max_amount, currency,
             priority, is_featured, is_local_business, posted_at, posted_at_status, short_description, overview,
             responsibilities, deliverables, requirements, proof_spec, missing_fields, data_completeness,
             content_fingerprint, workflow_state, availability_status)
           VALUES (?,?,?,?,?,?, ?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?, ?,?,?,?,?,?, ?, 'discovered','needs_review')`,
          [source.id, runId, runId, record.external_gig_id, record.origin_url, record.origin_url_normalized,
           record.title, record.track_id, record.payment_amount, record.payment_source_text, record.compensation_type,
           record.min_amount, record.max_amount, record.currency, record.priority, record.is_featured,
           record.is_local_business, record.posted_at, record.posted_at_status, record.short_description, record.overview,
           record.responsibilities, record.deliverables, record.requirements, record.proof_spec,
           JSON.stringify(record.missing_fields), record.data_completeness, record.content_fingerprint]);
        const gigId = (ins as { insertId: number }).insertId;
        await conn.query(
          "INSERT INTO gig_versions (gig_id, version_no, change_origin, changed_by, snapshot) VALUES (?, 1, 'csv_import', ?, ?)",
          [gigId, userId, JSON.stringify(record)]);
        // Look-alike check: flag for a human, never merge automatically
        const mine = toGigText(record.title, record.overview);
        let best: { id: number; score: number } | null = null;
        for (const k of knownText) {
          const score = similarity(mine, k.text);
          if (score >= threshold && (!best || score > best.score)) best = { id: k.id, score };
        }
        if (best) {
          await conn.query(
            "INSERT INTO duplicate_candidates (gig_id, matched_gig_id, match_signal, similarity) VALUES (?, ?, 'content_similarity', ?)",
            [gigId, best.id, best.score.toFixed(4)]);
          await conn.query("UPDATE gigs SET duplicate_state = 'suspected', duplicate_of_gig_id = ? WHERE id = ?", [best.id, gigId]);
          counts.similar++;
          notes.push(`line ${rowNo}: new gig ${record.external_gig_id ?? gigId} looks ${(best.score * 100).toFixed(0)}% like gig #${best.id}. Flagged as suspected duplicate.`);
        }
        knownText.push({ id: gigId, text: mine });
        await commit();
        counts.created++;
      } catch (e) {
        if (!root) await conn.rollback();
        if ((e as { code?: string }).code === 'ER_DUP_ENTRY') { counts.unchanged++; }
        else {
          counts.failed++;
          issues.push({ row: rowNo, severity: 'error', field: '-', message: (e as Error).message });
          await db.query(
            "INSERT INTO discovery_errors (run_id, source_id, stage, origin_url, error_code, message) VALUES (?, ?, 'persist', ?, 'DB_ERROR', ?)",
            [runId, source.id, record.origin_url.slice(0, 2000), `Row ${rowNo}: ${(e as Error).message}`.slice(0, 1000)]);
        }
      } finally {
        if (!root) conn.release();
      }
    }
  } catch (e) {
    if (dry) { await finishDry(); throw e; }
    // File-level failure (unreadable file, wrong columns): record it, do not touch existing gigs
    await pool.query("UPDATE discovery_runs SET status='failed', finished_at=NOW(3), error_summary=? WHERE id=?", [(e as Error).message, runId]);
    await pool.query("UPDATE csv_jobs SET status='failed', finished_at=NOW(3), error_report=? WHERE id=?",
      [JSON.stringify([{ row: 0, severity: 'error', field: '-', message: (e as Error).message }]), jobId]);
    await pool.query(
      "INSERT INTO discovery_errors (run_id, source_id, stage, error_code, message) VALUES (?, ?, 'fetch', 'FILE_ERROR', ?)",
      [runId, source.id, (e as Error).message.slice(0, 1000)]);
    throw e;
  }

  const matched = counts.unchanged + counts.updated + counts.held + counts.conflict;
  const runStatus = counts.failed === 0 ? 'succeeded' : counts.created + matched > 0 ? 'partial' : 'failed';
  if (dry) {
    await finishDry(); // undo everything: nothing was saved
    return { dryRun: true, runId: null, jobId: null, runStatus, counts, issues, notes };
  }
  await pool.query(
    `UPDATE discovery_runs SET status=?, finished_at=NOW(3), found_count=?, created_count=?, updated_count=?, unchanged_count=?,
        duplicate_count=?, failed_count=? WHERE id=?`,
    [runStatus, counts.total, counts.created, counts.updated, counts.unchanged, matched, counts.failed, runId]);
  await pool.query(
    `UPDATE csv_jobs SET status=?, finished_at=NOW(3), total_rows=?, created_rows=?, updated_rows=?, skipped_rows=?, failed_rows=?, error_report=?
      WHERE id=?`,
    [counts.failed ? 'completed_with_errors' : 'completed', counts.total, counts.created, counts.updated + counts.held, counts.unchanged + counts.conflict, counts.failed, JSON.stringify(issues), jobId]);
  await pool.query('UPDATE sources SET last_successful_run_at = NOW(3), health = ? WHERE id = ?', ['healthy', source.id]);
  await pool.query(
    "INSERT INTO audit_log (entity_type, entity_id, action, actor_type, actor_user_id, details) VALUES ('discovery_run', ?, 'csv_import', ?, ?, ?)",
    [runId, userId ? 'user' : 'system', userId, JSON.stringify({ file: fileName, ...counts })]);

  return { dryRun: false, runId, jobId, runStatus, counts, issues, notes };
}
