import { paths } from '../api.js'
import { CoverBar } from '../components/CoverBar.jsx'
import { LedgerTable } from '../components/LedgerTable.jsx'
import { Link } from '../components/Link.jsx'
import { EmptyState, ErrorState, Skeleton } from '../components/StatusViews.jsx'
import { categoryLabel } from '../config.js'
import { useApiGet } from '../hooks/useApiGet.js'
import { useDocumentTitle } from '../hooks/useDocumentTitle.js'
import { needsReorder } from '../lib/cover.js'
import { formatDays, formatNumber, formatPaise, formatQty } from '../lib/format.js'
import { openRecordSheet } from '../router.js'
import { useInventoryEvents } from '../state/inventoryEvents.js'

function SpecRow({ label, children }) {
  return (
    <div className="spec-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function ProductDetail({ product }) {
  const demand = product.demand_30d
  return (
    <article className="detail" aria-labelledby="detail-title">
      <header className="page-head detail-head">
        <p className="num detail-sku">{product.sku}</p>
        <h1 id="detail-title" className="page-title">
          {product.name}
        </h1>
        <p className="detail-category">{categoryLabel(product.category)}</p>
        <div className="detail-actions">
          <button
            type="button"
            className="btn btn-hivis"
            aria-haspopup="dialog"
            onClick={() => openRecordSheet({ product: product.id })}
          >
            Record movement
          </button>
          <Link to={`/products/${product.id}/edit`} className="btn">
            Edit
          </Link>
        </div>
      </header>

      <div className="detail-grid">
        <section aria-labelledby="spec-title">
          <h2 id="spec-title" className="section-title">
            Stock
          </h2>
          <dl className="spec-sheet">
            <SpecRow label="On hand">
              <span className="num">{formatQty(product.on_hand, product.unit)}</span>
            </SpecRow>
            <SpecRow label="Value">
              <span className="num">{formatPaise(product.value_paise)}</span>
            </SpecRow>
            <SpecRow label="Unit cost">
              <span className="num">{formatPaise(product.unit_cost_paise)}</span>
            </SpecRow>
            <SpecRow label="Reorder point">
              <span className="num">{formatNumber(product.reorder_point)}</span>
              {needsReorder(product.on_hand, product.reorder_point) && <span className="tag-reorder">Reorder</span>}
            </SpecRow>
            <SpecRow label="Lead time">
              <span className="num">{formatDays(product.lead_time_days)}</span>
            </SpecRow>
            <SpecRow label="Days of cover">
              <CoverBar daysOfCover={product.days_of_cover} leadTimeDays={product.lead_time_days} onHand={product.on_hand} index={0} />
            </SpecRow>
          </dl>

          <h2 className="section-title">Demand, last 30 days</h2>
          <p className="demand-line num">
            total {formatQty(demand.total_out, product.unit)} · avg {demand.avg_daily_out.toFixed(1)}/day
          </p>
        </section>

        <section aria-labelledby="recent-title">
          <h2 id="recent-title" className="section-title">
            Last 20 movements
          </h2>
          {product.recent_movements.length === 0 ? (
            <p className="field-hint">No movements yet.</p>
          ) : (
            <div className="table-scroll">
              <LedgerTable movements={product.recent_movements} caption={`Last movements of ${product.name}`} />
            </div>
          )}
          <p>
            <Link to={`/ledger?product_id=${product.id}`}>Full ledger →</Link>
          </p>
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
          <Link to="/" className="btn">
            Back to stock
          </Link>
        }
      />
    )
  }
  return <ErrorState error={error} onRetry={reload} />
}
