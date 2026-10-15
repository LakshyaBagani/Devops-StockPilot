import { Link } from '../components/Link.jsx'
import { useDocumentTitle } from '../hooks/useDocumentTitle.js'

export function NotFoundPage() {
  useDocumentTitle('Not found')
  return (
    <section className="empty-block" aria-labelledby="not-found-title">
      <h1 id="not-found-title" className="page-title">
        No such page
      </h1>
      <p>That address isn&rsquo;t on any shelf here.</p>
      <p className="row-actions">
        <Link to="/" className="btn">
          Stock
        </Link>
        <Link to="/ledger" className="btn">
          Ledger
        </Link>
      </p>
    </section>
  )
}
