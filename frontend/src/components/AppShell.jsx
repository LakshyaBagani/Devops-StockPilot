import { APP_NAME } from '../config.js'
import { ApiBanner } from './ApiBanner.jsx'
import { ErrorBoundary } from './ErrorBoundary.jsx'
import { Footer } from './Footer.jsx'
import { Link } from './Link.jsx'
import Logo from './Logo.jsx'
import { NavBar, RecordAction } from './NavBar.jsx'
import { Rail } from './Rail.jsx'

const SECTION_TITLES = { stock: 'Stock', ledger: 'Ledger', planner: 'Planner', products: 'Products' }

// Phones: a slim header with the wordmark and the bottom tab bar. From 640px: the left rail, and a
// sticky top bar with the current section and Record movement.
export function AppShell({ tab, pageKey, sheetOpen, children }) {
  return (
    <div className="sp-shell">
      <a className="sp-skip-link" href="#main">
        Skip to content
      </a>
      <Rail current={tab} />
      <div className="sp-body">
        <header className="sp-header">
          <div className="sp-frame sp-header-row">
            <Link to="/" className="sp-wordmark sp-header-wordmark" aria-label={`${APP_NAME} home`}>
              <Logo />
              <span className="sp-wordmark-stock">Stock</span>Pilot
            </Link>
            <p className="sp-header-crumb">
              <span>{APP_NAME}</span>
              {tab && <span aria-hidden="true"> / </span>}
              {tab && <strong>{SECTION_TITLES[tab]}</strong>}
            </p>
            <RecordAction sheetOpen={sheetOpen} />
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
    </div>
  )
}
