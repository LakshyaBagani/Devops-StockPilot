import { APP_NAME } from '../config.js'
import { ApiBanner } from './ApiBanner.jsx'
import { ErrorBoundary } from './ErrorBoundary.jsx'
import { Footer } from './Footer.jsx'
import { Link } from './Link.jsx'
import Logo from './Logo.jsx'
import { NavBar } from './NavBar.jsx'

export function AppShell({ tab, pageKey, sheetOpen, children }) {
  return (
    <div className="sp-shell">
      <a className="sp-skip-link" href="#main">
        Skip to content
      </a>
      <header className="sp-header">
        <div className="sp-frame sp-header-row">
          {/* The wordmark: the StockPilot mark, then the name in Geist. */}
          <Link to="/" className="sp-wordmark" aria-label={`${APP_NAME} home`}>
            <Logo />
            <span className="sp-wordmark-stock">Stock</span>Pilot
          </Link>
          <NavBar current={tab} sheetOpen={sheetOpen} />
        </div>
      </header>
      <ApiBanner />
      <main id="main" className="sp-frame sp-main" tabIndex={-1}>
        {/* Keyed on the path, so leaving a crashed screen recovers without a reload. */}
        <ErrorBoundary key={pageKey}>{children}</ErrorBoundary>
      </main>
      <Footer />
    </div>
  )
}
