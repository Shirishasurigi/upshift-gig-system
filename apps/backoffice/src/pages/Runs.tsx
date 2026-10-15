import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, errorText, type Gig, type Paged } from '../api';
import { Badge, Banner, fmtDate } from '../ui';

export default function Runs() {
  const [open, setOpen] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const runs = useQuery({
    queryKey: ['runs', status],
    queryFn: () => api<Paged<Gig>>('GET', `/api/v1/discovery/runs?pageSize=50${status ? `&status=${status}` : ''}`),
  });
  const errors = useQuery({
    queryKey: ['run-errors', open], enabled: open !== null,
    queryFn: () => api<{ data: Gig[] }>('GET', `/api/v1/discovery/runs/${open}/errors`),
  });

  return (
    <div>
      <h2>Discovery runs</h2>
      <p className="muted">Every import or discovery run. Partial and failed runs are never shown as successful.</p>
      <div className="filters">
        <label>Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any</option>
            {['succeeded', 'partial', 'failed', 'running', 'queued'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
      {runs.isLoading && <p>Loading...</p>}
      {runs.isError && <Banner kind="error">{errorText(runs.error)}</Banner>}
      {runs.data && (
        <table className="table">
          <thead><tr><th>Run</th><th>Source</th><th>Status</th><th>Started</th><th>Rows</th><th>New</th><th>Updated</th><th>Unchanged</th><th>Failed</th><th></th></tr></thead>
          <tbody>
            {runs.data.data.map((r) => (
              <tr key={r.id}>
                <td>#{r.id}</td><td>{r.source_code}</td><td><Badge value={r.status === 'partial' ? 'paused' : r.status === 'failed' ? 'stopped' : r.status === 'succeeded' ? 'active' : r.status} /> <span className="small">{r.status}</span></td>
                <td>{fmtDate(r.started_at)}</td><td>{r.found_count}</td><td>{r.created_count}</td><td>{r.updated_count}</td><td>{r.unchanged_count}</td><td>{r.failed_count}</td>
                <td>{r.failed_count > 0 || r.status === 'failed' ? <button onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'Why?'}</button> : null}</td>
              </tr>
            ))}
            {runs.data.data.length === 0 && <tr><td colSpan={10} className="muted">No runs yet.</td></tr>}
          </tbody>
        </table>
      )}
      {open !== null && (
        <div className="panel"><header><h3>Problems in run #{open}</h3></header><div className="panel-body">
          {errors.isLoading && <p>Loading...</p>}
          {errors.data?.data.length === 0 && <p className="muted">No problems recorded.</p>}
          <ul>{errors.data?.data.map((e) => <li key={e.id}><strong>{e.stage}</strong> {e.error_code}: {e.message}</li>)}</ul>
        </div></div>
      )}
    </div>
  );
}
