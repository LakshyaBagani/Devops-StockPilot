import { useState } from 'react'

import { createProduct, paths, updateProduct } from '../api.js'
import { Link } from '../components/Link.jsx'
import { EmptyState, ErrorState, Skeleton } from '../components/StatusViews.jsx'
import { CATEGORIES, LIMITS, UNITS } from '../config.js'
import { useApiGet } from '../hooks/useApiGet.js'
import { useDocumentTitle } from '../hooks/useDocumentTitle.js'
import {
  EMPTY_PRODUCT,
  FIELD_ORDER,
  FORM_FIELDS,
  changedFields,
  productToForm,
  validateProduct,
} from '../lib/productForm.js'
import { navigate } from '../router.js'
import { useInventoryEvents } from '../state/inventoryEvents.js'
import { useToast } from '../state/toast.js'

const HINTS = {
  sku: '3–20 capital letters, digits or hyphens, e.g. PEN-REY-BLU',
  unitCost: 'In rupees, up to 2 decimals',
  reorderPoint: 'Reorder when stock is at or below this',
  leadTime: `Supplier delivery time, ${LIMITS.leadTime.min} to ${LIMITS.leadTime.max} days`,
}

const fieldId = (field) => `product-${field}`

function a11yProps(field, error) {
  const described = [HINTS[field] && `${fieldId(field)}-hint`, error && `${fieldId(field)}-error`].filter(Boolean)
  return {
    id: fieldId(field),
    'aria-invalid': error ? true : undefined,
    'aria-describedby': described.join(' ') || undefined,
  }
}

function focusFirstInvalid(errors) {
  const first = FIELD_ORDER.find((field) => errors[field])
  if (first) document.getElementById(fieldId(first))?.focus()
}

function Field({ field, label, error, children }) {
  return (
    <div className="sp-field">
      <label className="sp-label" htmlFor={fieldId(field)}>
        {label}
      </label>
      {children}
      {HINTS[field] && (
        <p id={`${fieldId(field)}-hint`} className="sp-hint">
          {HINTS[field]}
        </p>
      )}
      {error && (
        <p id={`${fieldId(field)}-error`} className="sp-error">
          {error}
        </p>
      )}
    </div>
  )
}

// A figure input with its rupee sign or unit printed inside it. The affixes are decoration: the
// label and hint already say rupees, the unit and days.
function Affixed({ prefix, suffix, children }) {
  return (
    <span className="sp-affixed">
      {prefix && (
        <span className="sp-affix sp-affix-pre" aria-hidden="true">
          {prefix}
        </span>
      )}
      {children}
      {suffix && (
        <span className="sp-affix sp-affix-post" aria-hidden="true">
          {suffix}
        </span>
      )}
    </span>
  )
}

