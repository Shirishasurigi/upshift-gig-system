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
import readinessBlocked from './fixtures/readiness_blocked.json';
import readinessReady from './fixtures/readiness_ready.json';
import publishOk from './fixtures/publish_ok.json';
import publishStale from './fixtures/publish_stale.json';
import publications from './fixtures/publications.json';
import notifications from './fixtures/notifications.json';
import csvDry from './fixtures/csv_dry_run.json';
import csvImport from './fixtures/csv_import_result.json';
import csvRejected from './fixtures/csv_rejected.json';
import csvJobs from './fixtures/csv_jobs.json';
import csvJobDetail from './fixtures/csv_job_detail.json';
import csvMeta from './fixtures/csv_meta.json';

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
    'GET /api/v1/gigs/1/publish-readiness': () => ({ body: readinessBlocked }),
    'GET /api/v1/publications?': () => ({ body: publications }),
    'GET /api/v1/notifications?': () => ({ body: notifications }),
    'GET /api/v1/csv/jobs': () => ({ body: csvJobs }),
    [`GET /api/v1/csv/jobs/${(csvMeta as any).badId}`]: () => ({ body: csvJobDetail }),
    'GET /api/v1/sources': () => ({ body: sources }),
    'GET /api/v1/discovery/runs?': () => ({ body: runs }),
    'GET /api/v1/discovery/runs/1/errors': () => ({ body: runErrors }),
    ...overrides,
  };
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body instanceof FormData ? { file: (init.body.get('file') as File).name } : init?.body ? JSON.parse(String(init.body)) : undefined;
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


const PUBLISHER = { id: 3, role: 'publisher', name: 'Paul Publisher' };
const ADMIN = { id: 1, role: 'admin', name: 'Admin' };

