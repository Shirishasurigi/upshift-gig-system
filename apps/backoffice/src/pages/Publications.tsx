import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorText, type Gig, type Me, type Paged } from '../api';
import { Badge, Banner, fmtDate } from '../ui';

export default function Publications({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const list = useQuery({ queryKey: ['publications', status], queryFn: () => api<Paged<Gig>>('GET', `/api/v1/publications?pageSize=50${status ? `&status=${status}` : ''}`) });
  const sweep = useMutation({
    mutationFn: () => api<{ checked: number; unpublished: number; changes: Gig[] }>('POST', '/api/v1/health/sweep'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['publications'] }); qc.invalidateQueries({ queryKey: ['notifications'] }); },
  });

  return (
    <div>
      <h2>Publications</h2>
      <p className="muted">Every time a gig went live, was blocked at the final check, or was taken offline.</p>
      <div className="filters">
        <label>Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any</option>
            {['published', 'unpublished', 'failed'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {me.role === 'admin' && (
          <div>
            <button disabled={sweep.isPending} onClick={() => sweep.mutate()}>{sweep.isPending ? 'Checking all published gigs...' : 'Run health check now'}</button>
          </div>
        )}
      </div>
      {sweep.isError && <Banner kind="error">{errorText(sweep.error)}</Banner>}
      {sweep.data && <Banner kind="ok">Checked {sweep.data.checked} published gigs. Taken offline: {sweep.data.unpublished}.</Banner>}
      {list.isLoading && <p>Loading...</p>}
      {list.isError && <Banner kind="error">{errorText(list.error)}</Banner>}
      {list.data && (
        <table className="table">
          <thead><tr><th>#</th><th>Gig</th><th>Result</th><th>Published</th><th>Offline / why</th></tr></thead>
          <tbody>
            {list.data.data.map((p) => (
              <tr key={p.id} className={p.status === 'failed' ? 'failed' : ''}>
                <td>{p.id}</td>
                <td><Link to={`/gigs/${p.gig_id}`}>{p.title}</Link><div className="muted small">{p.external_gig_id ?? '-'}</div></td>
                <td><Badge value={p.status} /></td>
                <td>{p.published_at ? <>{fmtDate(p.published_at)}<div className="muted small">by {p.published_by}</div></> : <span className="muted">-</span>}</td>
                <td>
                  {p.status === 'unpublished' && <>{fmtDate(p.unpublished_at)} {p.unpublished_by ? `by ${p.unpublished_by}` : <span className="badge b-needs_review">automatic</span>}<div className="small">{p.unpublish_reason}</div></>}
                  {p.status === 'failed' && <span className="small">{p.failure_reason}</span>}
                </td>
              </tr>
            ))}
            {list.data.data.length === 0 && <tr><td colSpan={5} className="muted">Nothing yet.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
