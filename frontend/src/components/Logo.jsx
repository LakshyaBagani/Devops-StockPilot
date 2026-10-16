// The StockPilot mark: three stock levels rising on an ink tile, the tallest in orange with a
// pilot's arrowhead on top. Decorative next to the wordmark, so it is hidden from screen readers.
export default function Logo({ size = 30 }) {
  return (
    <svg className="sp-logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="#221e18" />
      <rect x="6.5" y="17" width="4.5" height="9" rx="1.25" fill="#fbf9f6" opacity="0.55" />
      <rect x="13.75" y="13" width="4.5" height="13" rx="1.25" fill="#fbf9f6" />
      <rect x="21" y="11" width="4.5" height="15" rx="1.25" fill="#e8833a" />
      <path d="M19.6 10.4 23.25 5.5l3.65 4.9z" fill="#e8833a" />
    </svg>
  )
}
