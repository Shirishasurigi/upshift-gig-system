import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import { requireRole } from './auth.js';
import { verifyGig } from './verify.js';
import { getGigDetail, HttpError } from './review.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const listQuery = z.object({
  workflowState: z.enum(['discovered', 'review_pending', 'approved', 'rejected', 'publish_ready', 'published', 'unpublished']).optional(),
  availability: z.enum(['active', 'paused', 'stopped', 'needs_review']).optional(),
  track: z.enum(['M1', 'M2', 'M3', 'M4', 'M5', 'M6']).optional(),
  sourceId: z.coerce.number().int().positive().optional(),
  duplicate: z.enum(['none', 'suspected', 'confirmed']).optional(),
  confidenceMin: z.coerce.number().min(0).max(1).optional(),
  confidenceMax: z.coerce.number().min(0).max(1).optional(),
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function gigsRoutes(app: FastifyInstance) {
  const anyUser = { preHandler: requireRole() };

  // Review queue: lowest confidence first, so uncertain gigs get human eyes first
  app.get('/api/v1/gigs', anyUser, async (request, reply) => {
    const q = listQuery.safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: q.error.issues[0].message } });
    const f = q.data;
    const where: string[] = []; const args: unknown[] = [];
    const add = (sql: string, v: unknown) => { where.push(sql); args.push(v); };
    if (f.workflowState) add('g.workflow_state = ?', f.workflowState);
    if (f.availability) add('g.availability_status = ?', f.availability);
    if (f.track) add('g.track_id = ?', f.track);
    if (f.sourceId) add('g.source_id = ?', f.sourceId);
    if (f.duplicate) add('g.duplicate_state = ?', f.duplicate);
    if (f.confidenceMin !== undefined) add('g.verification_confidence >= ?', f.confidenceMin);
    if (f.confidenceMax !== undefined) add('g.verification_confidence <= ?', f.confidenceMax);
    if (f.q) add('g.title LIKE ?', `%${f.q}%`);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT g.id, g.external_gig_id, g.title, g.track_id, s.code AS source_code, g.workflow_state, g.availability_status,
              g.verification_confidence, g.last_verified_at, g.posted_at, g.payment_amount, g.duplicate_state, g.data_completeness
         FROM gigs g JOIN sources s ON s.id = g.source_id ${w}
        ORDER BY g.verification_confidence IS NULL, g.verification_confidence ASC, g.id ASC LIMIT ? OFFSET ?`,
      [...args, f.pageSize, (f.page - 1) * f.pageSize]);
    const [[c]] = (await pool.query(`SELECT COUNT(*) AS total FROM gigs g ${w}`, args)) as any;
    return { data: rows, page: f.page, pageSize: f.pageSize, total: c.total };
  });

  // Everything a reviewer needs on one page: fields, latest check, referral, and warning flags
  app.get('/api/v1/gigs/:id', anyUser, async (request, reply) => {
    const p = idParam.safeParse(request.params);
    if (!p.success) return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'Invalid id' } });
    try { return await getGigDetail(p.data.id); }
    catch (e) {
      if (e instanceof HttpError) return reply.code(e.status).send({ error: { code: e.code, message: e.message } });
      throw e;
    }
  });

  app.get('/api/v1/gigs/:id/verifications', anyUser, async (request, reply) => {
    const p = idParam.safeParse(request.params);
    if (!p.success) return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'Invalid id' } });
    const [rows] = await pool.query('SELECT * FROM verifications WHERE gig_id = ? ORDER BY id DESC', [p.data.id]);
    return { data: rows };
  });

  // How the module was chosen (keywords / AI), including gigs left for a human
  app.get('/api/v1/gigs/:id/classifications', anyUser, async (request, reply) => {
    const p = idParam.safeParse(request.params);
    if (!p.success) return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'Invalid id' } });
    const [rows] = await pool.query(
      'SELECT id, proposed_track_id, confidence, rationale, alternatives, model, prompt_version, outcome, created_at FROM ai_classifications WHERE gig_id = ? ORDER BY id DESC', [p.data.id]);
    return { data: rows };
  });

  // The proof behind a verification result
  app.get('/api/v1/verifications/:id/evidence', anyUser, async (request, reply) => {
    const p = idParam.safeParse(request.params);
    if (!p.success) return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'Invalid id' } });
    const [rows] = await pool.query(
      'SELECT id, evidence_type, field_name, extracted_value, excerpt, locator, is_ai_generated, confidence FROM verification_evidence WHERE verification_id = ? ORDER BY id', [p.data.id]);
    return { data: rows };
  });

  // Re-check a gig now (can take a few seconds)
  app.post('/api/v1/gigs/:id/verify', { preHandler: requireRole('reviewer') }, async (request, reply) => {
    const p = idParam.safeParse(request.params);
    if (!p.success) return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'Invalid id' } });
    try {
      const u = request.user as { sub: string };
      return await verifyGig(p.data.id, 'manual', Number(u.sub));
    } catch (e) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: (e as Error).message } });
    }
  });
}
