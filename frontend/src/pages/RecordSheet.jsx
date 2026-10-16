import { useRef, useState } from 'react'

import { paths, recordMovement, undoMovement } from '../api.js'
import { BottomSheet } from '../components/BottomSheet.jsx'
import { Icon } from '../components/Icon.jsx'
import { ProductPicker } from '../components/ProductPicker.jsx'
import { QuantityStepper } from '../components/QuantityStepper.jsx'
import { SegmentedControl } from '../components/SegmentedControl.jsx'
import { KINDS, LIMITS, categoryLabel } from '../config.js'
import { useApiGet } from '../hooks/useApiGet.js'
import { MINUS, formatDelta, formatNumber, formatQty, parseQuantity } from '../lib/format.js'
import { closeRecordSheet, setQuery, useLocation } from '../router.js'
import { useInventoryEvents } from '../state/inventoryEvents.js'
import { useToast } from '../state/toast.js'

// The values stay IN / OUT / ADJUST (URL and API); the labels are sentence case.
const KIND_LABELS = { IN: 'In', OUT: 'Out', ADJUST: 'Adjust' }
const KIND_OPTIONS = Object.entries(KINDS).map(([value, help]) => ({ value, label: KIND_LABELS[value], help }))
const SIGN_OPTIONS = [
  { value: 'remove', label: 'Remove', help: 'Fewer counted than the ledger shows' },
  { value: 'add', label: 'Add', help: 'More counted than the ledger shows' },
]
const OUTAGE = new Set([0, 502, 503, 504])

function signedDelta(kind, sign, quantity) {
  if (kind === 'IN') return quantity
  if (kind === 'OUT') return -quantity
  return sign === 'add' ? quantity : -quantity
}

function stockFigure(n) {
  return n < 0 ? `${MINUS}${formatNumber(-n)}` : formatNumber(n)
}

// The resulting stock, live as the quantity changes: "131 → 111 pcs left". Before a quantity it
// shows what is on hand. A shortfall turns the result red and adds an explicit danger note, until
// the server has refused it: then its own 422 text, under the quantity, says it instead.
function ResultLine({ product, after, refused }) {
  return (
    <div className="sp-record-result" aria-live="polite">
      {after === null ? (
        <p className="sp-record-after">
          <span className="num">{formatNumber(product.on_hand)}</span>
          <span className="sp-unit">{product.unit} on hand</span>
        </p>
      ) : (
        <p className="sp-record-after" data-short={after < 0 || undefined}>
          <span className="num sp-record-before">{formatNumber(product.on_hand)}</span>
          <span className="sp-record-arrow">
            <Icon name="arrow" size={18} />
          </span>
          <span className="visually-hidden"> to </span>
          <span className="num sp-record-left">{stockFigure(after)}</span>
          <span className="sp-unit">{product.unit} left</span>
        </p>
      )}
      {after !== null && after < 0 && !refused && (
        <p className="sp-note sp-note-danger sp-record-short">
          Only {formatQty(product.on_hand, product.unit)} on hand: the server will refuse this.
        </p>
      )}
    </div>
  )
}