describe('publishing', () => {
  it('shows what is still missing and keeps Publish disabled for an unapproved gig', async () => {
    installFetch({}, PUBLISHER); renderApp('/gigs/1');
    await screen.findByRole('heading', { name: G.title });
    const missing = (readinessBlocked as any).checks.find((c: any) => c.blocking && !c.ok);
    expect(await screen.findByText(missing.message, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /publish\.\.\./i })).toBeDisabled();
  });

  it('only a publisher can publish: a reviewer sees the checklist but no Publish button', async () => {
    installFetch({ 'GET /api/v1/gigs/1/publish-readiness': () => ({ body: readinessReady }) }); renderApp('/gigs/1');
    await screen.findByRole('heading', { name: G.title });
    expect(await screen.findByText(/Publishing is done by a publisher/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /publish\.\.\./i })).not.toBeInTheDocument();
  });

  it('publishes after an explicit confirmation and reports the delivery of each notification', async () => {
    installFetch({
      'GET /api/v1/gigs/1/publish-readiness': () => ({ body: readinessReady }),
      'POST /api/v1/gigs/1/publish': () => ({ status: 201, body: publishOk }),
    }, PUBLISHER);
    renderApp('/gigs/1');
    await screen.findByRole('heading', { name: G.title });
    await userEvent.click(await screen.findByRole('button', { name: /publish\.\.\./i }));
    expect(screen.getByText(/checked again right now/i)).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/publish'))).toBe(false); // nothing sent before confirming
    await userEvent.click(screen.getByRole('button', { name: /check and publish/i }));
    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent('Published.');
    for (const n of (publishOk as any).notifications) expect(banner).toHaveTextContent(n.status);
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/publish'))).toBeTruthy();
  });

  it('shows the reason in plain words when the final check blocks publishing', async () => {
    installFetch({
      'GET /api/v1/gigs/1/publish-readiness': () => ({ body: readinessReady }),
      'POST /api/v1/gigs/1/publish': () => ({ status: 409, body: publishStale }),
    }, PUBLISHER);
    renderApp('/gigs/1');
    await screen.findByRole('heading', { name: G.title });
    await userEvent.click(await screen.findByRole('button', { name: /publish\.\.\./i }));
    await userEvent.click(screen.getByRole('button', { name: /check and publish/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('no longer confirmed open');
    expect(alert).toHaveTextContent('Review Pending');
  });

  it('requires a reason to unpublish and sends it', async () => {
    installFetch({
      'GET /api/v1/gigs/1': () => ({ body: { ...G, workflow_state: 'published' } }),
      'POST /api/v1/gigs/1/unpublish': () => ({ body: { gigId: 1, workflowState: 'unpublished', notifications: [] } }),
    }, PUBLISHER);
    renderApp('/gigs/1');
    await screen.findByText(/This gig is live/i);
    expect(screen.getByLabelText(/reason \(required\)/i)).toBeRequired();
    await userEvent.type(screen.getByLabelText(/reason \(required\)/i), 'client withdrew');
    await userEvent.click(screen.getByRole('button', { name: 'Unpublish' }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/unpublish'))?.body).toEqual({ reason: 'client withdrew' }));
  });

  it('lists publications, including blocked attempts and automatic take-downs', async () => {
    installFetch({}, ADMIN); renderApp('/publications');
    const failed = (publications as any).data.find((p: any) => p.status === 'failed');
    expect((await screen.findAllByText(failed.failure_reason, { exact: false })).length).toBeGreaterThan(0);
    const auto = (publications as any).data.find((p: any) => p.status === 'unpublished' && !p.unpublished_by);
    if (auto) expect(screen.getAllByText('automatic').length).toBeGreaterThan(0);
  });

  it('lets an admin run the health check and shows the result', async () => {
    installFetch({ 'POST /api/v1/health/sweep': () => ({ body: { checked: 3, unpublished: 1, failures: [], changes: [] } }) }, ADMIN);
    renderApp('/publications');
    await userEvent.click(await screen.findByRole('button', { name: /run health check now/i }));
    expect(await screen.findByRole('status')).toHaveTextContent('Checked 3 published gigs. Taken offline: 1.');
  });

  it('shows failed deliveries and lets only an admin retry them', async () => {
    const failed = (notifications as any).data.find((n: any) => n.status === 'failed');
    installFetch({ [`POST /api/v1/notifications/${failed.id}/retry`]: () => ({ body: { result: [{ id: failed.id, status: 'sent' }] } }) }, ADMIN);
    renderApp('/notifications');
    const row = (await screen.findByText(failed.last_error, { exact: false })).closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith(`/notifications/${failed.id}/retry`))).toBe(true));
  });

  it('a reviewer sees failed notifications but has no Retry button', async () => {
    installFetch(); renderApp('/notifications');
    const failed = (notifications as any).data.find((n: any) => n.status === 'failed');
    await screen.findByText(failed.last_error, { exact: false });
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});


describe('csv import / export', () => {
  const file = () => new File(['external_gig_id,title\n'], 'gigs.csv', { type: 'text/csv' });
  const hrefOf = (name: RegExp) => (screen.getByRole('link', { name }) as HTMLAnchorElement).getAttribute('href') ?? '';

  it('builds the export link from the chosen scope and module, and offers the blank template', async () => {
    installFetch(); renderApp('/csv');
    await screen.findByRole('heading', { name: /csv import/i });
    expect(hrefOf(/download csv/i)).toContain('scope=approved');
    await userEvent.selectOptions(screen.getByLabelText(/which gigs/i), 'published');
    await userEvent.selectOptions(screen.getByLabelText(/^module$/i), 'M5');
    const href = hrefOf(/download csv/i);
    expect(href).toContain('scope=published'); expect(href).toContain('track=M5'); expect(href).toContain('bom=true');
    expect(hrefOf(/blank template/i)).toContain('/api/v1/csv/template');
  });

  it('offers "everything" only to an admin', async () => {
    installFetch({}, ADMIN); const first = renderApp('/csv');
    await screen.findByRole('heading', { name: /csv import/i });
    expect(within(screen.getByLabelText(/which gigs/i)).getByRole('option', { name: /everything/i })).toBeInTheDocument();
    first.unmount();
    installFetch(); renderApp('/csv');
    await screen.findByRole('heading', { name: /csv import/i });
    expect(within(screen.getByLabelText(/which gigs/i)).queryByRole('option', { name: /everything/i })).not.toBeInTheDocument();
  });

  it('hides the import box from a publisher but still lets them export', async () => {
    installFetch({}, PUBLISHER); renderApp('/csv');
    await screen.findByRole('heading', { name: /csv import/i });
    expect(screen.queryByText(/check file/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /download csv/i })).toBeInTheDocument();
  });

  it('forces a check before importing, shows what is wrong, then imports', async () => {
    installFetch({
      'POST /api/v1/csv/import?dryRun=true': () => ({ body: csvDry }),
      'POST /api/v1/csv/import': () => ({ body: { ...(csvImport as any), created: 4, processing: 'started', counts: { ...(csvImport as any).counts, created: 4 } } }),
    });
    renderApp('/csv');
    await screen.findByRole('heading', { name: /csv import/i });
    const importBtn = screen.getByRole('button', { name: 'Import' });
    expect(importBtn).toBeDisabled();
    await userEvent.upload(screen.getByLabelText(/csv file/i), file());
    expect(importBtn).toBeDisabled(); // choosing a file is not enough: it must be checked first
    await userEvent.click(screen.getByRole('button', { name: /check file/i }));
    expect(await screen.findByText(/Nothing was saved/i)).toBeInTheDocument();
    const firstError = (csvDry as any).errors.find((e: any) => e.severity === 'error');
    expect(screen.getByText(firstError.message, { exact: false })).toBeInTheDocument();
    expect(calls.find((c) => c.url.includes('dryRun=true'))?.body).toEqual({ file: 'gigs.csv' });
    expect(importBtn).toBeEnabled();
    await userEvent.click(importBtn);
    expect(await screen.findByText(/Import finished/i)).toBeInTheDocument();
    expect(screen.getByText(/sorted into modules and checked in the background/i)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST' && c.url === '/api/v1/csv/import')).toHaveLength(1);
  });

  it('requires a new check when a different file is chosen', async () => {
    installFetch({ 'POST /api/v1/csv/import?dryRun=true': () => ({ body: csvDry }) });
    renderApp('/csv');
    await screen.findByRole('heading', { name: /csv import/i });
    const input = screen.getByLabelText(/csv file/i);
    await userEvent.upload(input, file());
    await userEvent.click(screen.getByRole('button', { name: /check file/i }));
    await screen.findByText(/Nothing was saved/i);
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled();
    await userEvent.upload(input, new File(['other\n'], 'other.csv', { type: 'text/csv' }));
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('shows the server\'s plain-language reason when a file is refused', async () => {
    installFetch({ 'POST /api/v1/csv/import?dryRun=true': () => ({ status: 422, body: csvRejected }) });
    renderApp('/csv');
    await screen.findByRole('heading', { name: /csv import/i });
    await userEvent.upload(screen.getByLabelText(/csv file/i), file());
    await userEvent.click(screen.getByRole('button', { name: /check file/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('CSV is missing columns');
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('lists recent files and shows the problems of a file with rejected rows', async () => {
    installFetch(); renderApp('/csv');
    const bad = (csvJobs as any).data.find((j: any) => j.id === (csvMeta as any).badId);
    const row = (await screen.findAllByText(bad.file_name)).map((e) => e.closest('tr') as HTMLElement).find((r) => within(r).queryByRole('button', { name: 'Problems' }))!;
    await userEvent.click(within(row).getByRole('button', { name: 'Problems' }));
    const first = (csvJobDetail as any).error_report.find((e: any) => e.severity === 'error');
    expect(await screen.findByText(first.message, { exact: false })).toBeInTheDocument();
  });
});
