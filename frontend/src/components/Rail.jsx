import { APP_NAME } from '../config.js'
import { Icon } from './Icon.jsx'
import { Link } from './Link.jsx'
import Logo from './Logo.jsx'

// The destinations, grouped the way a shop thinks about them. Phones keep the bottom tab bar.
const SECTIONS = [
  {
    title: 'Inventory',
    links: [
      { id: 'stock', to: '/', label: 'Stock' },
      { id: 'ledger', to: '/ledger', label: 'Ledger' },
    ],
  },
  { title: 'Planning', links: [{ id: 'planner', to: '/planner', label: 'Planner' }] },
  { title: 'Catalog', links: [{ id: 'products', to: '/products', label: 'Products' }] },
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
        {SECTIONS.map((section) => (
          <div key={section.title} className="sp-rail-group">
            <p className="sp-rail-section">{section.title}</p>
            <ul className="sp-rail-list">
              {section.links.map((link) => (
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
          </div>
        ))}
      </nav>
    </aside>
  )
}
