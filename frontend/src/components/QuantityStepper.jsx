import { LIMITS } from '../config.js'
import { parseQuantity } from '../lib/format.js'
import { Icon } from './Icon.jsx'

function clamp(n) {
  return Math.min(LIMITS.quantity, Math.max(1, n))
}

// Positive whole numbers only. type=text + inputmode=numeric avoids the number-input quirks
// (scroll wheel, 'e'), and iOS's numeric keypad has no minus key anyway. `children` render under
// the error inside the same field (the record sheet's live before → after line).
export function QuantityStepper({ id, label, value, onChange, inputRef, error, children }) {
  const n = parseQuantity(value)
  const errorId = `${id}-error`
  return (
    <div className="sp-field sp-quantity">
      <label className="sp-label" htmlFor={id}>
        {label}
      </label>
      <div className="sp-stepper">
        <button
          type="button"
          className="sp-btn sp-stepper-btn"
          aria-label="Decrease quantity"
          disabled={n !== null && n <= 1}
          onClick={() => onChange(String(clamp((n ?? 2) - 1)))}
        >
          <Icon name="minus" />
        </button>
        <input
          id={id}
          ref={inputRef}
          className="num sp-stepper-input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => onChange(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
          onBlur={() => {
            if (n !== null) onChange(String(clamp(n)))
          }}
        />
        <button
          type="button"
          className="sp-btn sp-stepper-btn"
          aria-label="Increase quantity"
          disabled={n !== null && n >= LIMITS.quantity}
          onClick={() => onChange(String(clamp((n ?? 0) + 1)))}
        >
          <Icon name="plus" />
        </button>
      </div>
      {error && (
        <p id={errorId} className="sp-error" role="alert">
          {error}
        </p>
      )}
      {children}
    </div>
  )
}
