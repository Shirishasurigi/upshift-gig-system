import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiBase, errorText, MODULES, upload, type Gig, type Me } from '../api';
import { Badge, Banner, fmtDate } from '../ui';

type ImportResult = {
  dryRun: boolean; created: number; updated: number; skipped: number; failed: number; processing: string;
  counts: Record<string, number>; errors: { row: number; severity: string; field: string; message: string }[]; notes: string[];
};

export default function Csv({ me }: { me: Me }) {
  const canImport = me.role === 'admin' || me.role === 'reviewer';
  return (
    <div>
      <h2>CSV import / export</h2>
      <p className="muted">One file format in both directions: the 19-column UpShift template.</p>
      <ExportPanel me={me} />
      {canImport && <ImportPanel />}
      <Jobs />
    </div>
  );
}

function ExportPanel({ me }: { me: Me }) {
  const [scope, setScope] = useState('approved');
  const [track, setTrack] = useState('');
  const qs = new URLSearchParams({ scope, bom: 'true' });
  if (track) qs.set('track', track);
  return (
    <section className="panel">
      <header><h3>Export</h3></header>
      <div className="panel-body">
        <div className="row wrap">
          <label>Which gigs
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="approved">Approved by a person (approved + published)</option>
              <option value="published">Only published</option>
              {me.role === 'admin' && <option value="all">Everything (admin)</option>}
            </select>
          </label>
          <label>Module
            <select value={track} onChange={(e) => setTrack(e.target.value)}>
              <option value="">All modules</option>
              {Object.entries(MODULES).map(([k, v]) => <option key={k} value={k}>{k} {v}</option>)}
            </select>
          </label>
          <a className="button primary" href={`${apiBase}/api/v1/csv/export?${qs}`}>Download CSV</a>
          <a className="button" href={`${apiBase}/api/v1/csv/template`}>Blank template</a>
        </div>
        <p className="muted small">
          Unknown values stay empty. Lists use " | " between items. Text starting with = + - @ gets a leading apostrophe so spreadsheets cannot run it as a formula; importing the file removes it again.
        </p>
      </div>
    </section>
  );
}

function ImportPanel() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [checked, setChecked] = useState<string | null>(null); // which file has been checked
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const key = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

  const run = useMutation({
    mutationFn: (a: { dryRun: boolean }) => upload<ImportResult>(`/api/v1/csv/import${a.dryRun ? '?dryRun=true' : ''}`, file!),
    onSuccess: (r, a) => {
      setResult(r); setError('');
      if (a.dryRun) setChecked(key(file!));
      else { qc.invalidateQueries({ queryKey: ['csvjobs'] }); qc.invalidateQueries({ queryKey: ['gigs'] }); }
    },
    onError: (e) => { setResult(null); setError(errorText(e)); },
  });
  const readyToImport = file !== null && checked === key(file);

  return (
    <section className="panel">
      <header><h3>Import</h3></header>
      <div className="panel-body">
        <p className="muted small">
          Step 1: choose a file and check it. Nothing is saved while checking. Step 2: import.
          Imported gigs never skip review: they are sorted into modules and checked first, then wait in the review queue.
        </p>
        <div className="row wrap">
          <label>CSV file
            <input ref={input} type="file" accept=".csv,text/csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setChecked(null); setResult(null); setError(''); }} />
          </label>
          <button disabled={!file || run.isPending} onClick={() => run.mutate({ dryRun: true })}>{run.isPending && run.variables?.dryRun ? 'Checking...' : 'Check file (saves nothing)'}</button>
          <button className="primary" disabled={!readyToImport || run.isPending} onClick={() => run.mutate({ dryRun: false })}>{run.isPending && !run.variables?.dryRun ? 'Importing...' : 'Import'}</button>
        </div>
        {error && <Banner kind="error">{error}</Banner>}
        {result && <Result r={result} />}
      </div>
    </section>
  );
}

