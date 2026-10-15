import './globals.css';

export const metadata = {
  title: {
    default: 'UpShift Opportunities',
    template: '%s | UpShift Opportunities',
  },
  description: 'Explore verified AI, creative, development, marketing and automation opportunities.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="header-inner">
            <a className="brand" href="/opportunities" aria-label="UpShift Opportunities home">
              <span className="brand-mark">U</span>
              <span>upshift<span className="brand-light"> opportunities</span></span>
            </a>
            <span className="header-note">Discover your next opportunity</span>
          </div>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <div className="footer-inner">
            <span>UpShift Gig Discovery &amp; Publishing System</span>
            <span>Opportunities are verified before publication.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
