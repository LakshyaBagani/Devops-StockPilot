import { paths } from '../api.js'
import { CoverBar } from '../components/CoverBar.jsx'
import { LedgerTable } from '../components/LedgerTable.jsx'
import { Link } from '../components/Link.jsx'
import { EmptyState, ErrorState, Skeleton } from '../components/StatusViews.jsx'
import { categoryLabel } from '../config.js'
import { useApiGet } from '../hooks/useApiGet.js'
import { useDocumentTitle } from '../hooks/useDocumentTitle.js'
import { needsReorder } from '../lib/cover.js'
import { formatNumber, formatPaise } from '../lib/format.js'
import { openRecordSheet } from '../router.js'
import { useInventoryEvents } from '../state/inventoryEvents.js'

// A figure and its unit: "40 pcs", "7 days", or with `per` a price: "₹46.00 /pcs", read "per pcs".
function Figure({ value, unit, per = false }) {
  return (
    <>
      <span className="num">{value}</span>
      {unit && (
        <span className="sp-unit">
          {per && (
            <>
              <span aria-hidden="true">/</span>
              <span className="visually-hidden">per </span>
            </>
          )}
          {unit}
        </span>
      )}
    </>
  )
}

function Spec({ label, children }) {
  return (
    <div className="sp-spec">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

// On hand at full size, with the state in plain words beside it: "Out of stock" or "Reorder".
function OnHand({ product }) {
  let state = null
  if (product.on_hand <= 0) state = { tone: 'danger', word: 'Out of stock' }
  else if (needsReorder(product.on_hand, product.reorder_point)) state = { tone: 'warning', word: 'Reorder' }
  return (
    <div className={state ? `sp-detail-onhand sp-detail-onhand-${state.tone}` : 'sp-detail-onhand'}>
      <p className="sp-detail-label">On hand</p>
      <p className="sp-detail-figure">
        <span className="sp-figure-lg">{formatNumber(product.on_hand)}</span>
        <span className="sp-unit">{product.unit}</span>
        {state && <span className={`sp-detail-state sp-tone-${state.tone}`}>{state.word}</span>}
      </p>
    </div>
  )
}

function ProductDetail({ product }) {
  const demand = product.demand_30d
  const leadDays = product.lead_time_days
  return (
    <article className="sp-detail" aria-labelledby="detail-title">
      <header className="sp-page-head sp-detail-head">
        <h1 id="detail-title" className="sp-page-title">
          {product.name}
        </h1>
        <p className="sp-detail-meta sp-reveal" style={{ '--i': 1 }}>
          <span className="sp-sku">{product.sku}</span>
          <span aria-hidden="true"> · </span>
          <span className="visually-hidden">, </span>
          {categoryLabel(product.category)}
        </p>
      </header>

      <div className="sp-detail-grid">
        <section className="sp-detail-facts sp-reveal" style={{ '--i': 2 }} aria-labelledby="facts-title">
          <h2 id="facts-title" className="visually-hidden">
            Stock
          </h2>
          <OnHand product={product} />
          <div className="sp-detail-cover">
            <CoverBar daysOfCover={product.days_of_cover} leadTimeDays={leadDays} onHand={product.on_hand} labelled />
          </div>
          <div className="sp-actions sp-detail-actions">
            {/* The header's Record movement starts blank; this one has the product picked. */}
            <button
              type="button"
              className="sp-btn sp-btn-action"
              aria-haspopup="dialog"
              onClick={() => openRecordSheet({ product: product.id })}
            >
              Record movement<span className="visually-hidden"> of {product.name}</span>
            </button>
            <Link to={`/products/${product.id}/edit`} className="sp-btn">
              Edit<span className="visually-hidden"> {product.name}</span>
            </Link>
          </div>
          <dl className="sp-specs">
            <Spec label="Value">
              <Figure value={formatPaise(product.value_paise)} />
            </Spec>
            <Spec label="Unit cost">
              <Figure value={formatPaise(product.unit_cost_paise)} unit={product.unit} per />
            </Spec>
            <Spec label="Out, last 30 days">
              <Figure value={formatNumber(demand.total_out)} unit={product.unit} />
              <span className="sp-spec-aside">
                <Figure value={demand.avg_daily_out.toFixed(1)} unit="a day" />
              </span>
            </Spec>
            <Spec label="Reorder point">
              <Figure value={formatNumber(product.reorder_point)} unit={product.unit} />
            </Spec>
            <Spec label="Lead time">
              <Figure value={formatNumber(leadDays)} unit={leadDays === 1 ? 'day' : 'days'} />
            </Spec>
          </dl>
        </section>

        <section className="sp-detail-history" aria-labelledby="recent-title">
          <div className="sp-section-head">
            <h2 id="recent-title" className="sp-section-title">
              Recent movements
            </h2>
            <Link to={`/ledger?product_id=${product.id}`}>Full ledger →</Link>
          </div>
          {product.recent_movements.length === 0 ? (
            <p className="sp-hint">No movements yet.</p>
          ) : (
            <div className="sp-table-scroll">
              <LedgerTable
                movements={product.recent_movements}
                showProduct={false}
                grouped={false}
                caption={`Recent movements of ${product.name}, newest first`}
              />
            </div>
          )}
        </section>
      </div>
    </article>
  )
}

export function ProductDetailPage({ id }) {
  const { version } = useInventoryEvents()
  const { data, error, loading, reload } = useApiGet(paths.product(id), { version })
  useDocumentTitle(data?.sku ?? 'Product')

  if (data) return <ProductDetail product={data} />
  if (loading) return <Skeleton rows={6} />
  if (error?.status === 404) {
    return (
      <EmptyState
        title="No such product"
        body="It may have been deleted, or the link is wrong."
        action={
          <Link to="/" className="sp-btn">
            Back to stock
          </Link>
        }
      />
    )
  }
  return <ErrorState error={error} onRetry={reload} />
}
