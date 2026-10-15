import type { ReactNode } from 'react';

export function Badge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="muted">-</span>;
  return <span className={`badge b-${value}`}>{value.replace(/_/g, ' ')}</span>;
}

export function Confidence({ value }: { value: number | string | null | undefined }) {
  if (value === null || value === undefined || value === '') return <span className="muted">not checked</span>;
  const n = Number(value);
  const level = n >= 0.85 ? 'high' : n >= 0.6 ? 'mid' : 'low';
  return (
    <span className="conf" title={`Confidence ${n.toFixed(2)}`}>
      <span className={`bar ${level}`}><span style={{ width: `${Math.round(n * 100)}%` }} /></span>
      {n.toFixed(2)}
    </span>
  );
}

export function Banner({ kind, children }: { kind: 'error' | 'ok' | 'warn'; children: ReactNode }) {
  return <div className={`banner ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function Panel({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="panel">
      <header><h3>{title}</h3>{right}</header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export const fmtDate = (s?: string | null) => (s ? String(s).replace('T', ' ').slice(0, 16) : '-');
export const splitList = (s?: string | null) => (s ? s.split(' | ').filter(Boolean) : []);
