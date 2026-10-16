import { useSyncExternalStore } from 'react'

import { asList, paths } from '../api.js'
import { CategoryChips } from '../components/CategoryChips.jsx'
import { CoverBar } from '../components/CoverBar.jsx'
import { Icon } from '../components/Icon.jsx'
import { Link } from '../components/Link.jsx'
import { EmptyState, ErrorState, Skeleton } from '../components/StatusViews.jsx'
import { MovementSummary, SummaryLine } from '../components/SummaryLine.jsx'
import { CATEGORIES, LIMITS, PAGE_SIZE, categoryLabel } from '../config.js'
import { useApiGet } from '../hooks/useApiGet.js'
import { useDebouncedValue } from '../hooks/useDebouncedValue.js'
import { useDocumentTitle } from '../hooks/useDocumentTitle.js'
import { needsReorder } from '../lib/cover.js'
import { formatNumber, formatPaise } from '../lib/format.js'
import { openRecordSheet, setQuery, useLocation } from '../router.js'
import { useInventoryEvents } from '../state/inventoryEvents.js'

// Phones put the search straight under the title; from 640px the summary sits under the title;
// from 1024px the movement totals become an aside instead of a disclosure. Choosing in JS rather
// than reordering with CSS keeps the DOM, and so the focus order, the same as what is on screen.
// The breakpoints are the stylesheet's.
const WIDE = '(min-width: 640px)'
const ROOMY = '(min-width: 1024px)'
const mediaLists = new Map()

function media(query) {
  if (!mediaLists.has(query)) mediaLists.set(query, window.matchMedia(query))
  return mediaLists.get(query)
}

function subscribeMedia(onChange) {
  const lists = [media(WIDE), media(ROOMY)]
  for (const list of lists) list.addEventListener('change', onChange)
  return () => {
    for (const list of lists) list.removeEventListener('change', onChange)
  }
}

// One primitive snapshot for both queries, so React compares it cheaply: 0 phone, 1 wide, 2 roomy.
function layoutSnapshot() {
  if (media(ROOMY).matches) return 2
  return media(WIDE).matches ? 1 : 0
}

function useLayout() {
  const level = useSyncExternalStore(subscribeMedia, layoutSnapshot)
  return { wide: level >= 1, roomy: level === 2 }
}

// A printed dot between quiet facts; screen readers hear a comma instead.
function Sep() {
  return (
    <>
      <span aria-hidden="true"> · </span>
      <span className="visually-hidden">, </span>
    </>
  )
}

function StockRow({ product }) {
  const reorder = needsReorder(product.on_hand, product.reorder_point)
  return (
    // A product at or below its reorder point: a 3px warning edge and the plain word, no pill.
    <tr className={reorder ? 'sp-mark-row sp-mark-warning' : undefined}>
      <td className="sp-stock-product">
        <Link to={`/products/${product.id}`} className="sp-stock-name">
          {product.name}
        </Link>
        <span className="sp-stock-meta">
          {reorder && (
            <>
              <span className="sp-tone-warning">Reorder</span>
              <Sep />
            </>
          )}
          <span className="sp-sku">{product.sku}</span>
          <Sep />
          {categoryLabel(product.category)}
        </span>
      </td>
      <td className="sp-stock-onhand sp-num-col">
        <span className="num">{formatNumber(product.on_hand)}</span>
        <span className="sp-unit sp-unit-slot">{product.unit}</span>
      </td>
      <td className="sp-stock-value sp-num-col" data-label="worth">
        <span className="num">{formatPaise(product.value_paise)}</span>
      </td>
      <td className="sp-stock-cover">
        <CoverBar daysOfCover={product.days_of_cover} leadTimeDays={product.lead_time_days} onHand={product.on_hand} />
      </td>
      <td className="sp-stock-action">
        <button
          type="button"
          className="sp-btn sp-btn-quiet sp-stock-record"
          aria-haspopup="dialog"
          onClick={() => openRecordSheet({ product: product.id, kind: 'OUT' })}
        >
          Record<span className="visually-hidden"> movement for {product.name}</span>
        </button>
      </td>
    </tr>
  )
}

