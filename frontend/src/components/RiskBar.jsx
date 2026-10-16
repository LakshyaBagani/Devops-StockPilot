import { axisPct, formatPct, riskBand, targetRisk } from '../lib/planner.js'

const HEIGHT = 20
const MID = HEIGHT / 2
// Faint quarter ticks, so a position reads the same way all down a long column of rows.
const QUARTERS = [0.25, 0.5, 0.75]

// Positions are SVG percentage lengths and every colour comes from planner.css, so the chart needs
// no inline style (CSP style-src 'self') and stretches with its cell.
const at = (fraction) => `${axisPct(fraction)}%`

// One plan row's stock-out risk on a 0–100% axis: the estimate as a dot, its 95% margin as
// whiskers, and the target risk (100 − service level) as an upright rule. Drawing order matters:
// the halo cuts the track and the target rule around the dot, the whiskers run into the dot, and
// a margin narrower than the dot stays hidden under it (the estimate is that precise).
export function RiskBar({ p, margin, serviceLevel, verdict }) {
  const [low, high] = riskBand(p, margin)
  const target = targetRisk(serviceLevel)
  // A product without recent sales was never simulated: the axis and target, but no estimate.
  const estimated = verdict !== 'idle'
  const label = estimated
    ? `Between ${formatPct(low)} and ${formatPct(high)}, against a target of ${formatPct(target)} or less`
    : 'No estimate: no recent sales'
  return (
    <svg className="sp-risk" data-verdict={verdict} width="100%" height={HEIGHT} role="img" aria-label={label}>
      <line className="sp-risk-track" x1="0%" x2="100%" y1={MID} y2={MID} />
      {QUARTERS.map((quarter) => (
        <line key={quarter} className="sp-risk-tick" x1={at(quarter)} x2={at(quarter)} y1={MID - 3} y2={MID + 3} />
      ))}
      <line className="sp-risk-target" x1={at(target)} x2={at(target)} y1="0" y2={HEIGHT} />
      {estimated && (
        <>
          <circle className="sp-risk-halo" cx={at(p)} cy={MID} r="6.5" />
          <line className="sp-risk-range" x1={at(low)} x2={at(high)} y1={MID} y2={MID} />
          <line className="sp-risk-range" x1={at(low)} x2={at(low)} y1={MID - 5} y2={MID + 5} />
          <line className="sp-risk-range" x1={at(high)} x2={at(high)} y1={MID - 5} y2={MID + 5} />
          <circle className="sp-risk-dot" cx={at(p)} cy={MID} r="4.5" />
        </>
      )}
    </svg>
  )
}

// The axis every row shares, labelled once: the target rule with its value, and the 100% end
// (the target sits within 20% of zero, so a '0%' label would collide with it; the left end is
// plainly zero). It uses the rows' insets (planner.css), so it lines up with them in the table
// header and above stacked rows. The page states the target in words for screen readers.
export function RiskAxis({ serviceLevel, className = '' }) {
  const target = targetRisk(serviceLevel)
  return (
    <svg
      className={`sp-risk sp-risk-axis ${className}`.trim()}
      width="100%"
      height="26"
      aria-hidden="true"
      focusable="false"
    >
      <text className="sp-risk-axis-target" x={at(target)} dx="6" y="11">
        {formatPct(target)} target
      </text>
      <text x="100%" y="11" textAnchor="end">
        100%
      </text>
      <line className="sp-risk-target" x1={at(target)} x2={at(target)} y1="0" y2="26" />
      <line className="sp-risk-baseline" x1="0%" x2="100%" y1="20" y2="20" />
      <line className="sp-risk-baseline" x1="0%" x2="0%" y1="16" y2="24" />
      <line className="sp-risk-baseline" x1="100%" x2="100%" y1="16" y2="24" />
    </svg>
  )
}
