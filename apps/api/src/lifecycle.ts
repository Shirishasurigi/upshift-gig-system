import type { PoolConnection } from 'mysql2/promise';
import { createNotification } from './notify.js';

// Take a published gig offline, inside the caller's transaction.
// Used by a person ("unpublish") and by the automatic health check (the opportunity closed).
// Learners are never told about an unpublished gig; the website is refreshed and admins see it.
export async function unpublishInTx(
  conn: PoolConnection, gigId: number,
  opts: { userId: number | null; reason: string; availability?: 'stopped' | 'paused' },
): Promise<number[]> {
  const [pubs] = await conn.query("SELECT id FROM publications WHERE gig_id = ? AND status = 'published' FOR UPDATE", [gigId]);
  const pubId = (pubs as { id: number }[])[0]?.id ?? null;
  await conn.query(
    "UPDATE publications SET status = 'unpublished', unpublished_by = ?, unpublished_at = NOW(3), unpublish_reason = ? WHERE gig_id = ? AND status = 'published'",
    [opts.userId, opts.reason.slice(0, 500), gigId]);
  await conn.query(
    `UPDATE gigs SET workflow_state = 'unpublished'${opts.availability ? ', availability_status = ?' : ''} WHERE id = ?`,
    opts.availability ? [opts.availability, gigId] : [gigId]);
  await conn.query(
    "INSERT INTO audit_log (entity_type, entity_id, action, actor_type, actor_user_id, details) VALUES ('gig', ?, 'unpublished', ?, ?, ?)",
    [gigId, opts.userId ? 'user' : 'system', opts.userId, JSON.stringify({ reason: opts.reason })]);

  const [g] = await conn.query('SELECT title, external_gig_id FROM gigs WHERE id = ?', [gigId]);
  const gig = (g as any[])[0];
  const base = { gigId, title: gig?.title, externalGigId: gig?.external_gig_id, reason: opts.reason, automatic: opts.userId === null };
  return [
    await createNotification(conn, { gigId, publicationId: pubId, audience: 'site', type: 'unpublished', payload: { ...base, paths: ['/opportunities', `/opportunities/${gigId}`] } }),
    await createNotification(conn, { gigId, publicationId: pubId, audience: 'admins', type: opts.userId === null ? 'gig_status_changed' : 'unpublished', payload: base }),
  ];
}
