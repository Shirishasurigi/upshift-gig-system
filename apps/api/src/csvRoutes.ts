import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { stringify } from 'csv-stringify/sync';
import { pool } from './db.js';
import { requireRole } from './auth.js';
import { HttpError } from './review.js';
import { CSV_COLUMNS, importCsvText } from './importCsv.js';
import { classifyAll } from './classify.js';
import { verifyMany } from './verify.js';

const MAX_MB = Number(process.env.CSV_MAX_MB ?? 5);
const MAX_ROWS = Number(process.env.CSV_MAX_ROWS ?? 5000);
const TRACKS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'];

// ---------- Export: exactly the 19 template columns, in template order ----------
const TEXT_RISK = /^[=+\-@\t\r]/; // spreadsheets may run these as formulas
function cell(col: string, v: unknown, guard: boolean): string {
  if (v === null || v === undefined) return '';
  if (col === 'is_featured' || col === 'is_local_business') return v ? 'true' : 'false';
  if (col === 'min_amount' || col === 'max_amount') return String(Number(v)); // 45.00 -> 45
  const t = String(v);
  const isText = !['priority', 'posted_at', 'origin_url', 'external_gig_id', 'track_id', 'currency', 'compensation_type'].includes(col);
  return guard && isText && TEXT_RISK.test(t) ? `'${t}` : t;
}

export function buildCsv(rows: Record<string, unknown>[], guard = true, bom = false): string {
  const records = rows.map((r) => CSV_COLUMNS.map((c) => cell(c, r[c], guard)));
  const body = stringify(records, { header: true, columns: [...CSV_COLUMNS], record_delimiter: 'windows' });
  return (bom ? '\uFEFF' : '') + body;
}

