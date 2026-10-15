import { formatRisk, riskBand, riskLevel } from '../lib/planner.js'

const LEVEL_WORDS = { green: 'meets the target', amber: 'too close to call', red: 'misses the target' }

// Stock-out risk on a 0–100 % track: the fill is the estimate, the band its ±95 % margin and the
// marker the target risk (100 − service level).
export function RiskBar({ p, margin, serviceLevel }) {
  const level = riskLevel(p, margin, serviceLevel)
  const [low, high] = riskBand(p, margin)
  const target = 100 - serviceLevel
  const text = formatRisk(p, margin)
  return (
    <div className="risk" role="img" aria-label={`Stock-out risk ${text}, target ${target}% or less: ${LEVEL_WORDS[level]}`}>
      <span className="risk-track">
        <span className="risk-band" style={{ '--low': low, '--high': high }} />
        <span className="risk-fill" data-level={level} style={{ '--p': p }} />
        <span className="risk-target" style={{ '--t': target / 100 }} title={`target ≤ ${target} %`} />
      </span>
      <span className="risk-text num">{text}</span>
    </div>
  )
}
