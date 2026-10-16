// Reorder-planner query, verdict, axis and wording helpers.

// Fixed parameter order and no `scenarios`: the server default applies and is echoed back, so the
// default query is byte-identical to the load generator's (service_level=95&horizon_days=30).
export function buildPlanQuery({ serviceLevel, horizonDays, surgePct = 0 }) {
  const params = new URLSearchParams()
  params.set('service_level', String(serviceLevel))
  params.set('horizon_days', String(horizonDays))
  if (surgePct) params.set('surge_pct', String(surgePct))
  return params.toString()
}

// Risk and margin arrive rounded to 4 dp, so whole basis points compare them exactly: in floats
// 0.03 + 0.02 against a 5% target, or 100 − 99.9, would land a hair either side of the boundary.
const basisPoints = (fraction) => Math.round(fraction * 10_000)

// The highest stock-out risk a service level accepts: 95 → 0.05, 99.9 → 0.001.
export function targetRisk(serviceLevel) {
  return basisPoints((100 - serviceLevel) / 100) / 10_000
}

// Against the target risk t = 1 − SL: green when even the pessimistic end meets it,
// red when even the optimistic end misses it, amber when the margin straddles it.
export function riskLevel(p, margin, serviceLevel) {
  const target = basisPoints(targetRisk(serviceLevel))
  if (basisPoints(p) + basisPoints(margin) <= target) return 'green'
  if (basisPoints(p) - basisPoints(margin) > target) return 'red'
  return 'amber'
}

export function riskBand(p, margin) {
  return [Math.max(0, p - margin), Math.min(1, p + margin)]
}

// The plain words a plan row carries, with the tone that colours them (never colour alone).
export const VERDICTS = {
  misses: { label: 'misses target', tone: 'danger' },
  close: { label: 'too close to call', tone: 'warning' },
  meets: { label: 'meets target', tone: 'success' },
  idle: { label: 'no recent sales', tone: 'quiet' },
}

const VERDICT_OF_LEVEL = { red: 'misses', amber: 'close', green: 'meets' }

// A product without sales in the history window is answered with zeros and never simulated, so
// it is reported as such rather than as safe.
export function planVerdict(item, serviceLevel) {
  if (!(item.avg_daily_demand > 0)) return 'idle'
  return VERDICT_OF_LEVEL[riskLevel(item.stockout_risk, item.risk_margin, serviceLevel)]
}

export function countVerdicts(items, serviceLevel) {
  const counts = { misses: 0, close: 0, meets: 0, idle: 0 }
  for (const item of items) counts[planVerdict(item, serviceLevel)] += 1
  return counts
}

// The plan in one sentence, as parts the page colours by verdict and joins with ', ' and ' and ':
// '7 products miss the 5% target', '4 are too close to call', '29 meet it'.
export function verdictParts({ misses = 0, close = 0, meets = 0, idle = 0 }, { target = '' } = {}) {
  const theTarget = target ? `the ${target} target` : 'the target'
  const total = misses + close + meets + idle
  const every = total === 2 ? 'Both products' : `All ${total} products`
  if (total === 1 && meets === 1) return [{ verdict: 'meets', text: `The one product meets ${theTarget}` }]
  if (total > 1 && meets === total) return [{ verdict: 'meets', text: `${every} meet ${theTarget}` }]
  if (total > 1 && misses === total) return [{ verdict: 'misses', text: `${every} miss ${theTarget}` }]
  const parts = []
  function add(verdict, n, one, many) {
    if (n === 0) return
    const subject = parts.length === 0 ? `${n} ${n === 1 ? 'product' : 'products'}` : String(n)
    parts.push({ verdict, text: `${subject} ${n === 1 ? one : many}` })
  }
  add('misses', misses, `misses ${theTarget}`, `miss ${theTarget}`)
  add('close', close, 'is too close to call', 'are too close to call')
  // 'it' only once the target has been named.
  const meetsWhat = misses > 0 ? 'it' : theTarget
  add('meets', meets, `meets ${meetsWhat}`, `meet ${meetsWhat}`)
  add('idle', idle, 'has no recent sales', 'have no recent sales')
  return parts
}

// The parts as plain text, for the live region: '…, 4 are too close to call and 29 meet it.'
export function verdictSentence(parts) {
  return `${parts.map((part, index) => `${index === 0 ? '' : partJoiner(index, parts.length)}${part.text}`).join('')}.`
}

export function partJoiner(index, count) {
  return index === count - 1 ? ' and ' : ', '
}

// A risk fraction as a position on the 0–100% axis, clamped and rounded for SVG attributes.
export function axisPct(fraction) {
  return basisPoints(Math.min(1, Math.max(0, fraction))) / 100
}

export function formatPct(p) {
  const pct = p * 100
  if (pct === 0) return '0%'
  if (pct < 0.1) return '<0.1%'
  // 0.96 rounds to '1.0' at one decimal: show it as the whole '1%' its neighbours use.
  return pct < 0.95 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`
}

// '23% ± 3': the margin in percentage points.
export function formatRisk(p, margin) {
  return `${formatPct(p)} ± ${formatPct(margin).slice(0, -1)}`
}

// The margin alone, in percentage points: '± 3', and what a screen reader says for it.
export function formatMargin(margin) {
  return `± ${formatPct(margin).slice(0, -1)}`
}

export function spokenMargin(margin) {
  const points = formatPct(margin).slice(0, -1)
  const amount = points.startsWith('<') ? `less than ${points.slice(1)}` : points
  return `plus or minus ${amount} percentage ${points === '1' ? 'point' : 'points'}`
}

// JSON has no infinity: a null median means more than half of the runs never ran out. That is
// not zero risk, so the page never words it as 'no stock-out'.
export const NO_MEDIAN_STOCKOUT = 'none in most runs'

function surgeWords(surgePct) {
  return surgePct > 0 ? `+${surgePct}% surge` : 'no surge'
}

// The scenario on the controls, for the folded summary on phones: '95% · 30 d · no surge'.
export function scenarioLabel({ serviceLevel, horizonDays, surgePct = 0 }) {
  return `${serviceLevel}% · ${horizonDays} d · ${surgeWords(surgePct)}`
}

// The scenario a plan was computed for, from the parameters the server echoed back.
export function planLabel(plan) {
  return `${plan.service_level}% service level · ${plan.horizon_days} days · ${surgeWords(plan.surge_pct)}`
}

// Whether the controls still describe the plan on screen.
export function sameScenario({ serviceLevel, horizonDays, surgePct = 0 }, plan) {
  return plan.service_level === serviceLevel && plan.horizon_days === horizonDays && plan.surge_pct === surgePct
}

const HORIZON_WORDS = { 14: 'fortnights', 30: 'months', 60: 'two-month periods' }

export function horizonWord(days) {
  return HORIZON_WORDS[days] ?? `${days}-day periods`
}
