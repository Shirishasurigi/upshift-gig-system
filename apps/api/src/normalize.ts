import crypto from 'node:crypto';

// ---------- URL ----------
// Remove tracking parts so the same page always gets the same address.
const TRACKING_PARAM = /^(utm_.*|fbclid|gclid|mc_cid|mc_eid|ref|ref_src)$/i;

export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) u.searchParams.delete(key);
    }
    u.searchParams.sort();
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return u.toString();
  } catch {
    return null;
  }
}

// ---------- Text ----------
export function cleanText(raw: string | undefined): string | null {
  const t = (raw ?? '').replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
}

// Lists are stored as: item one | item two | item three
export function cleanList(raw: string | undefined): string | null {
  const items = (raw ?? '')
    .split('|')
    .map((i) => i.replace(/\s+/g, ' ').trim())
    .filter((i) => i !== '');
  return items.length === 0 ? null : items.join(' | ');
}

// ---------- Typed values: each returns { value } or { error } ----------
type Result<T> = { value: T } | { error: string };

export function parseBool(raw: string | undefined): Result<boolean> {
  const t = (raw ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(t)) return { value: true };
  if (['false', '0', 'no', 'n', ''].includes(t)) return { value: false };
  return { error: `"${raw}" is not true/false` };
}

export function parseDate(raw: string | undefined): Result<string | null> {
  const t = (raw ?? '').trim();
  if (t === '') return { value: null }; // missing stays missing: never invented
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return { error: `"${t}" must look like YYYY-MM-DD` };
  const d = new Date(t + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t) {
    return { error: `"${t}" is not a real calendar date` };
  }
  return { value: t };
}

export function parseMoney(raw: string | undefined): Result<number | null> {
  const t = (raw ?? '').trim();
  if (t === '') return { value: null };
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { error: `"${t}" must be a plain number like 45 or 45.50` };
  return { value: Number(t) };
}

export function parseInteger(raw: string | undefined, fallback = 0): Result<number> {
  const t = (raw ?? '').trim();
  if (t === '') return { value: fallback };
  if (!/^-?\d+$/.test(t)) return { error: `"${t}" must be a whole number` };
  return { value: Number(t) };
}

// ---------- Fingerprint ----------
// Same material content => same fingerprint. Used later to detect source changes.
export function fingerprint(parts: (string | number | null)[]): string {
  const text = parts.map((p) => String(p ?? '').toLowerCase().replace(/\s+/g, ' ').trim()).join('\u0001');
  return crypto.createHash('sha256').update(text).digest('hex');
}
