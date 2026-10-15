// Original 24×24 stroke glyphs drawn with currentColor; no icon library.
const GLYPHS = {
  crate: (
    <>
      <rect x="3" y="6" width="18" height="14" />
      <path d="M3 10.5h18M7.5 6v4.5M16.5 6v4.5M6 13.5l3.5 4M14.5 13.5l3.5 4" />
    </>
  ),
  stock: (
    <>
      <path d="M3 21V4M21 21V4M3 12h18M3 20h18" />
      <rect x="6" y="6" width="5" height="6" />
      <rect x="13" y="15" width="5" height="5" />
    </>
  ),
  record: (
    <>
      <rect x="5" y="4" width="14" height="17" />
      <path d="M9 4V2.5h6V4M12 9v7M8.5 12.5h7" />
    </>
  ),
  ledger: (
    <>
      <path d="M5 3h12l2 2v16H5z" />
      <path d="M9 3v18M12 8h4M12 12h4M12 16h3" />
    </>
  ),
  planner: (
    <>
      <rect x="2.5" y="10" width="10" height="10" rx="1.5" />
      <rect x="11.5" y="3.5" width="10" height="10" rx="1.5" />
      <path d="M5.5 13h.01M9.5 17h.01M7.5 15h.01M14.5 6.5h.01M18.5 10.5h.01" />
    </>
  ),
  products: (
    <>
      <path d="M3 3h8l10 10-8 8L3 11z" />
      <path d="M7.5 7.5h.01" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  undo: <path d="M9 5L4 10l5 5M4 10h10a6 6 0 0 1 0 12h-3" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5.5 5.5" />
    </>
  ),
  chevron: <path d="M9 5l7 7-7 7" />,
}

export function Icon({ name, size = 24 }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[name]}
    </svg>
  )
}
