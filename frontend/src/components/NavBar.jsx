import { openRecordSheet } from '../router.js'
import { Icon } from './Icon.jsx'
import { Link } from './Link.jsx'

const TABS = [
  { id: 'stock', to: '/', label: 'Stock' },
  { id: 'ledger', to: '/ledger', label: 'Ledger' },
  { id: 'planner', to: '/planner', label: 'Planner' },
  { id: 'products', to: '/products', label: 'Products' },
]

function Tab({ tab, current }) {
  return (
    <li className="sp-nav-item">
      <Link to={tab.to} className="sp-tab" aria-current={current === tab.id ? 'page' : undefined}>
        <Icon name={tab.id} size={22} />
        <span className="sp-tab-label">{tab.label}</span>
      </Link>
    </li>
  )
}

// Phones: Record sits second in the bottom tab bar as its solid action.
function RecordTab({ sheetOpen }) {
  return (
    <li className="sp-nav-item sp-nav-record-phone">
      <button
        type="button"
        className="sp-tab sp-tab-record"
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        onClick={() => openRecordSheet()}
      >
        <Icon name="record" size={22} />
        <span className="sp-tab-label">Record</span>
      </button>
    </li>
  )
}

// From 640px: the solid "Record movement" button on the right of the top bar.
export function RecordAction({ sheetOpen }) {
  return (
    <button
      type="button"
      className="sp-btn sp-btn-action sp-header-record"
      aria-haspopup="dialog"
      aria-expanded={sheetOpen}
      onClick={() => openRecordSheet()}
    >
      <Icon name="record" size={18} />
      <span>Record movement</span>
    </button>
  )
}

// The bottom tab bar, phones only; the rail (Rail.jsx) takes over from 640px.
export function NavBar({ current, sheetOpen }) {
  const [stock, ...rest] = TABS
  return (
    <nav className="sp-nav" aria-label="Primary">
      <ul className="sp-nav-list">
        <Tab tab={stock} current={current} />
        <RecordTab sheetOpen={sheetOpen} />
        {rest.map((tab) => (
          <Tab key={tab.id} tab={tab} current={current} />
        ))}
      </ul>
    </nav>
  )
}
