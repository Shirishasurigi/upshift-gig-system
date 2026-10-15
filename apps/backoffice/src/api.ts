// All talking to the backend goes through this one file.
const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

export async function api<T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const hasBody = method !== 'GET' && method !== 'DELETE';
  const res = await fetch(BASE + path, {
    method,
    credentials: 'include', // send the login cookie
    headers: hasBody ? { 'content-type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(body ?? {}) : undefined, // the API wants a JSON body on every POST/PUT/PATCH
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'ERROR', e.message ?? `Request failed (${res.status})`, e.details);
  }
  return data as T;
}

export type Role = 'admin' | 'reviewer' | 'publisher';
export type Me = { id: number; role: Role; name: string };
export type Paged<T> = { data: T[]; page: number; pageSize: number; total: number };
export type Gig = Record<string, any>;

export const MODULES: Record<string, string> = {
  M1: 'AI Video / Reels', M2: 'AI Design / Visual', M3: 'AI Data Annotation / Evaluation',
  M4: 'AI Coding / Development', M5: 'AI Marketing / Growth', M6: 'AI Automation / Agents',
};
export const WORKFLOW_STATES = ['discovered', 'review_pending', 'approved', 'rejected', 'publish_ready', 'published', 'unpublished'];
export const AVAILABILITY = ['active', 'paused', 'stopped', 'needs_review'];

export const errorText = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong');
