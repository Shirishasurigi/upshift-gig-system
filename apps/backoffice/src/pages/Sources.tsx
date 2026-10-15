import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorText, type Gig, type Me } from '../api';
import { Badge, Banner, fmtDate } from '../ui';

const METHODS = ['undetermined', 'official_api', 'public_feed', 'public_page_search', 'permitted_crawl', 'csv_import', 'manual_entry'];

export default function Sources({ me }: { me: Me }) {
  const qc = useQueryClient();
  const isAdmin = me.role === 'admin';
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const list = useQuery({ queryKey: ['sources'], queryFn: () => api<{ data: Gig[] }>('GET', '/api/v1/sources') });
  const save = useMutation({
    mutationFn: (a: { id: number; body: Record<string, unknown> }) => api('PATCH', `/api/v1/sources/${a.id}`, a.body),
    onSuccess: () => { setMessage({ kind: 'ok', text: 'Source saved.' }); qc.invalidateQueries({ queryKey: ['sources'] }); },
    onError: (e) => setMessage({ kind: 'error', text: errorText(e) }),
  });

  return (
    <div>
      <h2>Sources</h2>
      <p className="muted">
        A source can only be switched on after a permitted access method is chosen and its terms have been reviewed.
        Automatic collection never bypasses logins, CAPTCHAs, paywalls, robots.txt or rate limits.
      </p>
      {message && <Banner kind={message.kind}>{message.text}</Banner>}
      {list.isLoading && <p>Loading...</p>}
      {list.isError && <Banner kind="error">{errorText(list.error)}</Banner>}
      {list.data?.data.map((s) => <SourceCard key={s.id} s={s} isAdmin={isAdmin} busy={save.isPending} onSave={(body) => { setMessage(null); save.mutate({ id: s.id, body }); }} />)}
    </div>
  );
}

function SourceCard({ s, isAdmin, busy, onSave }: { s: Gig; isAdmin: boolean; busy: boolean; onSave: (b: Record<string, unknown>) => void }) {
  const [method, setMethod] = useState<string>(s.access_method);
  const [reviewed, setReviewed] = useState(false);
  const [referral, setReferral] = useState<boolean>(!!s.referral_required);
  return (
    <div className="panel source">
      <header>
        <h3>{s.name} <span className="muted small">({s.code})</span></h3>
        <span><Badge value={s.enablement} /> <Badge value={s.health} /></span>
      </header>
      <div className="panel-body">
        <p className="small muted">
          Access method: <strong>{String(s.access_method).replace(/_/g, ' ')}</strong> - terms reviewed: {s.terms_reviewed_at ? fmtDate(s.terms_reviewed_at) : 'not yet'} -
          limit {s.rate_limit_per_minute} requests/minute - last good run {fmtDate(s.last_successful_run_at)}
        </p>
        {s.access_method_notes && <p className="small">{s.access_method_notes}</p>}
        {isAdmin && (
          <div className="row wrap">
            <label>Access method
              <select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}</select>
            </label>
            <label className="check"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> I reviewed this source's terms</label>
            <label className="check"><input type="checkbox" checked={referral} onChange={(e) => setReferral(e.target.checked)} /> Referral required to publish</label>
            <button disabled={busy} onClick={() => onSave({ accessMethod: method, ...(reviewed ? { termsReviewed: true } : {}), referralRequired: referral })}>Save</button>
            {s.enablement !== 'enabled'
              ? <button className="primary" disabled={busy} onClick={() => onSave({ accessMethod: method, ...(reviewed ? { termsReviewed: true } : {}), enablement: 'enabled' })}>Enable</button>
              : <button disabled={busy} onClick={() => onSave({ enablement: 'disabled' })}>Disable</button>}
          </div>
        )}
      </div>
    </div>
  );
}
