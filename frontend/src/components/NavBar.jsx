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

// Record sits second in the phone tab bar, as its green action, and last in the desktop header,
// as the solid "Record movement" button. It is rendered in both places (one hidden per breakpoint)
// so focus order follows visual order.
function RecordButton({ placement, sheetOpen }) {
  const wide = placement === 'wide'
  return (
    <li className={wide ? 'sp-nav-item sp-nav-record-wide' : 'sp-nav-item sp-nav-record-phone'}>
      <button
        type="button"
        className={wide ? 'sp-btn sp-btn-action' : 'sp-tab sp-tab-record'}
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        onClick={() => openRecordSheet()}
      >
        {wide ? (
          <span>
            Record<span className="sp-nav-record-more"> movement</span>
          </span>
        ) : (
          <>
            <Icon name="record" size={22} />
            <span className="sp-tab-label">Record</span>
          </>
        )}
      </button>
    </li>
  )
}

export function NavBar({ current, sheetOpen }) {
  const [stock, ...rest] = TABS
  return (
    <nav className="sp-nav" aria-label="Primary">
      <ul className="sp-nav-list">
        <Tab tab={stock} current={current} />
        <RecordButton placement="phone" sheetOpen={sheetOpen} />
        {rest.map((tab) => (
          <Tab key={tab.id} tab={tab} current={current} />
        ))}
        <RecordButton placement="wide" sheetOpen={sheetOpen} />
      </ul>
    </nav>
  )
}
