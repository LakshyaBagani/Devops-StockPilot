import { useRef, useState } from 'react'

import { paths, recordMovement, undoMovement } from '../api.js'
import { BottomSheet } from '../components/BottomSheet.jsx'
import { ProductPicker } from '../components/ProductPicker.jsx'
import { QuantityStepper } from '../components/QuantityStepper.jsx'
import { SegmentedControl } from '../components/SegmentedControl.jsx'
import { KINDS, LIMITS } from '../config.js'
import { useApiGet } from '../hooks/useApiGet.js'
import { formatDelta, formatQty, parseQuantity } from '../lib/format.js'
import { closeRecordSheet, setQuery, useLocation } from '../router.js'
import { useInventoryEvents } from '../state/inventoryEvents.js'
import { useToast } from '../state/toast.js'

const KIND_OPTIONS = Object.entries(KINDS).map(([value, help]) => ({ value, label: value, help }))
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

  const submitLabel = delta === null ? `Record ${kind}` : `Record ${kind} ${formatDelta(delta)}`

  return (
    <BottomSheet title="Record movement" onClose={closeRecordSheet} initialFocusRef={productId ? quantityRef : pickerRef}>
      <form className="sheet-form" onSubmit={handleSubmit} noValidate>
        <div className="sheet-body">
          {productId && !productGone ? (
            <div className="picked">
              <span className="field-label">Product</span>
              {product ? (
                <p className="picked-line">
                  <span className="num">{product.sku}</span> <strong>{product.name}</strong>{' '}
                  <span className="num">· {formatQty(product.on_hand, product.unit)} on hand</span>
                </p>
              ) : (
                <p className="picked-line">{lookup.error ? lookup.error.message : 'Loading product…'}</p>
              )}
              <button type="button" className="btn btn-small btn-quiet" onClick={() => choose({ product: null })}>
                Change
              </button>
            </div>
          ) : (
            <>
              {(productGone || failure?.field === 'product') && (
                <p className="field-error" role="alert">
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
          />

          <div className="field">
            <label className="field-label" htmlFor="record-note">
              Note <span className="field-optional">(optional)</span>
            </label>
            <textarea
              id="record-note"
              rows={2}
              maxLength={LIMITS.noteLength}
              value={note}
              aria-describedby="record-note-count"
              onChange={(event) => setNote(event.target.value)}
            />
            <p id="record-note-count" className="field-hint num">
              {note.length}/{LIMITS.noteLength}
            </p>
          </div>

          {product && after !== null && (
            <p className="preview-line num" aria-live="polite">
              On hand {formatQty(product.on_hand)} → {formatQty(after, product.unit)}
            </p>
          )}
          {after !== null && after < 0 && (
            <p className="hint-warn">Only {formatQty(product.on_hand, product.unit)} on hand: the server will refuse this.</p>
          )}
          {failure?.field === 'form' && (
            <p className="field-error" role="alert">
              {failure.message}
            </p>
          )}
        </div>
        <div className="sheet-foot">
          <button type="submit" className="btn btn-hivis btn-block" disabled={!product || !validQuantity || pending}>
            {pending ? 'Recording…' : submitLabel}
          </button>
        </div>
      </form>
    </BottomSheet>
  )
}
