import { useState } from 'react'

import { asList, deleteProduct, paths } from '../api.js'
import { ConfirmButton } from '../components/ConfirmButton.jsx'
import { Link } from '../components/Link.jsx'
import { EmptyState, ErrorState, Skeleton } from '../components/StatusViews.jsx'
import { PAGE_SIZE, categoryLabel } from '../config.js'
import { useApiGet } from '../hooks/useApiGet.js'
import { useDocumentTitle } from '../hooks/useDocumentTitle.js'
import { formatDays, formatNumber, formatPaise } from '../lib/format.js'
import { useInventoryEvents } from '../state/inventoryEvents.js'
import { useToast } from '../state/toast.js'

function ProductRow({ product, error, onDelete }) {
  const history = product.movements_count
  const hintId = `delete-hint-${product.id}`
  const errorId = `delete-error-${product.id}`
  const hint = history > 0 ? `Has ${formatNumber(history)} movements — kept for the audit trail` : null
  return (
    <tr>
      <td className="c-sku num">{product.sku}</td>
      <td className="c-product">
        <Link to={`/products/${product.id}`} className="c-name">
          {product.name}
        </Link>
      </td>
      <td data-label="Category">{categoryLabel(product.category)}</td>
      <td data-label="Unit">{product.unit}</td>
      <td className="num" data-label="Unit cost">
        {formatPaise(product.unit_cost_paise)}
      </td>
      <td className="num" data-label="Reorder point">
        {formatNumber(product.reorder_point)}
      </td>
      <td className="num" data-label="Lead time">
        {formatDays(product.lead_time_days)}
      </td>
      <td className="num" data-label="History">
        {formatNumber(history)}
      </td>
      <td className="c-action">
        <span className="row-actions">
          <Link to={`/products/${product.id}/edit`} className="btn btn-small">
            Edit<span className="visually-hidden"> {product.name}</span>
          </Link>
          <span title={hint ?? undefined}>
            <ConfirmButton
              label="Delete"
              confirmLabel="Confirm delete"
              ariaLabel={`Delete ${product.name}`}
              disabled={history > 0}
              describedBy={[hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined}
              onConfirm={() => onDelete(product)}
            />
          </span>
        </span>
        {hint && (
          <p id={hintId} className="delete-hint">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} className="field-error" role="alert">
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
      <div className="table-scroll" data-refreshing={products.loading || undefined}>
        <table className="ledger-table products-table" aria-busy={products.loading || undefined}>
          <caption className="visually-hidden">Product catalogue, in SKU order</caption>
          <thead>
            <tr>
              <th scope="col">SKU</th>
              <th scope="col">Name</th>
              <th scope="col">Category</th>
              <th scope="col">Unit</th>
              <th scope="col" className="num-col">
                Unit cost
              </th>
              <th scope="col" className="num-col">
                Reorder pt
              </th>
              <th scope="col" className="num-col">
                Lead time
              </th>
              <th scope="col" className="num-col">
                History
              </th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
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
      <header className="page-head page-head-actions">
        <h1 id="products-title" className="page-title">
          Products
        </h1>
        <Link to="/products/new" className="btn btn-hivis">
          New product
        </Link>
      </header>
      {body}
    </section>
  )
}
