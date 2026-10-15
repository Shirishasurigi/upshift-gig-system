import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import me from './fixtures/me.json';
import gigs from './fixtures/gigs.json';
import gig from './fixtures/gig.json';
import evidence from './fixtures/evidence.json';
import classifications from './fixtures/classifications.json';
import duplicates from './fixtures/duplicates.json';
import history from './fixtures/history.json';
import sources from './fixtures/sources.json';
import runs from './fixtures/runs.json';
import runErrors from './fixtures/run_errors.json';

// These JSON files are real answers recorded from the running API, so the screens are tested against the true shapes.
type Handler = (body: any) => { status?: number; body: unknown };
let calls: { method: string; url: string; body: any }[] = [];

function installFetch(overrides: Record<string, Handler> = {}, who: unknown = me) {
  const routes: Record<string, Handler> = {
    'GET /api/v1/auth/me': () => (who ? { body: who } : { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'Please log in' } } }),
    'GET /api/v1/gigs?': () => ({ body: gigs }),
    'GET /api/v1/gigs/1': () => ({ body: gig }),
    [`GET /api/v1/verifications/${(gig as any).latest_verification_id}/evidence`]: () => ({ body: evidence }),
    'GET /api/v1/gigs/1/classifications': () => ({ body: classifications }),
    'GET /api/v1/gigs/1/duplicates': () => ({ body: duplicates }),
    'GET /api/v1/gigs/1/history': () => ({ body: history }),
    'GET /api/v1/sources': () => ({ body: sources }),
    'GET /api/v1/discovery/runs?': () => ({ body: runs }),
    'GET /api/v1/discovery/runs/1/errors': () => ({ body: runErrors }),
    ...overrides,
  };
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => `${method} ${url}` === k || (k.endsWith('?') && `${method} ${url}`.startsWith(k)));
    const r = key ? routes[key](body) : { status: 404, body: { error: { code: 'NOT_FOUND', message: `no mock for ${method} ${url}` } } };
    const status = r.status ?? 200;
    return { ok: status < 400, status, text: async () => JSON.stringify(r.body) } as Response;
  }));
}

function renderApp(path = '/queue') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></QueryClientProvider>);
}
const G = gig as any;

afterEach(() => vi.unstubAllGlobals());

describe('login', () => {
  it('shows a login form when nobody is signed in, and an error for a wrong password', async () => {
    installFetch({ 'POST /api/v1/auth/login': () => ({ status: 401, body: { error: { code: 'INVALID_LOGIN', message: 'Wrong email or password' } } }) }, null);
    renderApp();
    await userEvent.type(await screen.findByLabelText(/email/i), 'a@b.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'nope');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password');
  });

  it('goes to the review queue after a good login', async () => {
    installFetch({ 'POST /api/v1/auth/login': () => ({ body: { ...me, email: 'a@b.com' } }) }, null);
    renderApp();
    await userEvent.type(await screen.findByLabelText(/email/i), 'a@b.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'Passw0rd123');
    // after login the "me" request would now succeed
    installFetch({ 'POST /api/v1/auth/login': () => ({ body: { ...me, email: 'a@b.com' } }) });
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('heading', { name: /review queue/i })).toBeInTheDocument();
  });
});

describe('review queue', () => {
  it('lists gigs from the API and shows the number found', async () => {
    installFetch(); renderApp();
    const first = (gigs as any).data[0];
    expect(await screen.findByRole('link', { name: first.title })).toHaveAttribute('href', `/gigs/${first.id}`);
    expect(screen.getByText(new RegExp(`${(gigs as any).total} gigs?`))).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('workflowState=review_pending'))).toBe(true); // default view
  });

  it('asks the API for stopped gigs when the Status filter is changed', async () => {
    installFetch(); renderApp();
    await screen.findByRole('heading', { name: /review queue/i });
    await userEvent.selectOptions(screen.getByLabelText(/^status$/i), 'stopped');
    await waitFor(() => expect(calls.some((c) => c.url.includes('availability=stopped'))).toBe(true));
  });
});

