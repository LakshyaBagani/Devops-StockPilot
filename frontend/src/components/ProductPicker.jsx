import { useRef, useState } from 'react'

import { asList, paths } from '../api.js'
import { LIMITS, PAGE_SIZE } from '../config.js'
import { useApiGet } from '../hooks/useApiGet.js'
import { useDebouncedValue } from '../hooks/useDebouncedValue.js'
import { formatNumber } from '../lib/format.js'
import { Icon } from './Icon.jsx'

// Server-side search (8 results). ArrowDown moves into the list; Enter in the box picks the top match.
// Each result reads name first (wrapping, never truncated), the SKU beneath it, on hand on the right.
export function ProductPicker({ inputRef, onSelect, version }) {
  const [text, setText] = useState('')
  const q = useDebouncedValue(text.trim(), 200)
  const { data, error, loading } = useApiGet(paths.products({ q, limit: PAGE_SIZE.picker }), { version })
  const listRef = useRef(null)
  const items = asList(data)

  function focusResult(index) {
    const buttons = listRef.current?.querySelectorAll('button') ?? []
    if (buttons.length) buttons[Math.max(0, Math.min(index, buttons.length - 1))].focus()
  }

  function onInputKeyDown(event) {
    if (event.key === 'ArrowDown' && items.length) {
      event.preventDefault()
      focusResult(0)
    } else if (event.key === 'Enter') {
      // Never submit the record form from the search box.
      event.preventDefault()
      if (items.length) onSelect(items[0])
    }
  }

  function onResultKeyDown(event, index) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusResult(index + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (index === 0) inputRef.current?.focus()
      else focusResult(index - 1)
    }
  }

  return (
    <div className="sp-field sp-picker">
      <label className="sp-label" htmlFor="record-product">
        Product
      </label>
      <span className="sp-search">
        <Icon name="search" size={20} />
        <input
          id="record-product"
          ref={inputRef}
          type="search"
          autoComplete="off"
          spellCheck="false"
          maxLength={LIMITS.search}
          placeholder="Type a SKU or name"
          aria-describedby="record-product-hint"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onInputKeyDown}
        />
      </span>
      <p id="record-product-hint" className="sp-hint sp-picker-hint">
        Enter picks the top match; the arrow keys move through the list.
      </p>
      {error && !data ? (
        <p className="sp-error" role="alert">
          {error.message}
        </p>
      ) : (
        <ul ref={listRef} className="sp-picker-list" aria-label="Matching products" aria-busy={loading || undefined}>
          {items.map((product, index) => (
            <li key={product.id}>
              <button
                type="button"
                className="sp-picker-option"
                onClick={() => onSelect(product)}
                onKeyDown={(event) => onResultKeyDown(event, index)}
              >
                <span className="sp-picker-name">{product.name}</span>
                <span className="sp-sku sp-picker-sku">{product.sku}</span>
                <span className="sp-picker-qty">
                  <span className="num">{formatNumber(product.on_hand)}</span>
                  <span className="sp-unit">{product.unit}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && !loading && items.length === 0 && <p className="sp-hint">No product matches &ldquo;{q}&rdquo;.</p>}
    </div>
  )
}
