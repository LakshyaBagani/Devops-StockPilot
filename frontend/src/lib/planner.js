// Reorder-planner query and risk helpers.

// Fixed parameter order and no `scenarios`: the server default applies and is echoed back, so the
// default query is byte-identical to the load generator's (service_level=95&horizon_days=30).
export function buildPlanQuery({ serviceLevel, horizonDays, surgePct = 0 }) {
  const params = new URLSearchParams()
  params.set('service_level', String(serviceLevel))
  params.set('horizon_days', String(horizonDays))
  if (surgePct) params.set('surge_pct', String(surgePct))
  return params.toString()
}

// Against the target risk t = 1 − SL: green when even the pessimistic end meets it,
// red when even the optimistic end misses it, amber when the margin straddles it.
export function riskLevel(p, margin, serviceLevel) {
  const target = (100 - serviceLevel) / 100
  if (p + margin <= target) return 'green'
  if (p - margin > target) return 'red'
  return 'amber'
}

export function riskBand(p, margin) {
  return [Math.max(0, p - margin), Math.min(1, p + margin)]
}

export function formatPct(p) {
  const pct = p * 100
  if (pct === 0) return '0%'
  if (pct < 0.1) return '<0.1%'
  return pct < 1 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`
}

// '23% ± 3': the margin in percentage points.
export function formatRisk(p, margin) {
  return `${formatPct(p)} ± ${formatPct(margin).slice(0, -1)}`
}

const HORIZON_WORDS = { 14: 'fortnights', 30: 'months', 60: 'two-month periods' }

export function horizonWord(days) {
  return HORIZON_WORDS[days] ?? `${days}-day periods`
}
