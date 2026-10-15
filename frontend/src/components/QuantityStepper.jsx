import { LIMITS } from '../config.js'
import { parseQuantity } from '../lib/format.js'
import { Icon } from './Icon.jsx'

function clamp(n) {
  return Math.min(LIMITS.quantity, Math.max(1, n))
}

// Positive whole numbers only. type=text + inputmode=numeric avoids the number-input quirks
// (scroll wheel, 'e'), and iOS's numeric keypad has no minus key anyway.
export function QuantityStepper({ id, label, value, onChange, inputRef, error }) {
  const n = parseQuantity(value)
  const errorId = `${id}-error`
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="stepper">
        <button
          type="button"
          className="btn stepper-btn"
          aria-label="Decrease quantity"
          disabled={n !== null && n <= 1}
          onClick={() => onChange(String(clamp((n ?? 2) - 1)))}
        >
          <Icon name="minus" />
        </button>
        <input
          id={id}
          ref={inputRef}
          className="num"
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
          className="btn stepper-btn"
          aria-label="Increase quantity"
          disabled={n !== null && n >= LIMITS.quantity}
          onClick={() => onChange(String(clamp((n ?? 0) + 1)))}
        >
          <Icon name="plus" />
        </button>
      </div>
      {error && (
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
