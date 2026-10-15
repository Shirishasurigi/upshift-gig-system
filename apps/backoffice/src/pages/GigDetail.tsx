import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorText, MODULES, type Gig, type Me } from '../api';
import { Badge, Banner, Confidence, Panel, fmtDate, splitList } from '../ui';

type ActionName = 'approve' | 'reject' | 'reopen' | 'pause' | 'stop' | 'resume';
const ACTION_LABEL: Record<ActionName, string> = { approve: 'Approve', reject: 'Reject', reopen: 'Reopen', pause: 'Pause', stop: 'Stop', resume: 'Resume' };

// Which buttons make sense for this gig. The server is still the final judge.
function allowed(g: Gig): Record<ActionName | 'reclassify' | 'edit', boolean> {
  const s = g.workflow_state as string;
  const live = s !== 'published';
  return {
    approve: s === 'review_pending',
    reject: ['discovered', 'review_pending', 'approved', 'publish_ready'].includes(s),
    reopen: ['rejected', 'approved', 'publish_ready', 'unpublished'].includes(s),
    pause: live, stop: live,
    resume: live && g.availability_set_by === 'human',
    reclassify: live, edit: live,
  };
}

export default function GigDetail({ me }: { me: Me }) {
  const id = Number(useParams().id);
  const qc = useQueryClient();
  const canReview = me.role === 'admin' || me.role === 'reviewer';
  const canReferral = canReview || me.role === 'publisher';
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const gigQ = useQuery({ queryKey: ['gig', id], queryFn: () => api<Gig>('GET', `/api/v1/gigs/${id}`) });
  const gig = gigQ.data;
  const evidenceQ = useQuery({
    queryKey: ['evidence', gig?.latest_verification_id], enabled: Boolean(gig?.latest_verification_id),
    queryFn: () => api<{ data: Gig[] }>('GET', `/api/v1/verifications/${gig!.latest_verification_id}/evidence`),
  });
  const classQ = useQuery({ queryKey: ['classifications', id], queryFn: () => api<{ data: Gig[] }>('GET', `/api/v1/gigs/${id}/classifications`) });
  const dupQ = useQuery({ queryKey: ['duplicates', id], queryFn: () => api<{ data: Gig[] }>('GET', `/api/v1/gigs/${id}/duplicates`) });
  const histQ = useQuery({ queryKey: ['history', id], queryFn: () => api<Gig>('GET', `/api/v1/gigs/${id}/history`) });

  // One helper for every button that changes something
  const refresh = () => {
    for (const k of ['gig', 'evidence', 'classifications', 'duplicates', 'history']) qc.invalidateQueries({ queryKey: [k] });
    qc.invalidateQueries({ queryKey: ['gigs'] });
  };
  const run = useMutation({
    mutationFn: (a: { method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; body?: unknown; okText: string }) => api(a.method, a.path, a.body),
    onSuccess: (_d, a) => { setMessage({ kind: 'ok', text: a.okText }); refresh(); },
    onError: (e) => setMessage({ kind: 'error', text: errorText(e) }),
  });
  const call = (method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, okText: string, body?: unknown) => {
    setMessage(null); run.mutate({ method, path, body, okText });
  };

  if (gigQ.isLoading) return <p>Loading...</p>;
  if (gigQ.isError || !gig) return <Banner kind="error">{errorText(gigQ.error)}</Banner>;
  const can = allowed(gig);
  const flags = gig.flags ?? {};
  const busy = run.isPending;

  return (
    <div>
      <p><Link to="/queue">&larr; Back to queue</Link></p>
      <div className="title-row">
        <h2>{gig.title ?? '(no title)'}</h2>
        <Badge value={gig.workflow_state} /> <Badge value={gig.availability_status} />
      </div>
      <p className="muted">Gig #{gig.id} - {gig.external_gig_id ?? 'no external id'} - source {gig.source_code} - version {gig.current_version}</p>

      {message && <Banner kind={message.kind}>{message.text}</Banner>}
      {flags.missingRequiredFields?.length > 0 && <Banner kind="warn">Missing before it can be approved: {flags.missingRequiredFields.join(', ')}</Banner>}
      {flags.missingReferral && <Banner kind="warn">A referral is required for this source and has not been entered yet.</Banner>}
      {flags.duplicateOpen && <Banner kind="warn">This gig looks like a duplicate of another. Resolve it below before approving.</Banner>}
      {flags.statusSetByHuman && <Banner kind="warn">The status was set by a person, so automatic checks will not change it. Use Resume to hand control back.</Banner>}

      <div className="grid">
        <div className="col">
          <Panel title="Opportunity">
            <Details gig={gig} />
            {canReview && can.edit && <EditForm key={gig.current_version} gig={gig} busy={busy} onSave={(changes, note) => call('PATCH', `/api/v1/gigs/${id}`, 'Changes saved.', { ...changes, note })} />}
            {gig.workflow_state === 'published' && <p className="muted">This gig is published. Unpublish it before changing it.</p>}
          </Panel>

          <Panel title="Why this status? (evidence)" right={canReview && <button disabled={busy} onClick={() => call('POST', `/api/v1/gigs/${id}/verify`, 'Checked again just now.')}>{busy ? 'Working...' : 'Re-check now'}</button>}>
            {gig.latest_verification ? (
              <>
                <p>
                  Result <Badge value={gig.latest_verification.result_status} /> &nbsp; <Confidence value={gig.latest_verification.confidence} />
                  &nbsp; <span className="muted">checked {fmtDate(gig.last_verified_at)}</span>
                </p>
                <ul className="reasons">{(gig.latest_verification.reasons ?? []).map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>
                {evidenceQ.data?.data.map((e) => (
                  <div className="evidence" key={e.id}>
                    <strong>{String(e.evidence_type).replace(/_/g, ' ')}</strong>{e.field_name ? <span className="muted"> ({e.field_name})</span> : null}
                    {e.is_ai_generated ? <span className="badge b-paused">AI</span> : null}
                    {e.extracted_value && <div>{e.extracted_value}</div>}
                    {e.excerpt && <blockquote>{e.excerpt}</blockquote>}
                  </div>
                ))}
                <p><a href={gig.origin_url} target="_blank" rel="noreferrer">Open the original page</a></p>
              </>
            ) : <p className="muted">Not checked yet.</p>}
          </Panel>

          <Panel title="History (who did what)">
            <History data={histQ.data} />
          </Panel>
        </div>

        <div className="col">
          <Panel title="Decision">
            {!canReview && <p className="muted">Your role ({me.role}) cannot make review decisions.</p>}
            {canReview && <Actions can={can} busy={busy} onAct={(a, note) => call('POST', `/api/v1/gigs/${id}/${a}`, `${ACTION_LABEL[a]} done.`, { note })} />}
            {canReview && can.reclassify && <Reclassify gig={gig} busy={busy} onSave={(trackId, note) => call('POST', `/api/v1/gigs/${id}/reclassify`, 'Module updated.', { trackId, note })} />}
            {gig.approved_by && <p className="muted">Approved {fmtDate(gig.approved_at)}</p>}
          </Panel>

          <Panel title="Referral">
            <Referral gig={gig} canEdit={canReferral} busy={busy}
              onSave={(type, value) => call('PUT', `/api/v1/gigs/${id}/referral`, 'Referral saved.', { type, value })}
              onRemove={() => call('DELETE', `/api/v1/gigs/${id}/referral`, 'Referral removed.')} />
          </Panel>

          {gig.pending_source_changes && (
            <Panel title="The source changed this gig">
              <p className="muted">Found in a later run. Nothing was applied automatically.</p>
              <table className="table small"><thead><tr><th>Field</th><th>Now</th><th>Source says</th></tr></thead><tbody>
                {Object.entries(gig.pending_source_changes.changes ?? {}).map(([f, c]: [string, any]) => (
                  <tr key={f}><td>{f}</td><td>{String(c.old ?? '-')}</td><td>{String(c.new ?? '-')}</td></tr>
                ))}
              </tbody></table>
              {canReview && (
                <div className="row">
                  <button disabled={busy || gig.pending_source_changes.reason === 'same_external_id_different_url'} onClick={() => call('POST', `/api/v1/gigs/${id}/source-changes/accept`, 'Source changes applied.', {})}>Accept changes</button>
                  <button disabled={busy} onClick={() => call('POST', `/api/v1/gigs/${id}/source-changes/dismiss`, 'Source changes dismissed.', {})}>Dismiss</button>
                </div>
              )}
            </Panel>
          )}

          {(dupQ.data?.data.length ?? 0) > 0 && (
            <Panel title="Possible duplicates">
              {dupQ.data!.data.map((d) => (
                <div className="dup" key={d.id}>
                  <div>#{d.gig_id} <em>{d.gig_title}</em> looks {(Number(d.similarity) * 100).toFixed(0)}% like #{d.matched_gig_id} <em>{d.matched_title}</em> <Badge value={d.resolution} /></div>
                  {canReview && d.resolution === 'open' && d.gig_id === id && (
                    <div className="row">
                      <button disabled={busy} onClick={() => call('POST', `/api/v1/duplicates/${d.id}/resolve`, 'Marked as not a duplicate.', { resolution: 'dismissed' })}>Not a duplicate</button>
                      <button disabled={busy} onClick={() => call('POST', `/api/v1/duplicates/${d.id}/resolve`, 'Confirmed as a duplicate (gig rejected).', { resolution: 'confirmed_duplicate' })}>It is a duplicate</button>
                    </div>
                  )}
                </div>
              ))}
            </Panel>
          )}

          <Panel title="How the module was chosen">
            {(classQ.data?.data.length ?? 0) === 0 ? <p className="muted">Module came with the source data.</p> :
              classQ.data!.data.map((c) => (
                <p key={c.id} className="small"><strong>{c.proposed_track_id ?? 'none'}</strong> <Badge value={c.outcome} /> {Number(c.confidence).toFixed(2)} - {c.rationale}</p>
              ))}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Details({ gig }: { gig: Gig }) {
  const row = (label: string, value: React.ReactNode) => <div className="kv"><dt>{label}</dt><dd>{value ?? <span className="muted">-</span>}</dd></div>;
  const list = (s?: string | null) => (splitList(s).length ? <ul>{splitList(s).map((i, k) => <li key={k}>{i}</li>)}</ul> : <span className="muted">not given</span>);
  const pay = [gig.payment_amount, gig.compensation_type && `(${gig.compensation_type})`].filter(Boolean).join(' ');
  return (
    <dl>
      {row('Module', gig.track_id ? `${gig.track_id} - ${MODULES[gig.track_id]}` : <span className="badge b-needs_review">no module yet</span>)}
      {row('Pay', pay || <span className="muted">not given</span>)}
      {row('Amount range', gig.min_amount !== null || gig.max_amount !== null ? `${gig.min_amount ?? '?'} to ${gig.max_amount ?? '?'} ${gig.currency ?? ''}` : null)}
      {row('Posted', gig.posted_at ?? <span className="muted">not found in the source</span>)}
      {row('Priority / flags', `${gig.priority}${gig.is_featured ? ' - featured' : ''}${gig.is_local_business ? ' - local business' : ''}`)}
      {row('Short description', gig.short_description)}
      {row('Overview', gig.overview)}
      {row('Responsibilities', list(gig.responsibilities))}
      {row('Deliverables', list(gig.deliverables))}
      {row('Requirements', list(gig.requirements))}
      {row('Proof expected', list(gig.proof_spec))}
      {row('Data completeness', <Badge value={gig.data_completeness} />)}
    </dl>
  );
}

function Actions({ can, busy, onAct }: { can: Record<string, boolean>; busy: boolean; onAct: (a: ActionName, note: string) => void }) {
  const [pending, setPending] = useState<ActionName | null>(null);
  const [note, setNote] = useState('');
  const names: ActionName[] = ['approve', 'reject', 'pause', 'stop', 'resume', 'reopen'];
  const confirm = (e: FormEvent) => {
    e.preventDefault();
    if (pending) { onAct(pending, note); setPending(null); setNote(''); }
  };
  return (
    <div>
      <div className="row wrap">
        {names.map((a) => (
          <button key={a} className={a === 'approve' ? 'primary' : a === 'reject' || a === 'stop' ? 'danger' : ''} disabled={busy || !can[a]} onClick={() => setPending(a)}>
            {ACTION_LABEL[a]}
          </button>
        ))}
      </div>
      {pending && (
        <form className="notebox" onSubmit={confirm}>
          <label>{ACTION_LABEL[pending]}: add a note {pending === 'reject' ? '(required)' : '(optional)'}
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} required={pending === 'reject'} autoFocus />
          </label>
          <div className="row">
            <button className="primary" type="submit">Confirm {ACTION_LABEL[pending].toLowerCase()}</button>
            <button type="button" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

function Reclassify({ gig, busy, onSave }: { gig: Gig; busy: boolean; onSave: (t: string, note: string) => void }) {
  const [track, setTrack] = useState(gig.track_id ?? '');
  return (
    <div className="reclass">
      <label>Module
        <select value={track} onChange={(e) => setTrack(e.target.value)}>
          <option value="">Choose...</option>
          {Object.entries(MODULES).map(([k, v]) => <option key={k} value={k}>{k} {v}</option>)}
        </select>
      </label>
      <button disabled={busy || !track || track === gig.track_id} onClick={() => onSave(track, 'Chosen by a reviewer')}>Set module</button>
    </div>
  );
}

function Referral({ gig, canEdit, busy, onSave, onRemove }: { gig: Gig; canEdit: boolean; busy: boolean; onSave: (t: string, v: string) => void; onRemove: () => void }) {
  const [type, setType] = useState<'id' | 'link'>('link');
  const [value, setValue] = useState('');
  const r = gig.referral;
  return (
    <div>
      {r ? <p>Current: <strong>{r.referral_value}</strong> <span className="muted">({r.referral_type}, entered by {r.entered_by})</span></p> : <p className="muted">No referral entered.</p>}
      {canEdit ? (
        <form className="row wrap" onSubmit={(e) => { e.preventDefault(); onSave(type, value); setValue(''); }}>
          <select value={type} onChange={(e) => setType(e.target.value as 'id' | 'link')}><option value="link">link</option><option value="id">id</option></select>
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={type === 'link' ? 'https://...' : 'referral id'} required aria-label="Referral value" />
          <button type="submit" disabled={busy}>Save</button>
          {r && <button type="button" disabled={busy} onClick={onRemove}>Remove</button>}
        </form>
      ) : <p className="muted">You cannot change referrals.</p>}
      <p className="muted small">Referral codes are always entered by a person. The system never creates accounts on other sites.</p>
    </div>
  );
}

const LIST_FIELDS = ['responsibilities', 'deliverables', 'requirements', 'proof_spec'];
function EditForm({ gig, busy, onSave }: { gig: Gig; busy: boolean; onSave: (changes: Record<string, unknown>, note: string) => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Record<string, any>>(() => ({
    title: gig.title ?? '', payment_amount: gig.payment_amount ?? '', compensation_type: gig.compensation_type ?? '',
    min_amount: gig.min_amount ?? '', max_amount: gig.max_amount ?? '', currency: gig.currency ?? '', priority: String(gig.priority ?? 0),
    is_featured: !!gig.is_featured, is_local_business: !!gig.is_local_business, posted_at: gig.posted_at ?? '',
    short_description: gig.short_description ?? '', overview: gig.overview ?? '',
    ...Object.fromEntries(LIST_FIELDS.map((k) => [k, splitList(gig[k]).join('\n')])),
  }));
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState('');
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const changes: Record<string, unknown> = {};
    const text = (k: string) => (f[k] === '' ? null : String(f[k]).trim());
    const was = (k: string) => (gig[k] === null || gig[k] === undefined ? null : String(gig[k]));
    for (const k of ['title', 'payment_amount', 'compensation_type', 'currency', 'posted_at', 'short_description', 'overview']) {
      const now = text(k); if (now !== was(k)) changes[k] = now;
    }
    for (const k of ['min_amount', 'max_amount']) {
      const now = f[k] === '' ? null : Number(f[k]); const old = gig[k] === null ? null : Number(gig[k]);
      if (now !== old) changes[k] = now;
    }
    if (Number(f.priority) !== Number(gig.priority)) changes.priority = Number(f.priority);
    for (const k of ['is_featured', 'is_local_business']) if (f[k] !== !!gig[k]) changes[k] = f[k];
    for (const k of LIST_FIELDS) {
      const now = String(f[k]).split('\n').map((s) => s.trim()).filter(Boolean);
      if (now.join(' | ') !== splitList(gig[k]).join(' | ')) changes[k] = now.length ? now : null;
    }
    if (Object.keys(changes).length === 0) { setProblem('No changes to save.'); return; }
    setProblem(''); onSave(changes, note); setOpen(false);
  };

  if (!open) return <button onClick={() => setOpen(true)}>Edit details</button>;
  const input = (k: string, label: string, type = 'text') => (
    <label>{label}<input type={type} value={f[k]} onChange={(e) => set(k, e.target.value)} /></label>
  );
  return (
    <form className="editform" onSubmit={submit}>
      {gig.workflow_state === 'approved' || gig.workflow_state === 'publish_ready' ? <Banner kind="warn">Saving will send this gig back to Review Pending, because an approved gig must be approved again after a change.</Banner> : null}
      {input('title', 'Title')}
      <div className="row">
        {input('payment_amount', 'Pay as shown')}
        <label>Pay type
          <select value={f.compensation_type} onChange={(e) => set('compensation_type', e.target.value)}>
            <option value="">(none)</option>{['hourly', 'fixed', 'per_task', 'monthly', 'other'].map((o) => <option key={o}>{o}</option>)}
          </select>
        </label>
      </div>
      <div className="row">{input('min_amount', 'Min', 'number')}{input('max_amount', 'Max', 'number')}{input('currency', 'Currency')}{input('priority', 'Priority', 'number')}</div>
      <div className="row">
        {input('posted_at', 'Posted date', 'date')}
        <label className="check"><input type="checkbox" checked={f.is_featured} onChange={(e) => set('is_featured', e.target.checked)} /> Featured</label>
        <label className="check"><input type="checkbox" checked={f.is_local_business} onChange={(e) => set('is_local_business', e.target.checked)} /> Local business</label>
      </div>
      <label>Short description (max 500)<textarea rows={2} value={f.short_description} onChange={(e) => set('short_description', e.target.value)} /></label>
      <label>Overview<textarea rows={4} value={f.overview} onChange={(e) => set('overview', e.target.value)} /></label>
      {LIST_FIELDS.map((k) => (
        <label key={k}>{k.replace('_', ' ')} (one item per line)
          <textarea rows={3} value={f[k]} onChange={(e) => set(k, e.target.value)} />
        </label>
      ))}
      <label>Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      {problem && <Banner kind="warn">{problem}</Banner>}
      <div className="row"><button className="primary" type="submit" disabled={busy}>Save changes</button><button type="button" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}

function History({ data }: { data?: Gig }) {
  if (!data) return <p className="muted">Loading...</p>;
  const items: { when: string; text: string }[] = [
    ...data.reviews.map((r: Gig) => ({ when: r.created_at, text: `${r.reviewer}: ${r.action}${r.from_workflow_state !== r.to_workflow_state ? ` (${r.from_workflow_state} to ${r.to_workflow_state})` : ''}${r.note ? ` - "${r.note}"` : ''}` })),
    ...data.referralChanges.map((r: Gig) => ({ when: r.created_at, text: `${r.changed_by}: referral ${r.change_type}${r.new_value ? ` to ${r.new_value}` : ''}` })),
    ...data.versions.map((v: Gig) => ({ when: v.created_at, text: `Version ${v.version_no} by ${v.changed_by ?? v.change_origin}${v.changed_fields ? `: ${Object.keys(v.changed_fields).join(', ')}` : ''}` })),
  ].sort((a, b) => String(b.when).localeCompare(String(a.when)));
  if (items.length === 0) return <p className="muted">Nothing yet.</p>;
  return <ul className="history">{items.map((i, k) => <li key={k}><span className="muted">{fmtDate(i.when)}</span> {i.text}</li>)}</ul>;
}
