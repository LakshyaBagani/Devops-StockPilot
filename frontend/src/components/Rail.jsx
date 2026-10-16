import { APP_NAME } from '../config.js'
import { Icon } from './Icon.jsx'
import { Link } from './Link.jsx'
import Logo from './Logo.jsx'

// The destinations, in one flat list. Phones keep the bottom tab bar.
const LINKS = [
  { id: 'stock', to: '/', label: 'Stock' },
  { id: 'ledger', to: '/ledger', label: 'Ledger' },
  { id: 'planner', to: '/planner', label: 'Planner' },
  { id: 'products', to: '/products', label: 'Products' },
]

// The left rail from 640px: icons only on tablets, icons and labels from 1024px.
export function Rail({ current }) {
  return (
    <aside className="sp-rail">
      <div className="sp-rail-head">
        <Link to="/" className="sp-wordmark" aria-label={`${APP_NAME} home`}>
          <Logo />
          <span className="sp-rail-label">
            <span className="sp-wordmark-stock">Stock</span>Pilot
          </span>
        </Link>
      </div>
      <nav className="sp-rail-nav" aria-label="Primary">
        <ul className="sp-rail-list">
          {LINKS.map((link) => (
            <li key={link.id}>
              <Link
                to={link.to}
                className="sp-rail-link"
                title={link.label}
                aria-current={current === link.id ? 'page' : undefined}
              >
                <Icon name={link.id} size={18} />
                <span className="sp-rail-label">{link.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}
