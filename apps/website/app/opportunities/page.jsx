import Link from 'next/link';
import { getPublicGigs, getPublicModules, safeExternalUrl } from '@/lib/public-api';

const PAGE_SIZE = 12;

function one(value) {
  return Array.isArray(value) ? value[0] : value;
}

function displayDate(value) {
  if (!value) return 'Date not provided';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date not provided';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function makePageHref(params, page) {
  const search = new URLSearchParams();
  for (const [key, raw] of Object.entries(params)) {
    const value = one(raw);
    if (value !== undefined && value !== null && String(value).trim() !== '') search.set(key, String(value));
  }
  search.set('page', String(page));
  return `/opportunities?${search.toString()}`;
}

function GigCard({ gig }) {
  const applyUrl = safeExternalUrl(gig.applicationUrl || gig.originUrl);
  const paused = gig.status === 'paused';

  return (
    <article className="gig-card">
      <div className="card-topline">
        <span className="module-pill">{gig.track} · {gig.moduleName || 'Opportunity'}</span>
        <span className={`status-pill ${paused ? 'status-paused' : 'status-active'}`}>
          {paused ? 'Paused' : 'Active'}
        </span>
      </div>
      <div className="gig-title-row">
        <h2><Link href={`/opportunities/${gig.id}`}>{gig.title}</Link></h2>
        {gig.isFeatured ? <span className="featured-label">Featured</span> : null}
      </div>
      <p className="gig-description">{gig.shortDescription || 'Explore the opportunity details and requirements.'}</p>
      <div className="gig-meta">
        <div>
          <span className="meta-label">Compensation</span>
          <strong>{gig.paymentAmount || 'Not specified'}</strong>
        </div>
        <div>
          <span className="meta-label">Posted</span>
          <strong>{displayDate(gig.postedAt)}</strong>
        </div>
      </div>
      <div className="card-tags">
        {gig.isLocalBusiness ? <span className="tag">Local business</span> : null}
        {gig.compensationType ? <span className="tag">{gig.compensationType.replaceAll('_', ' ')}</span> : null}
      </div>
      <div className="card-actions">
        <Link className="button button-secondary" href={`/opportunities/${gig.id}`}>View details</Link>
        {paused ? (
          <span className="button button-disabled" aria-disabled="true">Applications paused</span>
        ) : applyUrl ? (
          <a className="button button-primary" href={applyUrl} target="_blank" rel="noopener noreferrer">Open opportunity ↗</a>
        ) : (
          <span className="button button-disabled" aria-disabled="true">Application link unavailable</span>
        )}
      </div>
    </article>
  );
}

export default async function OpportunitiesPage({ searchParams }) {
  const params = await searchParams;
  const filters = {
    q: one(params.q) || '',
    track: one(params.track) || '',
    status: one(params.status) || '',
    compensationType: one(params.compensationType) || '',
    featured: one(params.featured) || '',
    localBusiness: one(params.localBusiness) || '',
    sort: one(params.sort) || 'priority',
  };
  const page = Math.max(1, Number(one(params.page) || 1) || 1);
  const [result, modules] = await Promise.all([
    getPublicGigs({ ...filters, page, pageSize: PAGE_SIZE }),
    getPublicModules(),
  ]);
  const gigs = Array.isArray(result.data) ? result.data : [];
  const totalPages = Math.max(1, Math.ceil((Number(result.total) || 0) / PAGE_SIZE));

  return (
    <div className="page-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">OPPORTUNITY BOARD</p>
          <h1>Find work that moves you <span>forward.</span></h1>
          <p className="hero-description">Explore published opportunities across AI, design, coding, marketing and automation. Review the details, check the requirements, and follow the source link to apply.</p>
        </div>
        <div className="hero-stat">
          <span className="stat-number">{Number(result.total || 0).toLocaleString('en-IN')}</span>
          <span className="stat-caption">published opportunities</span>
        </div>
      </section>

      <section className="browse-layout" aria-label="Browse opportunities">
        <aside className="filters-panel">
          <div className="filters-heading">
            <div>
              <p className="eyebrow">REFINE RESULTS</p>
              <h2>Filters</h2>
            </div>
            <Link href="/opportunities" className="clear-link">Clear all</Link>
          </div>
          <form action="/opportunities" method="get" className="filters-form">
            <label htmlFor="q">Search keywords</label>
            <input id="q" name="q" type="search" placeholder="Try video editing, AI..." defaultValue={filters.q} />

            <label htmlFor="track">Module</label>
            <select id="track" name="track" defaultValue={filters.track}>
              <option value="">All modules</option>
              {modules.map((module) => <option key={module.id} value={module.id}>{module.id} · {module.name}</option>)}
            </select>

            <label htmlFor="status">Availability</label>
            <select id="status" name="status" defaultValue={filters.status}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>

            <label htmlFor="compensationType">Compensation type</label>
            <select id="compensationType" name="compensationType" defaultValue={filters.compensationType}>
              <option value="">All types</option>
              <option value="hourly">Hourly</option>
              <option value="fixed">Fixed</option>
              <option value="per_task">Per task</option>
              <option value="monthly">Monthly</option>
              <option value="other">Other</option>
            </select>

            <label htmlFor="sort">Sort by</label>
            <select id="sort" name="sort" defaultValue={filters.sort}>
              <option value="priority">Recommended</option>
              <option value="posted">Recently posted</option>
              <option value="amount">Compensation</option>
            </select>

            <label className="check-row">
              <input type="checkbox" name="featured" value="true" defaultChecked={filters.featured === 'true'} />
              <span>Featured opportunities</span>
            </label>
            <label className="check-row">
              <input type="checkbox" name="localBusiness" value="true" defaultChecked={filters.localBusiness === 'true'} />
              <span>Local business</span>
            </label>

            <button className="button button-primary filter-submit" type="submit">Apply filters</button>
          </form>
        </aside>

        <div className="results-area">
          <div className="results-heading">
            <div>
              <p className="eyebrow">THE LATEST OPPORTUNITIES</p>
              <h2>{filters.q ? `Results for “${filters.q}”` : 'Explore opportunities'}</h2>
            </div>
            <span className="result-count">{Number(result.total || 0).toLocaleString('en-IN')} results</span>
          </div>

          {result.error ? (
            <div className="notice notice-error">
              <strong>Opportunities could not be loaded.</strong>
              <p>{result.error}</p>
              <p>Start the API in another terminal with <code>npm run dev:api</code>, then refresh this page.</p>
            </div>
          ) : gigs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">⌕</div>
              <h3>No matching opportunities yet</h3>
              <p>Try a different keyword or clear some filters. Only published opportunities appear here.</p>
              <Link className="button button-secondary" href="/opportunities">Reset search</Link>
            </div>
          ) : (
            <div className="gig-grid">
              {gigs.map((gig) => <GigCard key={gig.id} gig={gig} />)}
            </div>
          )}

          {Number(result.total || 0) > PAGE_SIZE ? (
            <nav className="pagination" aria-label="Pagination">
              {page > 1 ? <Link className="button button-secondary" href={makePageHref({ ...params, ...filters }, page - 1)}>← Previous</Link> : <span />}
              <span>Page {page} of {totalPages}</span>
              {page < totalPages ? <Link className="button button-secondary" href={makePageHref({ ...params, ...filters }, page + 1)}>Next →</Link> : <span />}
            </nav>
          ) : null}
        </div>
      </section>
    </div>
  );
}