function Result({ r }: { r: ImportResult }) {
  const problems = r.errors.filter((e) => e.severity === 'error' || e.severity === 'warning');
  return (
    <div>
      <Banner kind={r.failed > 0 ? 'warn' : 'ok'}>
        {r.dryRun ? 'Check finished. Nothing was saved. ' : 'Import finished. '}
        {r.counts.total} rows: {r.created} new, {r.updated} updated or held for review, {r.skipped} unchanged or in conflict, {r.failed} rejected.
      </Banner>
      {!r.dryRun && r.processing === 'started' && (
        <Banner kind="ok">New gigs are being sorted into modules and checked in the background. They will appear in the <Link to="/queue">review queue</Link> within a minute.</Banner>
      )}
      {r.notes.length > 0 && <ul className="reasons">{r.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      {problems.length > 0 && (
        <table className="table small">
          <thead><tr><th>Line</th><th>Problem</th><th>Column</th><th>What to fix</th></tr></thead>
          <tbody>{problems.map((p, i) => <tr key={i}><td>{p.row}</td><td><Badge value={p.severity === 'error' ? 'stopped' : 'paused'} /> {p.severity}</td><td>{p.field}</td><td>{p.message}</td></tr>)}</tbody>
        </table>
      )}
    </div>
  );
}

function Jobs() {
  const [open, setOpen] = useState<number | null>(null);
  const jobs = useQuery({ queryKey: ['csvjobs'], queryFn: () => api<{ data: Gig[] }>('GET', '/api/v1/csv/jobs') });
  const detail = useQuery({ queryKey: ['csvjob', open], enabled: open !== null, queryFn: () => api<Gig>('GET', `/api/v1/csv/jobs/${open}`) });
  const report = (() => {
    const r = detail.data?.error_report;
    if (!r) return [];
    return (typeof r === 'string' ? JSON.parse(r) : r) as { row: number; severity: string; field: string; message: string }[];
  })();
  return (
    <section className="panel">
      <header><h3>Recent files</h3></header>
      <div className="panel-body">
        {jobs.isLoading && <p>Loading...</p>}
        {jobs.isError && <Banner kind="error">{errorText(jobs.error)}</Banner>}
        {jobs.data && (
          <table className="table small">
            <thead><tr><th>#</th><th>Direction</th><th>File</th><th>Result</th><th>Rows</th><th>New</th><th>Updated</th><th>Unchanged</th><th>Rejected</th><th>By</th><th>When</th><th></th></tr></thead>
            <tbody>
              {jobs.data.data.map((j) => (
                <tr key={j.id}>
                  <td>{j.id}</td><td>{j.direction}</td><td>{j.file_name}</td>
                  <td><Badge value={j.status === 'completed' ? 'active' : j.status === 'failed' ? 'stopped' : 'paused'} /> <span className="small">{String(j.status).replace(/_/g, ' ')}</span></td>
                  <td>{j.total_rows}</td><td>{j.created_rows}</td><td>{j.updated_rows}</td><td>{j.skipped_rows}</td><td>{j.failed_rows}</td>
                  <td>{j.requested_by ?? '-'}</td><td>{fmtDate(j.created_at)}</td>
                  <td>{j.direction === 'import' && (j.failed_rows > 0 || j.status === 'failed') && <button onClick={() => setOpen(open === j.id ? null : j.id)}>{open === j.id ? 'Hide' : 'Problems'}</button>}</td>
                </tr>
              ))}
              {jobs.data.data.length === 0 && <tr><td colSpan={12} className="muted">No files yet.</td></tr>}
            </tbody>
          </table>
        )}
        {open !== null && (
          <div>
            <h4>Problems in file #{open}</h4>
            {detail.isLoading && <p>Loading...</p>}
            <ul>{report.map((p, i) => <li key={i}>line {p.row}, {p.field}: {p.message}</li>)}</ul>
          </div>
        )}
      </div>
    </section>
  );
}
