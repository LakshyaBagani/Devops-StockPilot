import { useState } from 'react'

import { asList, getJson, paths, undoMovement } from '../api.js'
import { LedgerTable } from '../components/LedgerTable.jsx'
import { EmptyState, ErrorState, Skeleton } from '../components/StatusViews.jsx'
import { PAGE_SIZE } from '../config.js'
import { useApiGet } from '../hooks/useApiGet.js'
import { useDocumentTitle } from '../hooks/useDocumentTitle.js'
import { formatDelta } from '../lib/format.js'
import { openRecordSheet } from '../router.js'
import { useInventoryEvents } from '../state/inventoryEvents.js'
import { useToast } from '../state/toast.js'

const NO_OLDER = { version: -1, pages: 0, rows: [], done: false, loading: false, error: null }

export function LedgerPage() {
  useDocumentTitle('Ledger')
  const { version, notifyChanged } = useInventoryEvents()
  const toast = useToast()
  const firstPage = useApiGet(paths.movements({ limit: PAGE_SIZE.movements }), { version })
  const [older, setOlder] = useState(NO_OLDER)
  const [rowErrors, setRowErrors] = useState({})

  // Older pages belong to one inventory version; any change starts again from page 1.
  const extra = older.version === version ? older : NO_OLDER
  const firstRows = asList(firstPage.data)
  const movements = [...firstRows, ...extra.rows]
  const hasOlder = extra.pages > 0 ? !extra.done : firstRows.length === PAGE_SIZE.movements

  async function loadOlder() {
    const offset = PAGE_SIZE.movements * (1 + extra.pages)
    setOlder({ ...extra, version, loading: true, error: null })
    try {
      const page = asList(await getJson(paths.movements({ limit: PAGE_SIZE.movements, offset })))
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
    const label = `${movement.product_name ?? `#${movement.product_id}`} ${formatDelta(movement.delta)}`
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
  else if (movements.length === 0) {
    body = (
      <EmptyState
        title="No movements yet"
        body="Record a delivery to start the ledger."
        action={
          <button type="button" className="btn btn-hivis" aria-haspopup="dialog" onClick={() => openRecordSheet({ kind: 'IN' })}>
            Record a delivery
          </button>
        }
      />
    )
  } else {
    body = (
      <>
        <div className="table-scroll" data-refreshing={firstPage.loading || undefined}>
          <LedgerTable movements={movements} onUndo={undo} rowErrors={rowErrors} caption="Stock movements, newest first" />
        </div>
        {extra.error && (
          <p className="field-error" role="alert">
            {extra.error.message}
          </p>
        )}
        {hasOlder && (
          <button type="button" className="btn load-older" disabled={extra.loading} onClick={loadOlder}>
            {extra.loading ? 'Loading…' : 'Load older'}
          </button>
        )}
      </>
    )
  }

  return (
    <section aria-labelledby="ledger-title">
      <header className="page-head">
        <h1 id="ledger-title" className="page-title">
          Ledger
        </h1>
        <p className="page-lede">Every delivery, sale and count correction, newest first. Entries are never edited: undo and record again.</p>
      </header>
      {body}
    </section>
  )
}
