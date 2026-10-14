import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { pool } from './db.js';
import { requireRole } from './auth.js';
import {
  HttpError, editGig, reclassifyGig, transition, resolvePending, setReferral, removeReferral, resolveDuplicate, getHistory,
} from './review.js';

type Handler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
const wrap = (fn: Handler): Handler => async (req, reply) => {
  try { return await fn(req, reply); }
  catch (e) {
    if (e instanceof HttpError) return reply.code(e.status).send({ error: { code: e.code, message: e.message, details: e.details } });
    throw e;
  }
};
const userId = (req: FastifyRequest) => Number((req.user as { sub: string }).sub);
const gigId = (req: FastifyRequest) => {
  const id = Number((req.params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'BAD_REQUEST', 'Invalid id');
  return id;
};
const bodyOf = (req: FastifyRequest) => ((req.body ?? {}) as Record<string, unknown>);
const noteOf = (req: FastifyRequest) => { const n = bodyOf(req).note; return typeof n === 'string' && n.trim() ? n.trim().slice(0, 2000) : null; };

export async function reviewRoutes(app: FastifyInstance) {
  const reviewer = { preHandler: requireRole('reviewer') };
  const referralRole = { preHandler: requireRole('reviewer', 'publisher') };
  const anyUser = { preHandler: requireRole() };

  // --- Edit (REV-03): who changed what, when, is saved ---
  app.patch('/api/v1/gigs/:id', reviewer, wrap(async (req) => {
    const { note, ...fields } = bodyOf(req);
    return editGig(gigId(req), userId(req), fields, typeof note === 'string' ? note : null);
  }));
  app.post('/api/v1/gigs/:id/reclassify', reviewer, wrap(async (req) => {
    const t = bodyOf(req).trackId;
    return reclassifyGig(gigId(req), userId(req), typeof t === 'string' ? t.toUpperCase() : '', noteOf(req));
  }));

  // --- Decisions (REV-04/05/06) ---
  for (const action of ['approve', 'reject', 'reopen', 'pause', 'stop', 'resume'] as const) {
    app.post(`/api/v1/gigs/:id/${action}`, reviewer, wrap(async (req) => transition(gigId(req), userId(req), action, noteOf(req))));
  }

  // --- Held source changes ---
  app.post('/api/v1/gigs/:id/source-changes/accept', reviewer, wrap(async (req) => resolvePending(gigId(req), userId(req), 'accept', noteOf(req))));
  app.post('/api/v1/gigs/:id/source-changes/dismiss', reviewer, wrap(async (req) => resolvePending(gigId(req), userId(req), 'dismiss', noteOf(req))));

  // --- Referral (REF-01..04): entered by people only ---
  app.get('/api/v1/gigs/:id/referral', anyUser, wrap(async (req) => {
    const id = gigId(req);
    const [cur] = await pool.query('SELECT r.id, r.referral_type, r.referral_value, r.entered_at, u.display_name AS entered_by FROM referrals r JOIN users u ON u.id = r.entered_by WHERE r.gig_id = ? AND r.is_active = 1', [id]);
    const [hist] = await pool.query('SELECT h.change_type, h.old_value, h.new_value, h.created_at, u.display_name AS changed_by FROM referral_history h JOIN referrals r ON r.id = h.referral_id JOIN users u ON u.id = h.changed_by WHERE r.gig_id = ? ORDER BY h.id DESC', [id]);
    return { current: (cur as any[])[0] ?? null, history: hist };
  }));
  app.put('/api/v1/gigs/:id/referral', referralRole, wrap(async (req) => {
    const b = bodyOf(req);
    return setReferral(gigId(req), userId(req), String(b.type ?? ''), String(b.value ?? ''));
  }));
  app.delete('/api/v1/gigs/:id/referral', referralRole, wrap(async (req) => removeReferral(gigId(req), userId(req))));

  // --- Duplicates ---
  app.get('/api/v1/gigs/:id/duplicates', anyUser, wrap(async (req) => {
    const id = gigId(req);
    const [rows] = await pool.query(
      `SELECT d.id, d.gig_id, g1.title AS gig_title, d.matched_gig_id, g2.title AS matched_title, g2.external_gig_id AS matched_external_id,
              d.match_signal, d.similarity, d.resolution
         FROM duplicate_candidates d JOIN gigs g1 ON g1.id = d.gig_id JOIN gigs g2 ON g2.id = d.matched_gig_id
        WHERE d.gig_id = ? OR d.matched_gig_id = ? ORDER BY d.id`, [id, id]);
    return { data: rows };
  }));
  app.post('/api/v1/duplicates/:id/resolve', reviewer, wrap(async (req) => {
    const r = bodyOf(req).resolution;
    if (r !== 'confirmed_duplicate' && r !== 'dismissed') throw new HttpError(422, 'VALIDATION', 'resolution must be confirmed_duplicate or dismissed');
    return resolveDuplicate(gigId(req), userId(req), r, noteOf(req));
  }));

  // --- Who did what (REV-07) ---
  app.get('/api/v1/gigs/:id/history', anyUser, wrap(async (req) => getHistory(gigId(req))));
}
