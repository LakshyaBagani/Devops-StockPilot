import { APP_SUBTITLE } from '../config.js'
import { ApiBanner } from './ApiBanner.jsx'
import { ErrorBoundary } from './ErrorBoundary.jsx'
import { Footer } from './Footer.jsx'
import { Icon } from './Icon.jsx'
import { Link } from './Link.jsx'
import { NavBar } from './NavBar.jsx'

export function AppShell({ tab, pageKey, sheetOpen, children }) {
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="wordmark" aria-label="StockPilot home">
            <Icon name="crate" size={26} />
            <span>StockPilot</span>
          </Link>
          <p className="subtitle">{APP_SUBTITLE}</p>
          <NavBar current={tab} sheetOpen={sheetOpen} />
        </div>
      </header>
      <ApiBanner />
      <main id="main" className="page" tabIndex={-1}>
        {/* Keyed on the path, so leaving a crashed screen recovers without a reload. */}
        <ErrorBoundary key={pageKey}>{children}</ErrorBoundary>
      </main>
      <Footer />
    </div>
  )
}
