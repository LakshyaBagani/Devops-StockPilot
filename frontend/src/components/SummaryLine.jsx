import { useId } from 'react'

import { formatNumber, formatPaise } from '../lib/format.js'
import { Icon } from './Icon.jsx'
import { Link } from './Link.jsx'

const TOP_MOVERS = 5
const PENDING = '…'

// One line, never cards: the stock value, then how many products need reordering, as a toggle
// that filters the rows to them. While loading it renders with placeholders, so nothing below jumps.
export function SummaryLine({ summary, belowOnly, onToggleBelow }) {
  const count = summary?.items_below_reorder
  return (
    <p className="sp-stock-summary sp-reveal" style={{ '--i': 1 }} aria-busy={summary ? undefined : true}>
      <span className="sp-stock-worth">
        <span className="num">{summary ? formatPaise(summary.inventory_value_paise, { whole: true }) : PENDING}</span>{' '}
        stock value
      </span>
      <span className="sp-stock-sep" aria-hidden="true">
        ·
      </span>
      <button
        type="button"
        className="sp-reorder-toggle"
        data-none={count === 0 || undefined}
        aria-pressed={belowOnly}
        disabled={!summary}
        onClick={onToggleBelow}
      >
        {belowOnly && <Icon name="check" size={18} />}
        <span>
          <span className="num">{summary ? formatNumber(count) : PENDING}</span> {count === 1 ? 'needs' : 'need'} reorder
        </span>
      </button>
    </p>
  )
}

function Movers({ summary }) {
  const titleId = useId()
  const movers = summary ? summary.top_movers.slice(0, TOP_MOVERS) : null
  if (movers?.length === 0) return null
  return (
    <>
      <p id={titleId} className="sp-movers-title">
        Moving fastest, last 7 d
      </p>
      {movers === null ? (
        <p className="sp-movers-pending">{PENDING}</p>
      ) : (
        <ol className="sp-movers" aria-labelledby={titleId}>
          {movers.map((mover) => (
            <li key={mover.product_id}>
              <Link to={`/products/${mover.product_id}`} className="sp-mover-name">
                {mover.name}
              </Link>
              <span className="sp-mover-qty">
                <span className="num">{formatNumber(mover.units_out_7d)}</span>
                <span className="sp-unit">{mover.unit}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}

// Movement totals and the fastest movers: secondary, so a quiet aside beside the title on wide
// screens and a closed "Stock summary" disclosure on phones.
export function MovementSummary({ summary, collapsible = false }) {
  const show = (format) => (summary ? format(summary) : PENDING)
  const totals = (
    <p className="sp-stock-pace">
      <span className="num">{show((s) => formatNumber(s.movements_24h))}</span> movements in 24 h
      <span className="sp-stock-sep" aria-hidden="true">
        {' '}
        ·{' '}
      </span>
      <span className="visually-hidden">, </span>
      <span className="num">{show((s) => formatNumber(s.units_out_7d))}</span> units out in 7 d
    </p>
  )
  if (collapsible) {
    return (
      <details className="sp-disclosure sp-stock-more">
        <summary>
          <span>Stock summary</span>
          <span className="sp-disclosure-meta">
            <span className="num">{show((s) => formatNumber(s.movements_24h))}</span> movements in 24 h
          </span>
        </summary>
        <div className="sp-disclosure-body">
          {totals}
          <Movers summary={summary} />
        </div>
      </details>
    )
  }
  return (
    <aside className="sp-stock-aside sp-reveal" style={{ '--i': 1 }} aria-label="Stock movement">
      {totals}
      <Movers summary={summary} />
    </aside>
  )
}
