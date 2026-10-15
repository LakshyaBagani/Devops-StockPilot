import { formatNumber, formatPaise, formatQty } from '../lib/format.js'

const TOP_MOVERS = 5
const PENDING = '…'

// One line of text, never cards: value · at/below reorder (a filter toggle) · 24 h · 7 d.
// While loading it renders with placeholders, so the search and rows below never jump.
export function SummaryLine({ summary, belowOnly, onToggleBelow }) {
  const show = (format) => (summary ? format(summary) : PENDING)
  const movers = summary ? summary.top_movers.slice(0, TOP_MOVERS) : null
  return (
    <>
      <p className="summary-line" aria-busy={summary ? undefined : true}>
        <span className="summary-chip">
          <span className="num">{show((s) => formatPaise(s.inventory_value_paise, { whole: true }))}</span> stock value
        </span>
        <span className="summary-sep" aria-hidden="true">·</span>
        <button
          type="button"
          className="summary-chip summary-toggle"
          aria-pressed={belowOnly}
          disabled={!summary}
          onClick={onToggleBelow}
        >
          <span className="num">{show((s) => formatNumber(s.items_below_reorder))}</span> at/below reorder
        </button>
        <span className="summary-sep" aria-hidden="true">·</span>
        <span className="summary-chip">
          <span className="num">{show((s) => formatNumber(s.movements_24h))}</span> movements in 24 h
        </span>
        <span className="summary-sep" aria-hidden="true">·</span>
        <span className="summary-chip">
          <span className="num">{show((s) => formatNumber(s.units_out_7d))}</span> units out in 7 d
        </span>
      </p>
      {movers === null && <p className="summary-sub">Moving fastest (7 d): {PENDING}</p>}
      {movers?.length > 0 && (
        <p className="summary-sub">
          Moving fastest (7 d):{' '}
          {movers.map((mover, i) => (
            <span key={mover.product_id}>
              {i > 0 && ', '}
              {mover.name} – <span className="num">{formatQty(mover.units_out_7d, mover.unit)}</span>
            </span>
          ))}
        </p>
      )}
    </>
  )
}
