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
    <li>
      <Link to={tab.to} className="tab" aria-current={current === tab.id ? 'page' : undefined}>
        <Icon name={tab.id} />
        <span>{tab.label}</span>
      </Link>
    </li>
  )
}

// Record sits second in the phone tab bar and last, as the hi-vis button, in the desktop header.
// It is rendered in both places (one hidden per breakpoint) so focus order follows visual order.
function RecordButton({ placement, sheetOpen }) {
  return (
    <li className={`tab-record tab-record-${placement}`}>
      <button
        type="button"
        className="tab"
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        onClick={() => openRecordSheet()}
      >
        <Icon name="record" />
        <span>{placement === 'wide' ? 'Record movement' : 'Record'}</span>
      </button>
    </li>
  )
}

export function NavBar({ current, sheetOpen }) {
  const [stock, ...rest] = TABS
  return (
    <nav className="tabbar" aria-label="Primary">
      <ul>
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
