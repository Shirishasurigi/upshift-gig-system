import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorText, type Gig, type Me, type Paged } from '../api';
import { Badge, Banner, fmtDate } from '../ui';

const WHAT: Record<string, string> = {
  published: 'Gig published', unpublished: 'Gig taken offline', publish_failed: 'Publishing was blocked', gig_status_changed: 'Status changed by a check',
};

export default function Notifications({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [audience, setAudience] = useState('');
  const qs = new URLSearchParams({ pageSize: '50' });
  if (status) qs.set('status', status);
  if (audience) qs.set('audience', audience);
  const list = useQuery({ queryKey: ['notifications', qs.toString()], queryFn: () => api<Paged<Gig>>('GET', `/api/v1/notifications?${qs}`) });
  const retry = useMutation({
    mutationFn: (id: number) => api('POST', `/api/v1/notifications/${id}/retry`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <div>
      <h2>Notifications</h2>
      <p className="muted">
        Learners are only told about gigs that really went live. Failed deliveries show here so nothing is lost silently.
      </p>
      <div className="filters">
        <label>Delivery
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any</option>
            {['sent', 'failed', 'skipped', 'pending'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>For
          <select value={audience} onChange={(e) => setAudience(e.target.value)}>
            <option value="">Anyone</option>
            <option value="learners">Learners</option><option value="site">Website</option><option value="admins">Admins</option>
          </select>
        </label>
      </div>
      {retry.isError && <Banner kind="error">{errorText(retry.error)}</Banner>}
      {list.isLoading && <p>Loading...</p>}
      {list.isError && <Banner kind="error">{errorText(list.error)}</Banner>}
      {list.data && (
        <table className="table">
          <thead><tr><th>When</th><th>What</th><th>Gig</th><th>For</th><th>Delivery</th><th>Detail</th><th></th></tr></thead>
          <tbody>
            {list.data.data.map((n) => (
              <tr key={n.id} className={n.status === 'failed' ? 'failed' : ''}>
                <td>{fmtDate(n.created_at)}</td>
                <td>{WHAT[n.type] ?? n.type}</td>
                <td>{n.gig_id ? <Link to={`/gigs/${n.gig_id}`}>{n.gig_title}</Link> : '-'}</td>
                <td>{n.audience} <span className="muted small">({n.channel.replace('_', '-')})</span></td>
                <td><Badge value={n.status === 'sent' ? 'active' : n.status === 'failed' ? 'stopped' : n.status === 'skipped' ? 'paused' : n.status} /> <span className="small">{n.status}</span></td>
                <td className="small">{n.last_error ?? (n.payload?.reason ?? '')}</td>
                <td>{me.role === 'admin' && (n.status === 'failed' || n.status === 'skipped') && <button disabled={retry.isPending} onClick={() => retry.mutate(n.id)}>Retry</button>}</td>
              </tr>
            ))}
            {list.data.data.length === 0 && <tr><td colSpan={7} className="muted">Nothing here.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