const idParam = (req: FastifyRequest) => {
  const id = Number((req.params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'BAD_REQUEST', 'Invalid id');
  return id;
};

// New gigs still need module sorting and an availability check before they reach the review queue. Done in the background.
function processInBackground(log: FastifyRequest['log']) {
  void (async () => {
    try {
      await classifyAll();
      const [rows] = await pool.query("SELECT id FROM gigs WHERE workflow_state = 'discovered' ORDER BY id");
      await verifyMany((rows as { id: number }[]).map((r) => r.id), 'discovery');
    } catch (e) { log.error(e, 'background processing of imported gigs failed'); }
  })();
}

export async function csvRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_MB * 1024 * 1024, files: 1, fields: 5 } });
  const anyUser = { preHandler: requireRole() };
  const reviewer = { preHandler: requireRole('reviewer') };
  const fail = (reply: FastifyReply, e: unknown) => {
    if (e instanceof HttpError) return reply.code(e.status).send({ error: { code: e.code, message: e.message, details: e.details } });
    throw e;
  };

  app.get('/api/v1/csv/template', anyUser, async (_req, reply) => {
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="upshift_gigs_template.csv"');
    return buildCsv([]);
  });

  app.get('/api/v1/csv/export', anyUser, async (req, reply) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const scope = q.scope ?? 'approved';
      if (!['approved', 'published', 'all'].includes(scope)) throw new HttpError(400, 'BAD_REQUEST', 'scope must be approved, published or all');
      if (scope === 'all' && (req.user as { role: string }).role !== 'admin') throw new HttpError(403, 'FORBIDDEN', 'Only an admin can export every gig');
      const where: string[] = []; const args: unknown[] = [];
      if (scope === 'approved') where.push("g.workflow_state IN ('approved','publish_ready','published')");
      if (scope === 'published') where.push("g.workflow_state = 'published'");
      if (q.track) { if (!TRACKS.includes(q.track)) throw new HttpError(400, 'BAD_REQUEST', 'track must be M1 to M6'); where.push('g.track_id = ?'); args.push(q.track); }
      if (q.sourceId) { const n = Number(q.sourceId); if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'BAD_REQUEST', 'Invalid sourceId'); where.push('g.source_id = ?'); args.push(n); }
      const [rows] = await pool.query(
        `SELECT ${CSV_COLUMNS.map((c) => `g.${c}`).join(', ')} FROM gigs g ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY g.id`, args);
      const csv = buildCsv(rows as Record<string, unknown>[], q.safe !== 'false', q.bom === 'true');
      await pool.query(
        "INSERT INTO csv_jobs (direction, file_name, status, total_rows, filter_criteria, requested_by, finished_at) VALUES ('export', ?, 'completed', ?, ?, ?, NOW(3))",
        [`export_${scope}.csv`, (rows as unknown[]).length, JSON.stringify({ scope, track: q.track ?? null, sourceId: q.sourceId ?? null }), Number((req.user as { sub: string }).sub)]);
      const stamp = new Date().toISOString().slice(0, 10);
      reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="upshift_gigs_${scope}_${stamp}.csv"`);
      return csv;
    } catch (e) { return fail(reply, e); }
  });

  // ---------- Import (upload a file) ----------
  app.post('/api/v1/csv/import', reviewer, async (req, reply) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const dryRun = q.dryRun === 'true';
      const sourceCode = (q.source ?? 'SAMPLE_CSV').slice(0, 40);
      const [srcRows] = await pool.query('SELECT access_method, enablement FROM sources WHERE code = ?', [sourceCode]);
      const src = (srcRows as any[])[0];
      if (!src) throw new HttpError(404, 'NOT_FOUND', `Source "${sourceCode}" does not exist`);
      if (!['csv_import', 'manual_entry'].includes(src.access_method)) throw new HttpError(422, 'WRONG_SOURCE', 'Files can only be uploaded to a source whose access method is csv_import or manual_entry.');
      if (src.enablement !== 'enabled') throw new HttpError(409, 'SOURCE_DISABLED', `Source "${sourceCode}" is not enabled.`);

      if (!req.isMultipart()) throw new HttpError(400, 'BAD_REQUEST', 'Send the file as multipart/form-data with the field name "file".');
      let file;
      try { file = await req.file(); } catch (e) { throw new HttpError(400, 'BAD_REQUEST', (e as Error).message); }
      if (!file) throw new HttpError(400, 'BAD_REQUEST', 'No file was uploaded.');
      if (!/\.csv$/i.test(file.filename)) throw new HttpError(415, 'NOT_CSV', 'Please upload a .csv file.');
      let buf: Buffer;
      try { buf = await file.toBuffer(); }
      catch { throw new HttpError(413, 'TOO_LARGE', `The file is larger than ${MAX_MB} MB.`); }
      if (file.file.truncated) throw new HttpError(413, 'TOO_LARGE', `The file is larger than ${MAX_MB} MB.`);
      if (buf.includes(0)) throw new HttpError(415, 'NOT_CSV', 'This looks like a binary file, not a CSV.');

      let result;
      try {
        result = await importCsvText(buf.toString('utf8'), file.filename.slice(0, 250), sourceCode, Number((req.user as { sub: string }).sub), { dryRun, maxRows: MAX_ROWS });
      } catch (e) { throw new HttpError(422, 'CSV_REJECTED', (e as Error).message); }

      const c = result.counts;
      const needsProcessing = !dryRun && c.created > 0;
      if (needsProcessing) processInBackground(req.log);
      return {
        dryRun, jobId: result.jobId, runId: result.runId, status: result.runStatus,
        created: c.created, updated: c.updated + c.held, skipped: c.unchanged + c.conflict, failed: c.failed,
        counts: c, errors: result.issues, notes: result.notes,
        processing: needsProcessing ? 'started' : 'not_needed',
      };
    } catch (e) { return fail(reply, e); }
  });

  app.get('/api/v1/csv/jobs', anyUser, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const where = q.direction && ['import', 'export'].includes(q.direction) ? 'WHERE j.direction = ?' : ''; const args = where ? [q.direction] : [];
    const [rows] = await pool.query(
      `SELECT j.id, j.direction, j.file_name, j.status, j.total_rows, j.created_rows, j.updated_rows, j.skipped_rows, j.failed_rows, j.filter_criteria,
              u.display_name AS requested_by, j.created_at, j.finished_at
         FROM csv_jobs j LEFT JOIN users u ON u.id = j.requested_by ${where} ORDER BY j.id DESC LIMIT 100`, args);
    return { data: rows };
  });

  app.get('/api/v1/csv/jobs/:id', anyUser, async (req, reply) => {
    try {
      const [rows] = await pool.query('SELECT * FROM csv_jobs WHERE id = ?', [idParam(req)]);
      const j = (rows as any[])[0];
      if (!j) throw new HttpError(404, 'NOT_FOUND', 'Job not found');
      return j;
    } catch (e) { return fail(reply, e); }
  });
}
