import { useNow } from '../hooks/useNow.js'
import { dayGroupLabel, formatClock, formatDelta, formatRelative, parseApiDate } from '../lib/format.js'
import { ConfirmButton } from './ConfirmButton.jsx'
import { Link } from './Link.jsx'

const STAMPS = { IN: 'IN', OUT: 'OUT', ADJUST: 'ADJ' }

// Rows keep the server order (id DESC); consecutive rows of one local day share a group. Back-dated
// rows (the seed) can bring a day back later, so a group is keyed by its first movement, not its label.
function groupByDay(movements, nowMs) {
  const groups = []
  for (const movement of movements) {
    const date = parseApiDate(movement.created_at)
    const label = dayGroupLabel(date, nowMs)
    if (groups.at(-1)?.label !== label) groups.push({ label, rows: [] })
    groups.at(-1).rows.push({ movement, date })
  }
  return groups
}

function productLabel(movement) {
  return movement.product_name ?? `#${movement.product_id}`
}

export function LedgerTable({ movements, onUndo, rowErrors = {}, caption }) {
  const now = useNow()
  const columns = onUndo ? 6 : 5
  return (
    <table className="ledger-table movement-table">
      {caption && <caption className="visually-hidden">{caption}</caption>}
      <thead>
        <tr>
          <th scope="col">Time</th>
          <th scope="col">Product</th>
          <th scope="col">Type</th>
          <th scope="col" className="num-col">
            Change
          </th>
          <th scope="col">Note</th>
          {onUndo && (
            <th scope="col">
              <span className="visually-hidden">Undo</span>
            </th>
          )}
        </tr>
      </thead>
      {groupByDay(movements, now).map((group) => (
        <tbody key={group.rows[0].movement.id}>
          <tr className="day-row">
            <th scope="colgroup" colSpan={columns}>
              {group.label}
            </th>
          </tr>
          {group.rows.map(({ movement, date }) => {
            const errorId = `undo-error-${movement.id}`
            const name = productLabel(movement)
            return (
              <tr key={movement.id}>
                <td className="c-time">
                  <time className="num" dateTime={date.toISOString()} title={formatRelative(date, now)}>
                    {formatClock(date)}
                  </time>
                </td>
                <td className="c-product">
                  <span className="num c-sku-inline">{movement.sku}</span>{' '}
                  <Link to={`/products/${movement.product_id}`}>{name}</Link>
                </td>
                <td className="c-kind">
                  <span className="stamp" data-kind={movement.kind}>
                    {STAMPS[movement.kind] ?? movement.kind}
                  </span>
                </td>
                <td className="c-delta num" data-kind={movement.kind}>
                  {formatDelta(movement.delta)}
                  {movement.unit && <span className="c-unit"> {movement.unit}</span>}
                </td>
                <td className="c-note">{movement.note}</td>
                {onUndo && (
                  <td className="c-action">
                    <ConfirmButton
                      label="Undo"
                      confirmLabel="Confirm undo"
                      ariaLabel={`Undo ${movement.kind} ${formatDelta(movement.delta)} ${name}`}
                      describedBy={rowErrors[movement.id] ? errorId : undefined}
                      onConfirm={() => onUndo(movement)}
                    />
                    {rowErrors[movement.id] && (
                      <p id={errorId} className="field-error" role="alert">
                        {rowErrors[movement.id]}
                      </p>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      ))}
    </table>
  )
}
