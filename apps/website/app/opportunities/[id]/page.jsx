import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPublicGig, safeExternalUrl } from '@/lib/public-api';

function displayDate(value) {
  if (!value) return 'Not provided';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not provided';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function ContentList({ title, items }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <section className="detail-section">
      <h2>{title}</h2>
      <ul className="detail-list">
        {items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}
      </ul>
    </section>
  );
}

export async function generateMetadata({ params }) {
  const { id } = await params;
  const result = await getPublicGig(id);
  return { title: result.data?.title || 'Opportunity details' };
}

export default async function OpportunityDetailPage({ params }) {
  const { id } = await params;
  const result = await getPublicGig(id);
  if (result.notFound) notFound();

  if (result.error || !result.data) {
    return (
      <div className="page-shell narrow-shell">
        <Link className="back-link" href="/opportunities">← All opportunities</Link>
        <div className="notice notice-error">
          <h1>We couldn’t load this opportunity.</h1>
          <p>{result.error || 'Please try again later.'}</p>
        </div>
      </div>
    );
  }

  const gig = result.data;
  const paused = gig.status === 'paused';
  const applyUrl = safeExternalUrl(gig.applicationUrl || gig.originUrl);

  return (
    <div className="page-shell narrow-shell">
      <Link className="back-link" href="/opportunities">← All opportunities</Link>
      <article className="detail-card">
        <div className="detail-hero">
          <div className="detail-topline">
            <span className="module-pill">{gig.track} · {gig.moduleName || 'Opportunity'}</span>
            <span className={`status-pill ${paused ? 'status-paused' : 'status-active'}`}>{paused ? 'Paused' : 'Active'}</span>
          </div>
          <h1>{gig.title}</h1>
          <p className="detail-intro">{gig.shortDescription || 'Review the opportunity information below before visiting the source.'}</p>
          <div className="detail-meta-grid">
            <div><span className="meta-label">Compensation</span><strong>{gig.paymentAmount || 'Not specified'}</strong></div>
            <div><span className="meta-label">Posted date</span><strong>{displayDate(gig.postedAt)}</strong></div>
            <div><span className="meta-label">Compensation type</span><strong>{gig.compensationType || 'Not specified'}</strong></div>
            <div><span className="meta-label">Last checked</span><strong>{displayDate(gig.lastVerifiedAt)}</strong></div>
          </div>
          <div className="detail-actions">
            {paused ? (
              <span className="button button-disabled" aria-disabled="true">Applications paused</span>
            ) : applyUrl ? (
              <a className="button button-primary" href={applyUrl} target="_blank" rel="noopener noreferrer">Open original opportunity ↗</a>
            ) : (
              <span className="button button-disabled" aria-disabled="true">Application link unavailable</span>
            )}
            {gig.originUrl && safeExternalUrl(gig.originUrl) ? (
              <a className="text-link" href={safeExternalUrl(gig.originUrl)} target="_blank" rel="noopener noreferrer">View source page</a>
            ) : null}
          </div>
          {gig.isFeatured || gig.isLocalBusiness ? (
            <div className="card-tags">
              {gig.isFeatured ? <span className="tag">Featured</span> : null}
              {gig.isLocalBusiness ? <span className="tag">Local business</span> : null}
            </div>
          ) : null}
        </div>

        {gig.overview ? <section className="detail-section"><h2>Overview</h2><p className="detail-copy">{gig.overview}</p></section> : null}
        <ContentList title="Responsibilities" items={gig.responsibilities} />
        <ContentList title="Deliverables" items={gig.deliverables} />
        <ContentList title="Requirements" items={gig.requirements} />
        <ContentList title="Proof / portfolio expectations" items={gig.proofSpec} />

        <div className="detail-disclaimer">
          Always review the original opportunity page for the latest terms, eligibility and application instructions.
        </div>
      </article>
    </div>
  );
}
