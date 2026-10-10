import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import { requireRole } from './auth.js';

const listQuery = z.object({
  status: z.enum(['queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled']).optional(),
  sourceId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const idParam = z.object({ id: z.coerce.number().int().positive() });

export async function discoveryRoutes(app: FastifyInstance) {
  const guard = { preHandler: requireRole() }; // any logged-in user may read

  // List discovery runs (newest first). Failed and partial runs are plainly visible.
  app.get('/api/v1/discovery/runs', guard, async (request, reply) => {
    const q = listQuery.safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: q.error.issues[0].message } });
    const { status, sourceId, page, pageSize } = q.data;
    const where: string[] = []; const args: unknown[] = [];
    if (status) { where.push('r.status = ?'); args.push(status); }
    if (sourceId) { where.push('r.source_id = ?'); args.push(sourceId); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT r.id, r.source_id, s.code AS source_code, r.trigger_type, r.status, r.started_at, r.finished_at,
              r.found_count, r.created_count, r.updated_count, r.unchanged_count, r.duplicate_count, r.failed_count, r.error_summary
         FROM discovery_runs r JOIN sources s ON s.id = r.source_id ${w}
        ORDER BY r.id DESC LIMIT ? OFFSET ?`, [...args, pageSize, (page - 1) * pageSize]);
    const [[count]] = (await pool.query(`SELECT COUNT(*) AS total FROM discovery_runs r ${w}`, args)) as any;
    return { data: rows, page, pageSize, total: count.total };
  });

  app.get('/api/v1/discovery/runs/:id', guard, async (request, reply) => {
    const p = idParam.safeParse(request.params);
    if (!p.success) return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'Invalid id' } });
    const [rows] = await pool.query(
      `SELECT r.*, s.code AS source_code FROM discovery_runs r JOIN sources s ON s.id = r.source_id WHERE r.id = ?`, [p.data.id]);
    const run = (rows as any[])[0];
    if (!run) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Run not found' } });
    return run;
  });

  // The reason each failed row or source failed (DISC-07)
  app.get('/api/v1/discovery/runs/:id/errors', guard, async (request, reply) => {
    const p = idParam.safeParse(request.params);
    if (!p.success) return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'Invalid id' } });
    const [rows] = await pool.query(
      'SELECT id, stage, origin_url, error_code, message, created_at FROM discovery_errors WHERE run_id = ? ORDER BY id', [p.data.id]);
    return { data: rows };
  });

  // Recent errors across all runs, for the admin dashboard
  app.get('/api/v1/logs/errors', guard, async () => {
    const [rows] = await pool.query(
      `SELECT e.id, e.run_id, s.code AS source_code, e.stage, e.error_code, e.message, e.created_at
         FROM discovery_errors e JOIN sources s ON s.id = e.source_id ORDER BY e.id DESC LIMIT 100`);
    return { data: rows };
  });
}
