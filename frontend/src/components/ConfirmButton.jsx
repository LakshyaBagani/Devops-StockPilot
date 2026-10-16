import { useCallback, useEffect, useRef, useState } from 'react'

const ARMED_MS = 5000

// Two-step inline confirm: the quiet trigger (Undo, Delete) swaps itself for a solid
// [confirm][Cancel] pair for 5 s. Never window.confirm and never a modal. `className` adds
// classes to the trigger only.
export function ConfirmButton({ label, confirmLabel, onConfirm, disabled, describedBy, ariaLabel, className }) {
  const [armed, setArmed] = useState(false)
  const [pending, setPending] = useState(false)
  const groupRef = useRef(null)
  const restoreFocus = useRef(false)

  const disarm = useCallback(() => {
    restoreFocus.current = groupRef.current?.contains(document.activeElement) ?? false
    setArmed(false)
  }, [])

  // Hand focus back to the trigger when the confirm pair disappears under the user's focus.
  const triggerRef = useCallback((node) => {
    if (node && restoreFocus.current) {
      restoreFocus.current = false
      node.focus()
    }
  }, [])

  useEffect(() => {
    if (!armed || pending) return undefined
    groupRef.current?.querySelector('button')?.focus()
    const timer = setTimeout(disarm, ARMED_MS)
    return () => clearTimeout(timer)
  }, [armed, pending, disarm])

  async function confirm() {
    setPending(true)
    try {
      await onConfirm()
    } finally {
      setPending(false)
      disarm()
    }
  }

  if (!armed) {
    return (
      <button
        ref={triggerRef}
        type="button"
        className={className ? `sp-btn sp-btn-quiet ${className}` : 'sp-btn sp-btn-quiet'}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        onClick={() => setArmed(true)}
      >
        {label}
      </button>
    )
  }

  return (
    <span
      ref={groupRef}
      className="sp-confirm"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !pending) disarm()
      }}
    >
      <button type="button" className="sp-btn sp-btn-small sp-btn-danger" disabled={pending} onClick={confirm}>
        {pending ? 'Working…' : confirmLabel}
      </button>
      <button type="button" className="sp-btn sp-btn-small sp-btn-quiet" disabled={pending} onClick={disarm}>
        Cancel
      </button>
    </span>
  )
}
