import { useState } from 'react'

import { asList, getJson, paths, undoMovement } from '../api.js'
import { LedgerTable } from '../components/LedgerTable.jsx'
import { Link } from '../components/Link.jsx'
import { EmptyState, ErrorState, Skeleton } from '../components/StatusViews.jsx'
import { PAGE_SIZE } from '../config.js'
import { useApiGet } from '../hooks/useApiGet.js'
import { useDocumentTitle } from '../hooks/useDocumentTitle.js'
import { formatDelta } from '../lib/format.js'
import { openRecordSheet, useLocation } from '../router.js'
import { useInventoryEvents } from '../state/inventoryEvents.js'
import { useToast } from '../state/toast.js'

const NO_OLDER = { version: -1, pages: 0, rows: [], done: false, loading: false, error: null }
const KIND_FILTERS = { IN: 'In', OUT: 'Out', ADJUST: 'Adjust' }
const PRODUCT_ID = /^[1-9][0-9]{0,8}$/

// ?product_id= (the product page's "Full ledger →") and ?kind= narrow the journal. Anything the API
// would reject with 422 is ignored, so a mistyped link still shows the whole ledger.
function readFilter(query) {
  const productId = query.get('product_id') ?? ''
  const kind = (query.get('kind') ?? '').toUpperCase()
  return {
    productId: PRODUCT_ID.test(productId) ? Number(productId) : null,
    kind: Object.hasOwn(KIND_FILTERS, kind) ? kind : null,
  }
}

// "Only Out movements of Classmate notebook 172 pages, newest first. Show all". The name comes
// from the rows, so it reads "one product" until they arrive (or when there are none).
function FilterLede({ filter, productName }) {
  const product = productName ? <strong>{productName}</strong> : 'one product'
  const kind = filter.kind && <strong>{KIND_FILTERS[filter.kind]}</strong>
  let subject = product
  if (kind && filter.productId) subject = <>{kind} movements of {product}</>
  else if (kind) subject = <>{kind} movements</>
  return (
    <p className="sp-lede sp-reveal sp-ledger-lede" style={{ '--i': 1 }}>
      Only {subject}, newest first. <Link to="/ledger">Show all</Link>
    </p>
  )
}

export function LedgerPage() {
  useDocumentTitle('Ledger')
  const { query } = useLocation()
  const filter = readFilter(query)
  // A new filter is a new journal: its own first page, older pages and row errors.
  return <LedgerJournal key={`${filter.productId ?? ''}|${filter.kind ?? ''}`} filter={filter} />
}

function LedgerJournal({ filter }) {
  const { version, notifyChanged } = useInventoryEvents()
  const toast = useToast()
  const pageQuery = { productId: filter.productId, kind: filter.kind, limit: PAGE_SIZE.movements }
  const firstPage = useApiGet(paths.movements(pageQuery), { version })
  const [older, setOlder] = useState(NO_OLDER)
  const [rowErrors, setRowErrors] = useState({})
  const filtered = filter.productId !== null || filter.kind !== null

  // Older pages belong to one inventory version; any change starts again from page 1.
  const extra = older.version === version ? older : NO_OLDER
  const firstRows = asList(firstPage.data)
  const movements = [...firstRows, ...extra.rows]
  const hasOlder = extra.pages > 0 ? !extra.done : firstRows.length === PAGE_SIZE.movements

  async function loadOlder() {
    const offset = PAGE_SIZE.movements * (1 + extra.pages)
    setOlder({ ...extra, version, loading: true, error: null })
    try {
      const page = asList(await getJson(paths.movements({ ...pageQuery, offset })))
      // New movements shift the offsets; keep ids strictly decreasing so nothing repeats.
      const lastId = movements.at(-1)?.id ?? Infinity
      const fresh = page.filter((movement) => movement.id < lastId)
      setOlder({
        version,
        pages: extra.pages + 1,
        rows: [...extra.rows, ...fresh],
        done: page.length < PAGE_SIZE.movements,
        loading: false,
        error: null,
      })
    } catch (error) {
      setOlder({ ...extra, version, loading: false, error })
    }
  }

  async function undo(movement) {
    setRowErrors((errors) => {
      const next = { ...errors }
      delete next[movement.id]
      return next
    })
    const unit = movement.unit ? ` ${movement.unit}` : ''
    const label = `${movement.product_name ?? `#${movement.product_id}`} ${formatDelta(movement.delta)}${unit}`
    try {
      await undoMovement(movement.id)
      toast.show({ message: `Undone: ${label}`, tone: 'ok' })
      notifyChanged()
    } catch (error) {
      if (error.status === 404) {
        toast.show({ message: 'Already undone', tone: 'info' })
        notifyChanged()
      } else {
        setRowErrors((errors) => ({ ...errors, [movement.id]: error.message }))
      }
    }
  }

  let body
  if (!firstPage.data && firstPage.loading) body = <Skeleton rows={8} />
  else if (!firstPage.data && firstPage.error) body = <ErrorState error={firstPage.error} onRetry={firstPage.reload} />
  else if (movements.length === 0 && filtered) {
    // The line under the title already offers "Show all".
    body = <EmptyState title="No matching movements" body="Nothing has been recorded for this filter yet." />
  } else if (movements.length === 0) {
    body = (
      <EmptyState
        title="No movements yet"
        body="Record a delivery to start the ledger."
        action={
          <button
            type="button"
            className="sp-btn sp-btn-action"
            aria-haspopup="dialog"
            onClick={() => openRecordSheet({ kind: 'IN' })}
          >
            Record a delivery
          </button>
        }
      />
    )
  } else {
    body = (
      <>
        <div className="sp-table-scroll" data-refreshing={firstPage.loading || undefined}>
          {/* One product's history reads like its product page: no repeated name, the day on each row. */}
          <LedgerTable
            movements={movements}
            onUndo={undo}
            rowErrors={rowErrors}
            showProduct={filter.productId === null}
            grouped={filter.productId === null}
            caption={filtered ? 'Stock movements, filtered, newest first' : 'Stock movements, newest first'}
          />
        </div>
        {extra.error && (
          <p className="sp-error" role="alert">
            {extra.error.message}
          </p>
        )}
        {hasOlder && (
          <p className="sp-ledger-more">
            <button type="button" className="sp-btn" disabled={extra.loading} onClick={loadOlder}>
              {extra.loading ? 'Loading…' : 'Load older'}
            </button>
          </p>
        )}
      </>
    )
  }

  return (
    <section aria-labelledby="ledger-title">
      <header className="sp-page-head">
        <h1 id="ledger-title" className="sp-page-title">
          Ledger
        </h1>
        {filtered ? (
          <FilterLede filter={filter} productName={movements[0]?.product_name} />
        ) : (
          <p className="sp-lede sp-reveal sp-ledger-lede" style={{ '--i': 1 }}>
            Newest first. Entries are never edited: undo and record again.
          </p>
        )}
      </header>
      {body}
    </section>
  )
}
