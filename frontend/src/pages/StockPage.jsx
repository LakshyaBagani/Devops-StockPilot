import { asList, paths } from '../api.js'
import { CategoryChips } from '../components/CategoryChips.jsx'
import { CoverBar } from '../components/CoverBar.jsx'
import { Icon } from '../components/Icon.jsx'
import { Link } from '../components/Link.jsx'
import { EmptyState, ErrorState, Skeleton } from '../components/StatusViews.jsx'
import { SummaryLine } from '../components/SummaryLine.jsx'
import { CATEGORIES, LIMITS, PAGE_SIZE, categoryLabel } from '../config.js'
import { useApiGet } from '../hooks/useApiGet.js'
import { useDebouncedValue } from '../hooks/useDebouncedValue.js'
import { useDocumentTitle } from '../hooks/useDocumentTitle.js'
import { needsReorder } from '../lib/cover.js'
import { formatPaise, formatQty } from '../lib/format.js'
import { openRecordSheet, setQuery, useLocation } from '../router.js'
import { useInventoryEvents } from '../state/inventoryEvents.js'

function StockRow({ product, index }) {
  return (
    <tr>
      <td className="c-sku num">{product.sku}</td>
      <td className="c-product">
        <Link to={`/products/${product.id}`} className="c-name">
          {product.name}
        </Link>
        {needsReorder(product.on_hand, product.reorder_point) && <span className="tag-reorder">Reorder</span>}
        <small className="c-category">{categoryLabel(product.category)}</small>
      </td>
      <td className="c-onhand num" data-label="On hand">
        {formatQty(product.on_hand, product.unit)}
      </td>
      <td className="c-value num" data-label="Value">
        {formatPaise(product.value_paise)}
      </td>
      <td className="c-cover" data-label="Days of cover">
        <CoverBar
          daysOfCover={product.days_of_cover}
          leadTimeDays={product.lead_time_days}
          onHand={product.on_hand}
          index={index}
        />
      </td>
      <td className="c-action">
        <button
          type="button"
          className="btn btn-small"
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
          <button type="button" className="btn" onClick={clearFilters}>
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
          <Link to="/products/new" className="btn btn-hivis">
            New product
          </Link>
        }
      />
    )
  } else {
    body = (
      <div className="table-scroll" data-refreshing={products.loading || undefined}>
        <table className="ledger-table stock-table" aria-busy={products.loading || undefined}>
          <caption className="visually-hidden">Stock on hand, in SKU order</caption>
          <thead>
            <tr>
              <th scope="col">SKU</th>
              <th scope="col">Product</th>
              <th scope="col" className="num-col">
                On hand
              </th>
              <th scope="col" className="num-col">
                Value
              </th>
              <th scope="col">Days of cover</th>
              <th scope="col">
                <span className="visually-hidden">Record</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((product, index) => (
              <StockRow key={product.id} product={product} index={index} />
            ))}
          </tbody>
        </table>
        {rows.length >= PAGE_SIZE.products && (
          <p className="field-hint">Showing the first {PAGE_SIZE.products} products. Search to narrow the list.</p>
        )}
      </div>
    )
  }

  return (
    <section aria-labelledby="stock-title">
      <header className="page-head">
        <h1 id="stock-title" className="page-title">
          Stock
        </h1>
      </header>
      <SummaryLine
        summary={summary.data}
        belowOnly={belowOnly}
        onToggleBelow={() => setQuery({ below: belowOnly ? null : '1' })}
      />
      <div className="stock-tools">
        <div className="search-field">
          <label className="field-label" htmlFor="stock-search">
            Search SKU or name
          </label>
          <span className="search-box">
            <Icon name="search" size={20} />
            <input
              id="stock-search"
              type="search"
              autoComplete="off"
              spellCheck="false"
              maxLength={LIMITS.search}
              value={q}
              onChange={(event) => setQuery({ q: event.target.value })}
            />
          </span>
        </div>
        <CategoryChips value={category} onChange={(value) => setQuery({ category: value })} />
      </div>
      {body}
    </section>
  )
}
