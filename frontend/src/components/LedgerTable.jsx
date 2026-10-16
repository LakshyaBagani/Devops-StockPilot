import { useState } from 'react'

import { useNow } from '../hooks/useNow.js'
import { dayGroupLabel, formatClock, formatDelta, formatRelative, parseApiDate } from '../lib/format.js'
import { ConfirmButton } from './ConfirmButton.jsx'
import { Link } from './Link.jsx'

// Movement types as plain words in their own colour, never stamped boxes.
const KIND_WORDS = { IN: 'In', OUT: 'Out', ADJUST: 'Adjust' }
const KIND_TONES = { IN: 'sp-tone-success', OUT: 'sp-tone-danger', ADJUST: 'sp-tone-warning' }

// Rows present on the first render rise into place with the page title (base.css .sp-reveal).
const REVEALED_ROWS = 10

// Rows keep the server order (id DESC); consecutive rows of one local day share a group. Back-dated
// rows (the seed) can bring a day back later, so a group is keyed by its first movement, not its
// label. Ungrouped, every row sits in one headless group and carries its own day instead.
// `position` counts headings and rows top to bottom, for the reveal's stagger.
function groupByDay(movements, nowMs, grouped) {
  const groups = []
  let position = 0
  for (const movement of movements) {
    const date = parseApiDate(movement.created_at)
    const day = dayGroupLabel(date, nowMs)
    if (!grouped) {
      if (groups.length === 0) groups.push({ label: null, rows: [] })
    } else if (groups.at(-1)?.label !== day) {
      groups.push({ label: day, position: position++, rows: [] })
    }
    groups.at(-1).rows.push({ movement, date, day, position: position++ })
  }
  return groups
}

function productLabel(movement) {
  return movement.product_name ?? `#${movement.product_id}`
}

function kindWord(kind) {
  return KIND_WORDS[kind] ?? kind
}

// After the title (--i 0) and the line under it (--i 1); base.css caps the stagger at 240ms.
function rowProps(baseClass, revealed, position) {
  const className = [baseClass, revealed && 'sp-reveal'].filter(Boolean).join(' ') || undefined
  return revealed ? { className, style: { '--i': position + 2 } } : { className }
}

// The movement journal. `onUndo` adds the undo column. For one product's own history, where a day
// rarely holds more than one movement, `showProduct={false}` drops the product column and
// `grouped={false}` puts the day beside each time instead of a heading over every row.
// Stacked rows up to 767px, ruled table rows from 768px (styles/pages/ledger.css).
export function LedgerTable({ movements, onUndo, rowErrors = {}, caption, showProduct = true, grouped = true }) {
  const now = useNow()
  // Later rows (an older page, a new movement) arrive without the page-load reveal.
  const [revealIds] = useState(() => new Set(movements.slice(0, REVEALED_ROWS).map((movement) => movement.id)))
  const columns = 4 + (showProduct ? 1 : 0) + (onUndo ? 1 : 0)
  const tableClass = [
    'sp-table sp-ledger',
    !showProduct && 'sp-ledger-own',
    !grouped && 'sp-ledger-flat',
    onUndo && 'sp-ledger-undoable',
  ]

  return (
    <table className={tableClass.filter(Boolean).join(' ')}>
      {caption && <caption className="visually-hidden">{caption}</caption>}
      <thead>
        <tr>
          <th scope="col" className="sp-ledger-time">
            Time
          </th>
          {showProduct && <th scope="col">Product</th>}
          <th scope="col" className="sp-ledger-note">
            Note
          </th>
          <th scope="col" className="sp-ledger-kind">
            Type
          </th>
          <th scope="col" className="sp-ledger-delta sp-num-col">
            Change
          </th>
          {onUndo && (
            <th scope="col" className="sp-ledger-action">
              <span className="visually-hidden">Undo</span>
            </th>
          )}
        </tr>
      </thead>
      {groupByDay(movements, now, grouped).map((group) => (
        <tbody key={group.rows[0].movement.id}>
          {group.label !== null && (
            <tr {...rowProps('sp-group-row', revealIds.has(group.rows[0].movement.id), group.position)}>
              <th scope="rowgroup" colSpan={columns} className="sp-ledger-day">
                {group.label}
              </th>
            </tr>
          )}
          {group.rows.map(({ movement, date, day, position }) => {
            const errorId = `undo-error-${movement.id}`
            const error = rowErrors[movement.id]
            const name = productLabel(movement)
            const change = `${formatDelta(movement.delta)}${movement.unit ? ` ${movement.unit}` : ''}`
            return (
              <tr key={movement.id} {...rowProps(null, revealIds.has(movement.id), position)}>
                <td className="sp-ledger-time">
                  <time dateTime={date.toISOString()} title={formatRelative(date, now)}>
                    {!grouped && <span className="sp-ledger-date">{day} </span>}
                    <span className="num">{formatClock(date)}</span>
                  </time>
                </td>
                {showProduct && (
                  <td className="sp-ledger-product">
                    <Link to={`/products/${movement.product_id}`} className="sp-ledger-name">
                      {name}
                    </Link>
                    {movement.sku && <span className="sp-sku sp-ledger-sku">{movement.sku}</span>}
                  </td>
                )}
                <td className="sp-ledger-note">{movement.note}</td>
                <td className="sp-ledger-kind">
                  <span className={KIND_TONES[movement.kind]}>{kindWord(movement.kind)}</span>
                </td>
                <td className="sp-ledger-delta" data-kind={movement.kind}>
                  <span className="num">{formatDelta(movement.delta)}</span>
                  {movement.unit && <span className="sp-unit sp-unit-slot">{movement.unit}</span>}
                </td>
                {onUndo && (
                  <td className="sp-ledger-action">
                    <ConfirmButton
                      label="Undo"
                      confirmLabel="Confirm undo"
                      ariaLabel={`Undo ${kindWord(movement.kind)} ${change}, ${name}`}
                      describedBy={error ? errorId : undefined}
                      className="sp-ledger-undo"
                      onConfirm={() => onUndo(movement)}
                    />
                    {error && (
                      <p id={errorId} className="sp-error" role="alert">
                        {error}
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
