import type { FastifyInstance } from 'fastify';
import { pool } from './db.js';
import { requireRole } from './auth.js';

const METHODS = ['official_api', 'public_feed', 'public_page_search', 'permitted_crawl', 'csv_import', 'manual_entry', 'undetermined'];
const ENABLEMENT = ['enabled', 'disabled', 'unsupported'];

export async function sourcesRoutes(app: FastifyInstance) {
  app.get('/api/v1/sources', { preHandler: requireRole() }, async () => {
    const [rows] = await pool.query(
      `SELECT id, code, name, access_method, access_method_notes, terms_url, terms_reviewed_at, robots_respected, rate_limit_per_minute,
              enablement, health, health_message, last_health_check_at, last_successful_run_at, referral_required FROM sources ORDER BY id`);
    return { data: rows };
  });

  // Admin only. The database refuses to enable a source whose access method and terms review are not recorded.
  app.patch('/api/v1/sources/:id', { preHandler: requireRole() }, async (req, reply) => {
    const user = req.user as { sub: string; role: string };
    if (user.role !== 'admin') return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Only an admin can change sources' } });
    const id = Number((req.params as { id: string }).id);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = []; const vals: unknown[] = []; const errors: { field: string; message: string }[] = [];
    if ('accessMethod' in b) { if (METHODS.includes(String(b.accessMethod))) { sets.push('access_method = ?'); vals.push(b.accessMethod); } else errors.push({ field: 'accessMethod', message: `one of ${METHODS.join(', ')}` }); }
    if ('accessMethodNotes' in b) { sets.push('access_method_notes = ?'); vals.push(String(b.accessMethodNotes ?? '').slice(0, 5000) || null); }
    if ('termsUrl' in b) { sets.push('terms_url = ?'); vals.push(String(b.termsUrl ?? '').slice(0, 2000) || null); }
    if (b.termsReviewed === true) { sets.push('terms_reviewed_at = NOW(3)', 'terms_reviewed_by = ?'); vals.push(Number(user.sub)); }
    if ('enablement' in b) { if (ENABLEMENT.includes(String(b.enablement))) { sets.push('enablement = ?'); vals.push(b.enablement); } else errors.push({ field: 'enablement', message: `one of ${ENABLEMENT.join(', ')}` }); }
    if ('referralRequired' in b) { if (typeof b.referralRequired === 'boolean') { sets.push('referral_required = ?'); vals.push(b.referralRequired ? 1 : 0); } else errors.push({ field: 'referralRequired', message: 'true or false' }); }
    if ('rateLimitPerMinute' in b) { const n = Number(b.rateLimitPerMinute); if (Number.isInteger(n) && n >= 1 && n <= 600) { sets.push('rate_limit_per_minute = ?'); vals.push(n); } else errors.push({ field: 'rateLimitPerMinute', message: 'whole number 1 to 600' }); }
    if (errors.length) return reply.code(422).send({ error: { code: 'VALIDATION', message: 'Validation failed', details: errors } });
    if (sets.length === 0) return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'Nothing to change' } });
    try {
      const [res] = await pool.query(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
      if ((res as { affectedRows: number }).affectedRows === 0) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Source not found' } });
      await pool.query("INSERT INTO audit_log (entity_type, entity_id, action, actor_type, actor_user_id, details) VALUES ('source', ?, 'updated', 'user', ?, ?)",
        [id, Number(user.sub), JSON.stringify(Object.keys(b))]);
    } catch (e) {
      if ((e as { errno?: number }).errno === 3819) {
        return reply.code(409).send({ error: { code: 'SOURCE_NOT_REVIEWED', message: 'A source cannot be enabled until its access method is chosen and its terms are reviewed (send accessMethod and termsReviewed: true).' } });
      }
      throw e;
    }
    const [rows] = await pool.query('SELECT id, code, access_method, enablement, referral_required, terms_reviewed_at FROM sources WHERE id = ?', [id]);
    return (rows as any[])[0];
  });
}