export function StockPage() {
  useDocumentTitle('Stock')
  const { query } = useLocation()
  const { version } = useInventoryEvents()
  const { wide, roomy } = useLayout()

  // The URL is the only filter state: q updates on every keystroke (replace), the request waits
  // for a 250 ms pause. Rows keep the server's order and are never re-sorted on the client.
  const q = query.get('q') ?? ''
  const rawCategory = query.get('category') ?? ''
  const category = CATEGORIES.some((c) => c.value === rawCategory) ? rawCategory : ''
  const belowOnly = query.get('below') === '1'
  const searchTerm = useDebouncedValue(q.trim(), 250)

  const products = useApiGet(
    paths.products({ q: searchTerm, category, belowReorder: belowOnly, limit: PAGE_SIZE.products }),
    { version },
  )
  const summary = useApiGet(paths.summary(), { version })
  const rows = asList(products.data)
  const filtered = Boolean(q.trim() || category || belowOnly)

  function clearFilters() {
    setQuery({ q: null, category: null, below: null })
  }

  let body
  if (!products.data && products.loading) body = <Skeleton rows={6} />
  else if (!products.data && products.error) body = <ErrorState error={products.error} onRetry={products.reload} />
  else if (rows.length === 0 && filtered) {
    body = (
      <EmptyState
        title={q.trim() ? `No products match “${q.trim()}”` : 'No products match these filters'}
        action={
          <button type="button" className="sp-btn" onClick={clearFilters}>
            Clear filters
          </button>
        }
      />
    )
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        title="No products yet"
        body="Add the first product, then record a delivery to start the ledger."
        action={
          <Link to="/products/new" className="sp-btn sp-btn-action">
            New product
          </Link>
        }
      />
    )
  } else {
    body = (
      <div className="sp-table-scroll" data-refreshing={products.loading || undefined}>
        <table className="sp-table sp-stock-table" aria-busy={products.loading || undefined}>
          <caption className="visually-hidden">Stock on hand, in SKU order</caption>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col" className="sp-num-col">
                On hand
              </th>
              <th scope="col" className="sp-num-col">
                Value
              </th>
              <th scope="col">Days of cover</th>
              <th scope="col">
                <span className="visually-hidden">Record</span>
              </th>
            </tr>
          </thead>
          <tbody className="sp-reveal-rows">
            {rows.map((product) => (
              <StockRow key={product.id} product={product} />
            ))}
          </tbody>
        </table>
        {rows.length >= PAGE_SIZE.products && (
          <p className="sp-hint sp-stock-more-hint">
            Showing the first {PAGE_SIZE.products} products. Search to narrow the list.
          </p>
        )}
      </div>
    )
  }

  const summaryLine = (
    <SummaryLine
      summary={summary.data}
      belowOnly={belowOnly}
      onToggleBelow={() => setQuery({ below: belowOnly ? null : '1' })}
    />
  )
  const search = (
    <div className="sp-stock-search" role="search">
      <label className="visually-hidden" htmlFor="stock-search">
        Search SKU or name
      </label>
      <span className="sp-search">
        <Icon name="search" size={20} />
        <input
          id="stock-search"
          type="search"
          autoComplete="off"
          spellCheck="false"
          enterKeyHint="search"
          placeholder="Search SKU or name"
          maxLength={LIMITS.search}
          value={q}
          onChange={(event) => setQuery({ q: event.target.value })}
        />
      </span>
    </div>
  )
  const chips = <CategoryChips value={category} onChange={(value) => setQuery({ category: value })} />
  const movement = <MovementSummary summary={summary.data} collapsible={!roomy} />

  // Phones: title, search, summary, the movement disclosure, chips.
  // From 640px: title, summary and the disclosure; then search and chips.
  // From 1024px: the same, with the movement totals as an aside beside it all.
  return (
    <section className="sp-stock" aria-labelledby="stock-title">
      <div className="sp-stock-top">
        <header className="sp-stock-heading">
          <h1 id="stock-title" className="sp-page-title">
            Stock
          </h1>
          {wide && summaryLine}
          {wide && !roomy && movement}
        </header>
        <div className="sp-stock-tools">
          {search}
          {!wide && summaryLine}
          {!wide && movement}
          {chips}
        </div>
        {roomy && movement}
      </div>
      {body}
    </section>
  )
}
