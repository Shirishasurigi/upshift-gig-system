import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { pool } from './db.js';

const TRACKS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'];
const COMP = ['hourly', 'fixed', 'per_task', 'monthly', 'other'];
const list = (s: string | null) => (s ? s.split(' | ').filter(Boolean) : []);

// Only fields that are safe and useful for learners. Nothing internal (approvers, evidence, notes) ever leaves here.
function toPublic(r: Record<string, any>) {
  return {
    id: r.id, externalGigId: r.external_gig_id, title: r.title, track: r.track_id, moduleName: r.module_name,
    status: r.status, paymentAmount: r.payment_amount, compensationType: r.compensation_type,
    minAmount: r.min_amount === null ? null : Number(r.min_amount), maxAmount: r.max_amount === null ? null : Number(r.max_amount), currency: r.currency,
    priority: r.priority, isFeatured: Boolean(r.is_featured), isLocalBusiness: Boolean(r.is_local_business),
    postedAt: r.posted_at, originUrl: r.origin_url, applicationUrl: r.application_url, referralCode: r.referral_code,
    shortDescription: r.short_description, overview: r.overview,
    responsibilities: list(r.responsibilities), deliverables: list(r.deliverables), requirements: list(r.requirements), proofSpec: list(r.proof_spec),
    lastVerifiedAt: r.last_verified_at, publishedAt: r.published_at,
  };
}

// Read-only and open to everyone, so it is rate-limited. It reads ONLY the v_published_gigs view.
export async function publicRoutes(app: FastifyInstance) {
  await app.register(async (scope) => {
    await scope.register(rateLimit, { max: Number(process.env.PUBLIC_API_RATE_LIMIT_PER_MIN ?? 120), timeWindow: '1 minute' });

    scope.get('/public/v1/gigs', async (req, reply) => {
      const q = req.query as Record<string, string | undefined>;
      const where: string[] = []; const args: unknown[] = [];
      if (q.q) { where.push('(title LIKE ? OR short_description LIKE ?)'); args.push(`%${q.q.slice(0, 100)}%`, `%${q.q.slice(0, 100)}%`); }
      if (q.track) { if (!TRACKS.includes(q.track)) return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'track must be M1 to M6' } }); where.push('track_id = ?'); args.push(q.track); }
      if (q.status) { if (!['active', 'paused'].includes(q.status)) return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'status must be active or paused' } }); where.push('status = ?'); args.push(q.status); }
      if (q.compensationType) { if (!COMP.includes(q.compensationType)) return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: `compensationType must be one of ${COMP.join(', ')}` } }); where.push('compensation_type = ?'); args.push(q.compensationType); }
      if (q.featured === 'true') where.push('is_featured = 1');
      if (q.localBusiness === 'true') where.push('is_local_business = 1');
      const order = q.sort === 'posted' ? 'posted_at IS NULL, posted_at DESC, id DESC' : q.sort === 'amount' ? 'max_amount IS NULL, max_amount DESC, id DESC' : 'priority DESC, is_featured DESC, posted_at DESC, id DESC';
      const pageNo = Math.max(1, Number(q.page ?? 1) || 1); const size = Math.min(50, Math.max(1, Number(q.pageSize ?? 20) || 20));
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const [rows] = await pool.query(`SELECT * FROM v_published_gigs ${w} ORDER BY ${order} LIMIT ? OFFSET ?`, [...args, size, (pageNo - 1) * size]);
      const [[c]] = (await pool.query(`SELECT COUNT(*) AS total FROM v_published_gigs ${w}`, args)) as any;
      return { data: (rows as any[]).map(toPublic), page: pageNo, pageSize: size, total: c.total };
    });

    scope.get('/public/v1/gigs/:id', async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      if (!Number.isInteger(id) || id <= 0) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      const [rows] = await pool.query('SELECT * FROM v_published_gigs WHERE id = ?', [id]);
      const r = (rows as any[])[0];
      if (!r) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } }); // unpublished, rejected, unknown: all look the same
      return toPublic(r);
    });

    scope.get('/public/v1/modules', async () => {
      const [rows] = await pool.query('SELECT id, name, description FROM modules WHERE is_active = 1 ORDER BY display_order, id');
      return { data: rows };
    });
  });
}
