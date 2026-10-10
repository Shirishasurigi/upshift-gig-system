import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import type { PoolConnection } from 'mysql2/promise';
import { pool } from './db.js';
import {
  normalizeUrl, cleanText, cleanList, parseBool, parseDate, parseMoney, parseInteger, fingerprint,
} from './normalize.js';

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
function buildRecord(raw: Record<string, string>, rowNo: number) {
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

async function findExisting(conn: PoolConnection, sourceId: number, r: NonNullable<ReturnType<typeof buildRecord>['record']>) {
  const [rows] = await conn.query(
    `SELECT id FROM gigs
      WHERE origin_url_hash = SHA2(?, 256)
         OR (? IS NOT NULL AND source_id = ? AND external_gig_id = ?)
      LIMIT 1`,
    [r.origin_url_normalized, r.external_gig_id, sourceId, r.external_gig_id],
  );
  return (rows as { id: number }[])[0] ?? null;
}

export async function importCsv(filePath: string, sourceCode = 'SAMPLE_CSV', userId: number | null = null) {
  const fileName = path.basename(filePath);
  const [srcRows] = await pool.query('SELECT id, enablement FROM sources WHERE code = ?', [sourceCode]);
  const source = (srcRows as { id: number; enablement: string }[])[0];
  if (!source) throw new Error(`Source "${sourceCode}" does not exist`);
  if (source.enablement !== 'enabled') throw new Error(`Source "${sourceCode}" is not enabled`);

  const [jobRes] = await pool.query(
    "INSERT INTO csv_jobs (direction, file_name, status, requested_by) VALUES ('import', ?, 'running', ?)", [fileName, userId]);
  const jobId = (jobRes as { insertId: number }).insertId;
  const [runRes] = await pool.query(
    "INSERT INTO discovery_runs (source_id, trigger_type, status, started_at, initiated_by) VALUES (?, 'csv_import', 'running', NOW(3), ?)",
    [source.id, userId]);
  const runId = (runRes as { insertId: number }).insertId;

  const counts = { total: 0, created: 0, duplicate: 0, failed: 0 };
  const issues: Issue[] = [];

  try {
    const text = await fs.readFile(filePath, 'utf8');
    const rows: Record<string, string>[] = parse(text, {
      columns: true, bom: true, skip_empty_lines: true, relax_column_count: true, trim: false,
    });
    const header = rows.length > 0 ? Object.keys(rows[0]) : [];
    const missingCols = CSV_COLUMNS.filter((c) => !header.includes(c));
    if (missingCols.length > 0) throw new Error(`CSV is missing columns: ${missingCols.join(', ')}`);

    counts.total = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const rowNo = i + 2; // line 1 is the header
      const { record, issues: rowIssues } = buildRecord(rows[i], rowNo);
      issues.push(...rowIssues);

      if (!record) { // invalid row: log it and carry on with the next one
        counts.failed++;
        for (const is of rowIssues.filter((x) => x.severity === 'error')) {
          await pool.query(
            "INSERT INTO discovery_errors (run_id, source_id, stage, origin_url, error_code, message) VALUES (?, ?, 'normalize', ?, 'VALIDATION', ?)",
            [runId, source.id, (rows[i].origin_url ?? '').slice(0, 2000) || null, `Row ${rowNo} ${is.field}: ${is.message}`]);
        }
        continue;
      }

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const existing = await findExisting(conn, source.id, record);
        if (existing) {
          counts.duplicate++;
          await conn.rollback();
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
          "INSERT INTO gig_versions (gig_id, version_no, change_origin, snapshot) VALUES (?, 1, 'csv_import', ?)",
          [gigId, JSON.stringify(record)]);
        await conn.commit();
        counts.created++;
      } catch (e) {
        await conn.rollback();
        if ((e as { code?: string }).code === 'ER_DUP_ENTRY') { counts.duplicate++; }
        else {
          counts.failed++;
          issues.push({ row: rowNo, severity: 'error', field: '-', message: (e as Error).message });
          await pool.query(
            "INSERT INTO discovery_errors (run_id, source_id, stage, origin_url, error_code, message) VALUES (?, ?, 'persist', ?, 'DB_ERROR', ?)",
            [runId, source.id, record.origin_url.slice(0, 2000), `Row ${rowNo}: ${(e as Error).message}`.slice(0, 1000)]);
        }
      } finally {
        conn.release();
      }
    }
  } catch (e) {
    // File-level failure (unreadable file, wrong columns): record it, do not touch existing gigs
    await pool.query("UPDATE discovery_runs SET status='failed', finished_at=NOW(3), error_summary=? WHERE id=?", [(e as Error).message, runId]);
    await pool.query("UPDATE csv_jobs SET status='failed', finished_at=NOW(3), error_report=? WHERE id=?",
      [JSON.stringify([{ row: 0, severity: 'error', field: '-', message: (e as Error).message }]), jobId]);
    await pool.query(
      "INSERT INTO discovery_errors (run_id, source_id, stage, error_code, message) VALUES (?, ?, 'fetch', 'FILE_ERROR', ?)",
      [runId, source.id, (e as Error).message.slice(0, 1000)]);
    throw e;
  }

  const runStatus = counts.failed === 0 ? 'succeeded' : counts.created + counts.duplicate > 0 ? 'partial' : 'failed';
  await pool.query(
    `UPDATE discovery_runs SET status=?, finished_at=NOW(3), found_count=?, created_count=?, duplicate_count=?, failed_count=?
      WHERE id=?`, [runStatus, counts.total, counts.created, counts.duplicate, counts.failed, runId]);
  await pool.query(
    `UPDATE csv_jobs SET status=?, finished_at=NOW(3), total_rows=?, created_rows=?, skipped_rows=?, failed_rows=?, error_report=?
      WHERE id=?`,
    [counts.failed ? 'completed_with_errors' : 'completed', counts.total, counts.created, counts.duplicate, counts.failed, JSON.stringify(issues), jobId]);
  await pool.query('UPDATE sources SET last_successful_run_at = NOW(3), health = ? WHERE id = ?', ['healthy', source.id]);
  await pool.query(
    "INSERT INTO audit_log (entity_type, entity_id, action, actor_type, actor_user_id, details) VALUES ('discovery_run', ?, 'csv_import', ?, ?, ?)",
    [runId, userId ? 'user' : 'system', userId, JSON.stringify({ file: fileName, ...counts })]);

  return { runId, jobId, runStatus, counts, issues };
}
