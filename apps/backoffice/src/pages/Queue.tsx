import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, AVAILABILITY, errorText, MODULES, WORKFLOW_STATES, type Gig, type Paged } from '../api';
import { Badge, Banner, Confidence } from '../ui';

export default function Queue() {
  const [params, setParams] = useSearchParams();
  const state = params.get('state') ?? 'review_pending';
  const availability = params.get('availability') ?? '';
  const track = params.get('track') ?? '';
  const duplicate = params.get('duplicate') ?? '';
  const q = params.get('q') ?? '';
  const page = Number(params.get('page') ?? 1);

  const qs = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (state !== 'all') qs.set('workflowState', state);
  if (availability) qs.set('availability', availability);
  if (track) qs.set('track', track);
  if (duplicate) qs.set('duplicate', duplicate);
  if (q) qs.set('q', q);

  const list = useQuery({ queryKey: ['gigs', qs.toString()], queryFn: () => api<Paged<Gig>>('GET', `/api/v1/gigs?${qs}`) });

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  };
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div>
      <h2>Review queue</h2>
      <p className="muted">Lowest confidence first, so the gigs that need a person most are at the top.</p>
      <div className="filters">
        <label>Stage
          <select value={state} onChange={(e) => set('state', e.target.value)}>
            <option value="all">All</option>
            {WORKFLOW_STATES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <label>Status
          <select value={availability} onChange={(e) => set('availability', e.target.value)}>
            <option value="">Any</option>
            {AVAILABILITY.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <label>Module
          <select value={track} onChange={(e) => set('track', e.target.value)}>
            <option value="">Any</option>
            {Object.entries(MODULES).map(([id, name]) => <option key={id} value={id}>{id} {name}</option>)}
          </select>
        </label>
        <label>Duplicates
          <select value={duplicate} onChange={(e) => set('duplicate', e.target.value)}>
            <option value="">Any</option>
            <option value="suspected">Suspected</option>
            <option value="confirmed">Confirmed</option>
          </select>
        </label>
        <label>Title contains
          <input value={q} onChange={(e) => set('q', e.target.value)} placeholder="search" />
        </label>
      </div>

      {list.isLoading && <p>Loading...</p>}
      {list.isError && <Banner kind="error">{errorText(list.error)}</Banner>}
      {list.data && (
        <>
          <p className="muted">{list.data.total} gig{list.data.total === 1 ? '' : 's'}</p>
          <table className="table">
            <thead><tr><th>ID</th><th>Gig</th><th>Module</th><th>Stage</th><th>Status</th><th>Confidence</th><th>Pay</th><th>Posted</th><th>Flags</th></tr></thead>
            <tbody>
              {list.data.data.map((g) => (
                <tr key={g.id}>
                  <td>{g.id}</td>
                  <td><Link to={`/gigs/${g.id}`}>{g.title ?? '(no title)'}</Link><div className="muted small">{g.external_gig_id ?? '-'} - {g.source_code}</div></td>
                  <td>{g.track_id ? <span title={MODULES[g.track_id]}>{g.track_id}</span> : <span className="badge b-needs_review">no module</span>}</td>
                  <td><Badge value={g.workflow_state} /></td>
                  <td><Badge value={g.availability_status} /></td>
                  <td><Confidence value={g.verification_confidence} /></td>
                  <td>{g.payment_amount ?? <span className="muted">not given</span>}</td>
                  <td>{g.posted_at ?? <span className="muted">not found</span>}</td>
                  <td>
                    {g.duplicate_state !== 'none' && <span className="badge b-paused">duplicate {g.duplicate_state}</span>}
                    {g.data_completeness !== 'complete' && <span className="badge b-needs_review">incomplete</span>}
                  </td>
                </tr>
              ))}
              {list.data.data.length === 0 && <tr><td colSpan={9} className="muted">Nothing here.</td></tr>}
            </tbody>
          </table>
          <div className="pager">
            <button disabled={page <= 1} onClick={() => set('page', String(page - 1))}>Previous</button>
            <span>Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => set('page', String(page + 1))}>Next</button>
          </div>
        </>
      )}
    </div>
  );
}
