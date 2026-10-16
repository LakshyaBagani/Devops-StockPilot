import { useCallback, useMemo, useRef, useState } from 'react'

import { ToastContext } from '../state/toast.js'
import { Icon } from './Icon.jsx'

const MAX_TOASTS = 3
const TONE_ICONS = { ok: 'check', error: 'alert' }

// A toast reads like a receipt line ("Reynolds pen (blue) −20 → 111 left"). `message` may be a
// string or a node, e.g. with <span className="num"> around the figures.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(0)

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((toast) => toast.id !== id))
  }, [])

  const show = useCallback(
    ({ message, tone = 'info', action, ms }) => {
      nextId.current += 1
      const id = nextId.current
      setToasts((list) => [...list, { id, message, tone, action }].slice(-MAX_TOASTS))
      setTimeout(() => dismiss(id), ms ?? (action ? 8000 : 5000))
    },
    [dismiss],
  )

  const value = useMemo(() => ({ show }), [show])

  return (
    <ToastContext value={value}>
      {children}
      <div className="sp-toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="sp-toast" data-tone={toast.tone}>
            {TONE_ICONS[toast.tone] && (
              <span className="sp-toast-icon">
                <Icon name={TONE_ICONS[toast.tone]} size={20} />
              </span>
            )}
            <p className="sp-toast-text">{toast.message}</p>
            {toast.action && (
              <button
                type="button"
                className="sp-toast-action"
                onClick={() => {
                  dismiss(toast.id)
                  toast.action.onClick()
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button type="button" className="sp-toast-close" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
              <Icon name="close" size={18} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  )
}
