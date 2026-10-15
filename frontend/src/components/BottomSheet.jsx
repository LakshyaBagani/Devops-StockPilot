import { useEffect, useId, useRef, useState } from 'react'

import { Icon } from './Icon.jsx'

// A native modal <dialog>: open while mounted (the URL decides mounting). Slides up from the
// bottom below 1024 px and docks right from 1024 px; never centred.
export function BottomSheet({ title, onClose, initialFocusRef, children }) {
  const dialogRef = useRef(null)
  const pressedBackdrop = useRef(false)
  // The close event fires asynchronously, so a close made by the cleanup below (StrictMode's
  // remount in dev) would arrive after the sheet reopened and shut it again.
  const closingItself = useRef(false)
  const titleId = useId()
  // Opening happens once per mount, so only the first focus target counts.
  const [initialFocus] = useState(initialFocusRef)

  useEffect(() => {
    const dialog = dialogRef.current
    const opener = document.activeElement
    dialog.showModal()
    initialFocus?.current?.focus()
    // A modal dialog does not stop the page behind it from scrolling (notably on iOS).
    document.body.classList.add('sheet-open')
    return () => {
      document.body.classList.remove('sheet-open')
      if (dialog.open) {
        closingItself.current = true
        dialog.close()
      }
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [initialFocus])

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      // The browser can still close it (a repeated Esc is not cancelable); keep the URL in step.
      onClose={() => {
        if (closingItself.current) closingItself.current = false
        else onClose()
      }}
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        // Only a press that starts and ends on the backdrop closes the sheet.
        if (pressedBackdrop.current && event.target === event.currentTarget) onClose()
      }}
    >
      <div className="sheet-frame">
        <header className="sheet-head">
          <h2 id={titleId} className="sheet-title">
            {title}
          </h2>
          <button type="button" className="btn btn-quiet sheet-close" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  )
}
