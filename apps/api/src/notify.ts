import crypto from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { pool } from './db.js';

export type Audience = 'learners' | 'site' | 'admins';
export type NotificationType = 'published' | 'unpublished' | 'publish_failed' | 'gig_status_changed';
type Queryable = Pick<PoolConnection, 'query'>;

// Create the notification record (inside the caller's transaction). Delivery happens later, in dispatch().
export async function createNotification(
  conn: Queryable,
  n: { gigId: number | null; publicationId?: number | null; audience: Audience; type: NotificationType; payload: unknown },
): Promise<number> {
  const learnerWebhook = Boolean(process.env.NOTIFY_LEARNER_WEBHOOK_URL);
  // learners: webhook if configured, otherwise a stored in-app event ("notification-ready")
  // site: always a webhook that refreshes the public pages; admins: in-app list
  const channel = n.audience === 'site' ? 'webhook' : n.audience === 'learners' ? (learnerWebhook ? 'webhook' : 'in_app') : 'in_app';
  const [res] = await conn.query(
    'INSERT INTO notifications (publication_id, gig_id, audience, type, channel, payload) VALUES (?, ?, ?, ?, ?, ?)',
    [n.publicationId ?? null, n.gigId, n.audience, n.type, channel, JSON.stringify(n.payload)]);
  return (res as { insertId: number }).insertId;
}

// Send what is pending. A failed delivery is recorded and shown; it never undoes a publish.
export async function dispatch(ids: number[]) {
  const out: { id: number; status: string; error?: string }[] = [];
  for (const id of ids) {
    const [rows] = await pool.query('SELECT * FROM notifications WHERE id = ?', [id]);
    const n = (rows as any[])[0];
    if (!n || n.status === 'sent') continue;
    let status: 'sent' | 'failed' | 'skipped' = 'sent'; let error: string | null = null;

    if (n.channel === 'webhook') {
      const isSite = n.audience === 'site';
      const url = isSite ? process.env.WEBSITE_REVALIDATE_URL : process.env.NOTIFY_LEARNER_WEBHOOK_URL;
      const secret = (isSite ? process.env.REVALIDATE_SECRET : process.env.NOTIFY_LEARNER_WEBHOOK_SECRET) ?? '';
      if (!url) {
        status = 'skipped'; error = isSite ? 'No website refresh address configured (WEBSITE_REVALIDATE_URL)' : 'No learner webhook configured';
      } else {
        const body = JSON.stringify({ event: n.type, notificationId: n.id, gigId: n.gig_id, ...(typeof n.payload === 'string' ? JSON.parse(n.payload) : n.payload) });
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (isSite) headers['x-revalidate-secret'] = secret;
        else if (secret) headers['x-signature'] = crypto.createHmac('sha256', secret).update(body).digest('hex'); // receiver can verify who sent it
        try {
          const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) });
          if (!res.ok) { status = 'failed'; error = `Receiver answered HTTP ${res.status}`; }
        } catch (e) {
          const err = e as Error & { cause?: { code?: string } };
          status = 'failed'; error = `Could not deliver: ${err.cause?.code ?? err.message}`;
        }
      }
    } // in_app: stored and shown in the back office, so it counts as delivered

    await pool.query(
      'UPDATE notifications SET status = ?, attempts = attempts + ?, last_error = ?, sent_at = ? WHERE id = ?',
      [status, status === 'skipped' ? 0 : 1, error, status === 'sent' ? new Date() : null, id]);
    out.push({ id, status, ...(error ? { error } : {}) });
  }
  return out;
}

export async function retryNotification(id: number) {
  const [res] = await pool.query("UPDATE notifications SET status = 'pending' WHERE id = ? AND status IN ('failed','skipped')", [id]);
  if ((res as { affectedRows: number }).affectedRows === 0) return null;
  return dispatch([id]);
}