function ProductForm({ product }) {
  const isNew = !product
  const { notifyChanged } = useInventoryEvents()
  const toast = useToast()
  const [initial] = useState(() => (isNew ? EMPTY_PRODUCT : productToForm(product)))
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [pending, setPending] = useState(false)
  const dirty = FIELD_ORDER.some((field) => values[field] !== initial[field])

  function update(field, value) {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  function showErrors(next) {
    setErrors(next)
    focusFirstInvalid(next)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setFormError(null)
    const { errors: found, payload } = validateProduct(values, { isNew })
    if (Object.keys(found).length > 0) {
      showErrors(found)
      return
    }

    setPending(true)
    try {
      // POST sends the full body; PUT only the changed keys (never null).
      const saved = isNew ? await createProduct(payload) : await updateProduct(product.id, changedFields(product, payload))
      toast.show({ message: `Saved ${saved.sku}`, tone: 'ok' })
      notifyChanged()
      navigate(`/products/${saved.id}`)
    } catch (error) {
      setPending(false)
      const fromServer = Object.fromEntries(
        Object.entries(error.fieldErrors ?? {}).map(([apiField, message]) => [FORM_FIELDS[apiField] ?? apiField, message]),
      )
      if (error.status === 409) showErrors({ sku: `SKU ${payload.sku} already exists` })
      else if (FIELD_ORDER.some((field) => fromServer[field])) showErrors(fromServer)
      else setFormError(error.message)
    }
  }

  return (
    <form className="sp-product-form sp-reveal" style={{ '--i': 2 }} onSubmit={handleSubmit} noValidate>
      <Field field="name" label="Name" error={errors.name}>
        <input
          {...a11yProps('name', errors.name)}
          type="text"
          autoComplete="off"
          maxLength={LIMITS.nameLength}
          value={values.name}
          onChange={(event) => update('name', event.target.value)}
        />
      </Field>

      <div className="sp-field-pair">
        {isNew ? (
          <Field field="sku" label="SKU" error={errors.sku}>
            <input
              {...a11yProps('sku', errors.sku)}
              className="num"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck="false"
              maxLength={20}
              value={values.sku}
              onChange={(event) => update('sku', event.target.value.toUpperCase())}
            />
          </Field>
        ) : (
          <div className="sp-field">
            <span className="sp-label">SKU</span>
            <p className="num sp-sku-fixed">{product.sku}</p>
            <p className="sp-hint">A SKU never changes once created.</p>
          </div>
        )}
        <Field field="category" label="Category" error={errors.category}>
          <select
            {...a11yProps('category', errors.category)}
            value={values.category}
            onChange={(event) => update('category', event.target.value)}
          >
            <option value="" disabled>
              Choose…
            </option>
            {CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="sp-field-pair">
        <Field field="unit" label="Unit" error={errors.unit}>
          <select {...a11yProps('unit', errors.unit)} value={values.unit} onChange={(event) => update('unit', event.target.value)}>
            {UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </Field>
        <Field field="unitCost" label="Unit cost" error={errors.unitCost}>
          <Affixed prefix="₹" suffix={`/${values.unit}`}>
            <input
              {...a11yProps('unitCost', errors.unitCost)}
              className="num sp-has-pre sp-has-post"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={values.unitCost}
              onChange={(event) => update('unitCost', event.target.value)}
            />
          </Affixed>
        </Field>
      </div>

      <div className="sp-field-pair">
        <Field field="reorderPoint" label="Reorder point" error={errors.reorderPoint}>
          <Affixed suffix={values.unit}>
            <input
              {...a11yProps('reorderPoint', errors.reorderPoint)}
              className="num sp-has-post"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={values.reorderPoint}
              onChange={(event) => update('reorderPoint', event.target.value)}
            />
          </Affixed>
        </Field>
        <Field field="leadTime" label="Lead time" error={errors.leadTime}>
          <Affixed suffix="days">
            <input
              {...a11yProps('leadTime', errors.leadTime)}
              className="num sp-has-post"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={values.leadTime}
              onChange={(event) => update('leadTime', event.target.value)}
            />
          </Affixed>
        </Field>
      </div>

      <div className="sp-form-foot">
        {formError && (
          <p className="sp-error" role="alert">
            {formError}
          </p>
        )}
        <button type="submit" className="sp-btn sp-btn-action" disabled={pending || (!isNew && !dirty)}>
          {pending ? 'Saving…' : isNew ? 'Create product' : 'Save changes'}
        </button>
        {/* Replaces the form's history entry, so Back never returns to the abandoned form. */}
        <Link to={isNew ? '/products' : `/products/${product.id}`} replace className="sp-btn sp-btn-quiet">
          Cancel
        </Link>
      </div>
    </form>
  )
}

export function ProductFormPage({ id }) {
  const isNew = id === undefined
  useDocumentTitle(isNew ? 'New product' : 'Edit product')
  const lookup = useApiGet(isNew ? null : paths.product(id))

  let body
  if (isNew) body = <ProductForm />
  else if (lookup.data) body = <ProductForm product={lookup.data} />
  else if (lookup.error?.status === 404) {
    body = (
      <EmptyState
        title="No such product"
        body="It may have been deleted."
        action={
          <Link to="/products" className="sp-btn">
            Back to products
          </Link>
        }
      />
    )
  } else if (lookup.error) body = <ErrorState error={lookup.error} onRetry={lookup.reload} />
  else body = <Skeleton rows={5} />

  return (
    <section aria-labelledby="product-form-title">
      <header className="sp-page-head">
        <h1 id="product-form-title" className="sp-page-title">
          {isNew ? 'New product' : 'Edit product'}
        </h1>
        {isNew && (
          <p className="sp-lede sp-reveal" style={{ '--i': 1 }}>
            Opening stock is recorded afterwards, as a delivery.
          </p>
        )}
      </header>
      {body}
    </section>
  )
}
