// Original 24×24 line glyphs drawn with currentColor at a 1.75 stroke; no icon library.
const PIP = { fill: 'currentColor', stroke: 'none' }

const GLYPHS = {
  // Two uprights, two shelves, a box on each.
  stock: (
    <>
      <path d="M4 3v18M20 3v18M4 11.5h16M4 20h16" />
      <rect x="7" y="6" width="5" height="5.5" rx="0.75" />
      <rect x="13" y="14.5" width="4.5" height="5.5" rx="0.75" />
    </>
  ),
  // A bill-book slip: the tear line under its stub, and a plus.
  record: (
    <>
      <rect x="5" y="2.75" width="14" height="18.5" rx="1.75" />
      <path d="M5 8h14" strokeDasharray="0 3" />
      <path d="M12 11.25v6.5M8.75 14.5h6.5" />
    </>
  ),
  // A bound ledger with ruled entries.
  ledger: (
    <>
      <path d="M4.5 19V4.75A1.75 1.75 0 0 1 6.25 3H19.5v15H6.25A1.75 1.75 0 0 0 4.5 19.75 1.75 1.75 0 0 0 6.25 21.5H19.5" />
      <path d="M9 7.5h6.5M9 11h6.5M9 14.5h4" />
    </>
  ),
  // Two dice: the planner replays demand at random.
  planner: (
    <>
      <path d="M14 14h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-6a2 2 0 0 0-2 2v2" />
      <rect x="3.5" y="9" width="10.5" height="10.5" rx="2" />
      <circle cx="16.25" cy="7.75" r="1.1" {...PIP} />
      <circle cx="6.75" cy="12.25" r="1.1" {...PIP} />
      <circle cx="10.75" cy="16.25" r="1.1" {...PIP} />
    </>
  ),
  // A price tag.
  products: (
    <>
      <path d="M3.5 12.4V5a1.5 1.5 0 0 1 1.5-1.5h7.4a1.5 1.5 0 0 1 1.06.44l7.1 7.1a1.5 1.5 0 0 1 0 2.12l-7.4 7.4a1.5 1.5 0 0 1-2.12 0l-7.1-7.1a1.5 1.5 0 0 1-.44-1.06z" />
      <circle cx="8.25" cy="8.25" r="1.25" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  // A ringed exclamation mark: warnings and failures.
  alert: (
    <>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M12 7.5v5.25" />
      <circle cx="12" cy="16.25" r="1.1" {...PIP} />
    </>
  ),
  arrow: <path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" />,
  undo: <path d="M9 14.5 4 9.5l5-5M4 9.5h10.5a5.5 5.5 0 0 1 0 11H11" />,
  search: (
    <>
      <circle cx="10.75" cy="10.75" r="6.25" />
      <path d="M15.5 15.5l5 5" />
    </>
  ),
  chevron: <path d="M9 5.5 15.5 12 9 18.5" />,
}

export function Icon({ name, size = 24 }) {
  return (
    <svg
      className="sp-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[name]}
    </svg>
  )
}
