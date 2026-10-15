import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { pool } from './db.js';
import { requireRole } from './auth.js';
import { HttpError } from './review.js';
import { publishGig, unpublishGig, readiness, healthSweep } from './publishing.js';
import { retryNotification } from './notify.js';

type Handler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
const wrap = (fn: Handler): Handler => async (req, reply) => {
  try { return await fn(req, reply); }
  catch (e) {
    if (e instanceof HttpError) return reply.code(e.status).send({ error: { code: e.code, message: e.message, details: e.details } });
    throw e;
  }
};
const userId = (req: FastifyRequest) => Number((req.user as { sub: string }).sub);
const idOf = (req: FastifyRequest) => {
  const id = Number((req.params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'BAD_REQUEST', 'Invalid id');
  return id;
};
const page = (q: Record<string, string | undefined>) => {
  const p = Math.max(1, Number(q.page ?? 1) || 1); const size = Math.min(100, Math.max(1, Number(q.pageSize ?? 25) || 25));
  return { p, size, offset: (p - 1) * size };
};

export async function publishRoutes(app: FastifyInstance) {
  const anyUser = { preHandler: requireRole() };
  const publisher = { preHandler: requireRole('publisher') };
  const adminOnly = { preHandler: requireRole('admin') };

  app.get('/api/v1/gigs/:id/publish-readiness', anyUser, wrap(async (req) => {
    const r = await readiness(idOf(req), userId(req));
    return { gigId: r.gigId, ready: r.ready, checks: r.checks };
  }));
  app.post('/api/v1/gigs/:id/publish', publisher, wrap(async (req, reply) => reply.code(201).send(await publishGig(idOf(req), userId(req)))));
  app.post('/api/v1/gigs/:id/unpublish', publisher, wrap(async (req) => {
    const reason = (req.body as { reason?: string } | null)?.reason ?? '';
    return unpublishGig(idOf(req), userId(req), reason);
  }));

  app.get('/api/v1/publications', anyUser, async (req) => {
    const q = req.query as Record<string, string | undefined>; const { p, size, offset } = page(q);
    const where = q.status ? 'WHERE p.status = ?' : ''; const args = q.status ? [q.status] : [];
    const [rows] = await pool.query(
      `SELECT p.id, p.gig_id, g.title, g.external_gig_id, p.status, p.published_at, pu.display_name AS published_by, p.unpublished_at, p.unpublish_reason,
              uu.display_name AS unpublished_by, p.failure_reason, p.pre_publish_verification_id
         FROM publications p JOIN gigs g ON g.id = p.gig_id LEFT JOIN users pu ON pu.id = p.published_by LEFT JOIN users uu ON uu.id = p.unpublished_by
         ${where} ORDER BY p.id DESC LIMIT ? OFFSET ?`, [...args, size, offset]);
    const [[c]] = (await pool.query(`SELECT COUNT(*) AS total FROM publications p ${where}`, args)) as any;
    return { data: rows, page: p, pageSize: size, total: c.total };
  });

  // Notifications (NOT-01..03): failures are visible here to everyone who can review
  app.get('/api/v1/notifications', anyUser, async (req) => {
    const q = req.query as Record<string, string | undefined>; const { p, size, offset } = page(q);
    const where: string[] = []; const args: unknown[] = [];
    for (const [k, col] of [['status', 'n.status'], ['type', 'n.type'], ['audience', 'n.audience']] as const) if (q[k]) { where.push(`${col} = ?`); args.push(q[k]); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT n.id, n.gig_id, g.title AS gig_title, n.audience, n.type, n.channel, n.status, n.attempts, n.last_error, n.payload, n.created_at, n.sent_at
         FROM notifications n LEFT JOIN gigs g ON g.id = n.gig_id ${w} ORDER BY n.id DESC LIMIT ? OFFSET ?`, [...args, size, offset]);
    const [[c]] = (await pool.query(`SELECT COUNT(*) AS total FROM notifications n ${w}`, args)) as any;
    return { data: rows, page: p, pageSize: size, total: c.total };
  });
  app.post('/api/v1/notifications/:id/retry', adminOnly, wrap(async (req) => {
    const r = await retryNotification(idOf(req));
    if (!r) throw new HttpError(409, 'WRONG_STATE', 'Only failed or skipped notifications can be retried');
    return { result: r };
  }));

  app.post('/api/v1/health/sweep', adminOnly, wrap(async () => healthSweep()));
}