export function RecordSheet() {
  const { query } = useLocation()
  const { version, notifyChanged } = useInventoryEvents()
  const toast = useToast()

  // The product and kind live in the URL (prefilled by a row's Record button); the rest is local.
  const productId = Number(query.get('product')) || null
  const kind = KINDS[query.get('kind')] ? query.get('kind') : 'OUT'
  const [sign, setSign] = useState('remove')
  const [quantityText, setQuantityText] = useState('')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState(null)

  const pickerRef = useRef(null)
  const quantityRef = useRef(null)

  const lookup = useApiGet(productId ? paths.product(productId) : null, { version })
  // Never show a previous product's numbers while the next one loads.
  const product = lookup.data?.id === productId ? lookup.data : null
  const productGone = lookup.error?.status === 404

  const quantity = parseQuantity(quantityText)
  const validQuantity = quantity !== null && quantity >= 1 && quantity <= LIMITS.quantity
  const delta = validQuantity ? signedDelta(kind, sign, quantity) : null
  const after = product && delta !== null ? product.on_hand + delta : null

  function choose(patch) {
    setFailure(null)
    setQuery(patch)
  }

  async function undo(created) {
    try {
      await undoMovement(created.id)
      toast.show({ message: 'Undone', tone: 'ok' })
      notifyChanged()
    } catch (error) {
      toast.show({ message: error.message, tone: 'error' })
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!product || !validQuantity || pending) return
    setPending(true)
    setFailure(null)
    try {
      const quantityToSend = kind === 'ADJUST' ? delta : quantity
      const created = await recordMovement({ productId: product.id, kind, quantity: quantityToSend, note })
      closeRecordSheet()
      // A receipt line: "Reynolds pen (blue) −20 → 111 left".
      toast.show({
        message: `${created.product_name ?? product.name} ${formatDelta(created.delta)} → ${created.on_hand} left`,
        tone: 'ok',
        action: { label: 'Undo', onClick: () => undo(created) },
      })
      notifyChanged()
    } catch (error) {
      setPending(false)
      if (error.status === 422) {
        setFailure({ field: 'quantity', message: error.message })
        quantityRef.current?.focus()
      } else if (error.status === 404) {
        setFailure({ field: 'product', message: 'Product no longer exists' })
        setQuery({ product: null })
      } else if (OUTAGE.has(error.status)) {
        setFailure({ field: 'form', message: `${error.message}. Nothing was recorded; check the ledger before retrying.` })
      } else {
        setFailure({ field: 'form', message: error.message })
      }
    }
  }

  let submitLabel = 'Record'
  if (pending) submitLabel = 'Recording…'
  else if (delta !== null) submitLabel = `Record ${formatDelta(delta)}${product ? ` ${product.unit}` : ''}`

  return (
    <BottomSheet title="Record movement" onClose={closeRecordSheet} initialFocusRef={productId ? quantityRef : pickerRef}>
      <form className="sp-sheet-form sp-record" onSubmit={handleSubmit} noValidate>
        <div className="sp-sheet-body">
          {productId && !productGone ? (
            <div className="sp-record-product">
              <p className="sp-label sp-record-product-label">Product</p>
              {product ? (
                <p className="sp-record-picked">
                  <span className="sp-record-name">{product.name}</span>
                  <span className="sp-record-meta">
                    <span className="sp-sku">{product.sku}</span>
                    <span aria-hidden="true"> · </span>
                    <span className="visually-hidden">, </span>
                    {categoryLabel(product.category)}
                  </span>
                </p>
              ) : (
                <p className="sp-record-picked sp-record-loading">
                  {lookup.error ? lookup.error.message : 'Loading product…'}
                </p>
              )}
              <button
                type="button"
                className="sp-btn sp-btn-quiet sp-record-change"
                onClick={() => choose({ product: null })}
              >
                Change<span className="visually-hidden"> product</span>
              </button>
            </div>
          ) : (
            <>
              {(productGone || failure?.field === 'product') && (
                <p className="sp-note sp-note-danger" role="alert">
                  Product no longer exists
                </p>
              )}
              <ProductPicker
                inputRef={pickerRef}
                version={version}
                onSelect={(picked) => {
                  choose({ product: picked.id })
                  quantityRef.current?.focus()
                }}
              />
            </>
          )}

          <SegmentedControl
            name="record-kind"
            legend="Movement type"
            showLegend
            options={KIND_OPTIONS}
            value={kind}
            onChange={(value) => choose({ kind: value })}
          />

          {kind === 'ADJUST' && (
            <SegmentedControl
              name="record-sign"
              legend="Correction"
              options={SIGN_OPTIONS}
              value={sign}
              onChange={setSign}
            />
          )}

          <QuantityStepper
            id="record-quantity"
            label="Quantity"
            inputRef={quantityRef}
            value={quantityText}
            error={failure?.field === 'quantity' ? failure.message : null}
            onChange={(text) => {
              setQuantityText(text)
              if (failure?.field === 'quantity') setFailure(null)
            }}
          >
            {product && <ResultLine product={product} after={after} refused={failure?.field === 'quantity'} />}
          </QuantityStepper>

          <div className="sp-field sp-record-note">
            <label className="sp-label" htmlFor="record-note">
              Note <span className="sp-optional">(optional)</span>
            </label>
            <textarea
              id="record-note"
              rows={2}
              maxLength={LIMITS.noteLength}
              value={note}
              aria-describedby="record-note-count"
              onChange={(event) => setNote(event.target.value)}
            />
            <p id="record-note-count" className="sp-hint num sp-record-count">
              {note.length}/{LIMITS.noteLength}
            </p>
          </div>
        </div>
        <div className="sp-sheet-foot">
          {failure?.field === 'form' && (
            <p className="sp-note sp-note-danger sp-record-failure" role="alert">
              {failure.message}
            </p>
          )}
          <button
            type="submit"
            className="sp-btn sp-btn-action sp-btn-block sp-record-submit"
            disabled={!product || !validQuantity || pending}
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </BottomSheet>
  )
}
