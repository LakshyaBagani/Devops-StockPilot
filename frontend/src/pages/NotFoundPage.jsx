import { Link } from '../components/Link.jsx'
import { useDocumentTitle } from '../hooks/useDocumentTitle.js'

export function NotFoundPage() {
  useDocumentTitle('Not found')
  return (
    <section aria-labelledby="not-found-title">
      <header className="sp-page-head">
        <h1 id="not-found-title" className="sp-page-title">
          No such page
        </h1>
        <p className="sp-lede sp-reveal" style={{ '--i': 1 }}>
          That address isn&rsquo;t on any shelf here.
        </p>
      </header>
      <p className="sp-actions sp-reveal" style={{ '--i': 2 }}>
        <Link to="/" className="sp-btn sp-btn-action">
          Back to stock
        </Link>
        <Link to="/ledger" className="sp-btn">
          Open the ledger
        </Link>
      </p>
    </section>
  )
}