describe('gig detail', () => {
  it('shows the gig, the evidence and where the page came from', async () => {
    installFetch(); renderApp('/gigs/1');
    expect(await screen.findByRole('heading', { name: G.title })).toBeInTheDocument();
    expect(await screen.findByText(/Why this status/i)).toBeInTheDocument();
    const firstExcerpt = (evidence as any).data.find((e: any) => e.excerpt).excerpt;
    expect(await screen.findByText(firstExcerpt, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open the original page/i })).toHaveAttribute('href', G.origin_url);
  });

  it('warns when a required referral is missing and when the module is missing', async () => {
    const g = { ...G, track_id: null, flags: { ...G.flags, missingReferral: true, missingRequiredFields: ['track_id'] }, referral: null };
    installFetch({ 'GET /api/v1/gigs/1': () => ({ body: g }) }); renderApp('/gigs/1');
    expect(await screen.findByText(/referral is required for this source/i)).toBeInTheDocument();
    expect(screen.getByText(/Missing before it can be approved: track_id/i)).toBeInTheDocument();
    expect(screen.getByText(/no module yet/i)).toBeInTheDocument();
  });

  it('approves with a confirmation step and shows a success message', async () => {
    installFetch({ 'POST /api/v1/gigs/1/approve': () => ({ body: { gigId: 1, action: 'approve', workflowState: 'approved' } }) }); renderApp('/gigs/1');
    await screen.findByRole('heading', { name: G.title });
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await userEvent.type(screen.getByRole('textbox', { name: /add a note/i }), 'looks good');
    await userEvent.click(screen.getByRole('button', { name: /confirm approve/i }));
    expect(await screen.findByRole('status')).toHaveTextContent('Approve done.');
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/approve'))?.body).toEqual({ note: 'looks good' });
  });

  it('shows the server\'s reason in plain words when approval is refused', async () => {
    installFetch({ 'POST /api/v1/gigs/1/approve': () => ({ status: 409, body: { error: { code: 'STOPPED', message: 'A stopped opportunity cannot be approved.' } } }) }); renderApp('/gigs/1');
    await screen.findByRole('heading', { name: G.title });
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await userEvent.click(screen.getByRole('button', { name: /confirm approve/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A stopped opportunity cannot be approved.');
  });

  it('requires a reason before rejecting', async () => {
    installFetch(); renderApp('/gigs/1');
    await screen.findByRole('heading', { name: G.title });
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(screen.getByRole('textbox', { name: /required/i })).toBeRequired();
  });

  it('sends only the fields that changed when editing', async () => {
    installFetch({ 'PATCH /api/v1/gigs/1': () => ({ body: { changed: ['title'], version: 9, workflowState: 'review_pending' } }) }); renderApp('/gigs/1');
    await screen.findByRole('heading', { name: G.title });
    await userEvent.click(screen.getByRole('button', { name: /edit details/i }));
    const title = screen.getByLabelText('Title');
    await userEvent.clear(title); await userEvent.type(title, 'A clearer title');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ title: 'A clearer title', note: '' }));
  });

  it('tells you when there is nothing to save', async () => {
    installFetch(); renderApp('/gigs/1');
    await screen.findByRole('heading', { name: G.title });
    await userEvent.click(screen.getByRole('button', { name: /edit details/i }));
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/no changes to save/i)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('lets a person enter a referral', async () => {
    installFetch({ 'PUT /api/v1/gigs/1/referral': () => ({ body: { gigId: 1, changed: true } }) }); renderApp('/gigs/1');
    await screen.findByRole('heading', { name: G.title });
    await userEvent.type(screen.getByLabelText('Referral value'), 'https://ref.example.com/x');
    await userEvent.click(within(screen.getByLabelText('Referral value').closest('form')!).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ type: 'link', value: 'https://ref.example.com/x' }));
  });

  it('hides review decisions from a publisher', async () => {
    installFetch({}, { id: 3, role: 'publisher', name: 'Paul Publisher' }); renderApp('/gigs/1');
    await screen.findByRole('heading', { name: G.title });
    expect(screen.getByText(/cannot make review decisions/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit details/i })).not.toBeInTheDocument();
  });

  it('lets a reviewer accept or dismiss held source changes, but not a link conflict', async () => {
    const g = { ...G, pending_source_changes: { reason: 'same_external_id_different_url', changes: { origin_url: { old: 'http://a', new: 'http://b' } } } };
    installFetch({ 'GET /api/v1/gigs/1': () => ({ body: g }) }); renderApp('/gigs/1');
    expect(await screen.findByText(/The source changed this gig/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accept changes/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeEnabled();
  });

  it('does not allow editing or deciding on a published gig', async () => {
    installFetch({ 'GET /api/v1/gigs/1': () => ({ body: { ...G, workflow_state: 'published' } }) }); renderApp('/gigs/1');
    await screen.findByRole('heading', { name: G.title });
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
    expect(screen.getByText(/Unpublish it before changing it/i)).toBeInTheDocument();
  });
});

describe('sources and runs', () => {
  it('shows the compliance rule and surfaces the server refusal when enabling an unreviewed source', async () => {
    const mercor = (sources as any).data.find((x: any) => x.code === 'MERCOR');
    installFetch({ [`PATCH /api/v1/sources/${mercor.id}`]: () => ({ status: 409, body: { error: { code: 'SOURCE_NOT_REVIEWED', message: 'A source cannot be enabled until its access method is chosen and its terms are reviewed.' } } }) }, { id: 1, role: 'admin', name: 'Admin' });
    renderApp('/sources');
    const card = (await screen.findByText(/Mercor/)).closest('.panel') as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: 'Enable' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot be enabled until its access method');
  });

  it('shows partial runs and lets you see why rows failed', async () => {
    installFetch(); renderApp('/runs');
    const bad = (runs as any).data.find((r: any) => r.id === 1);
    const row = (await screen.findByText(`#${bad.id}`)).closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Why?' }));
    const first = (runErrors as any).data[0];
    expect(await screen.findByText(first.message, { exact: false })).toBeInTheDocument();
  });
});
