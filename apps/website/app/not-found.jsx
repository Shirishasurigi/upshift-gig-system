import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="page-shell narrow-shell">
      <div className="empty-state not-found-state">
        <div className="empty-icon">?</div>
        <h1>Opportunity not found</h1>
        <p>This opportunity may no longer be published, or the link may be incorrect.</p>
        <Link className="button button-primary" href="/opportunities">Browse opportunities</Link>
      </div>
    </div>
  );
}
