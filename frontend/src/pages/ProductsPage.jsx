import { useState } from 'react'

import { asList, deleteProduct, paths } from '../api.js'
import { ConfirmButton } from '../components/ConfirmButton.jsx'
import { Link } from '../components/Link.jsx'
import { EmptyState, ErrorState, Skeleton } from '../components/StatusViews.jsx'
import { PAGE_SIZE, categoryLabel } from '../config.js'
import { useApiGet } from '../hooks/useApiGet.js'
import { useDocumentTitle } from '../hooks/useDocumentTitle.js'
import { formatNumber, formatPaise } from '../lib/format.js'
import { deleteBlockedReason } from '../lib/productForm.js'
import { useInventoryEvents } from '../state/inventoryEvents.js'
import { useToast } from '../state/toast.js'

// A product with movements can't be deleted. Its Delete stays focusable (aria-disabled) and is
// described by the reason, which shows on press instead of under every row.
function BlockedDelete({ product, reason, hintId }) {
  const [shown, setShown] = useState(false)
  return (
    <>
      <button
        type="button"
        className="sp-btn sp-btn-quiet sp-products-blocked"
        aria-disabled="true"
        aria-describedby={hintId}
        title={reason}
        onClick={() => setShown(true)}
      >
        Delete<span className="visually-hidden"> {product.name}</span>
      </button>
      <span id={hintId} className={shown ? 'sp-products-reason' : 'visually-hidden'}>
        {reason}
      </span>
    </>
  )
}

function ProductRow({ product, error, onDelete }) {
  const history = product.movements_count
  const reason = deleteBlockedReason(history)
  const errorId = `delete-error-${product.id}`
  return (
    <tr>
      <td className="sp-products-product">
        <Link to={`/products/${product.id}`} className="sp-products-name">
          {product.name}
        </Link>
        <span className="sp-products-meta">
          <span className="sp-sku">{product.sku}</span>
          <span aria-hidden="true"> · </span>
          <span className="visually-hidden">, </span>
          {categoryLabel(product.category)}
        </span>
      </td>
      <td className="sp-products-cost">
        <span className="num">{formatPaise(product.unit_cost_paise)}</span>
        <span className="sp-unit sp-products-per">
          <span aria-hidden="true">/</span>
          <span className="visually-hidden">per </span>
          {product.unit}
        </span>
      </td>
      <td className="sp-products-reorder" data-label="Reorder at">
        <span className="num">{formatNumber(product.reorder_point)}</span>
        <span className="sp-unit sp-products-slot">{product.unit}</span>
      </td>
      <td className="sp-products-lead" data-label="Lead time">
        <span className="num">{formatNumber(product.lead_time_days)}</span>
        <span className="sp-unit sp-products-slot">d</span>
      </td>
      <td className="sp-products-history">
        <span className="num">{formatNumber(history)}</span>
        <span className="sp-unit sp-products-history-word">{history === 1 ? 'movement' : 'movements'}</span>
      </td>
      <td className="sp-products-actions">
        <span className="sp-actions">
          <Link to={`/products/${product.id}/edit`} className="sp-btn sp-btn-quiet sp-btn-flush">
            Edit<span className="visually-hidden"> {product.name}</span>
          </Link>
          {reason ? (
            <BlockedDelete product={product} reason={reason} hintId={`delete-hint-${product.id}`} />
          ) : (
            <ConfirmButton
              label="Delete"
              confirmLabel="Confirm delete"
              ariaLabel={`Delete ${product.name}`}
              describedBy={error ? errorId : undefined}
              onConfirm={() => onDelete(product)}
            />
          )}
        </span>
        {error && (
          <p id={errorId} className="sp-error" role="alert">
            {error}
          </p>
        )}
      </td>
    </tr>
  )
}

export function ProductsPage() {
  useDocumentTitle('Products')
  const { version, notifyChanged } = useInventoryEvents()
  const toast = useToast()
  const products = useApiGet(paths.products({ limit: PAGE_SIZE.products }), { version })
  const [rowErrors, setRowErrors] = useState({})
  const rows = asList(products.data)

  async function remove(product) {
    try {
      await deleteProduct(product.id)
      toast.show({ message: `Deleted ${product.sku}`, tone: 'ok' })
      notifyChanged()
    } catch (error) {
      setRowErrors((errors) => ({ ...errors, [product.id]: error.message }))
    }
  }

  let body
  if (!products.data && products.loading) body = <Skeleton rows={8} />
  else if (!products.data && products.error) body = <ErrorState error={products.error} onRetry={products.reload} />
  else if (rows.length === 0) {
    body = <EmptyState title="No products yet" body="Create the catalogue here; stock is recorded from the Stock page." />
  } else {
    body = (
      <div className="sp-table-scroll" data-refreshing={products.loading || undefined}>
        <table className="sp-table sp-products" aria-busy={products.loading || undefined}>
          <caption className="visually-hidden">Product catalogue, in SKU order</caption>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col" className="sp-products-cost sp-num-col">
                Unit cost
              </th>
              <th scope="col" className="sp-products-reorder sp-num-col">
                Reorder at
              </th>
              <th scope="col" className="sp-products-lead sp-num-col">
                Lead time
              </th>
              <th scope="col" className="sp-products-history sp-num-col">
                Movements
              </th>
              <th scope="col" className="sp-products-actions">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="sp-reveal-rows">
            {rows.map((product) => (
              <ProductRow key={product.id} product={product} error={rowErrors[product.id]} onDelete={remove} />
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <section aria-labelledby="products-title">
      <header className="sp-page-head sp-page-head-row">
        <h1 id="products-title" className="sp-page-title">
          Products
        </h1>
        <Link to="/products/new" className="sp-btn sp-btn-action sp-reveal" style={{ '--i': 1 }}>
          New product
        </Link>
      </header>
      {body}
    </section>
  )
}
