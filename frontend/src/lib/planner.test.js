import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SERVICE_LEVEL, DEFAULT_HORIZON } from '../config.js'
import {
  VERDICTS,
  axisPct,
  buildPlanQuery,
  countVerdicts,
  NO_MEDIAN_STOCKOUT,
  formatMargin,
  formatPct,
  formatRisk,
  horizonWord,
  planLabel,
  planVerdict,
  riskBand,
  riskLevel,
  sameScenario,
  scenarioLabel,
  spokenMargin,
  targetRisk,
  verdictParts,
  verdictSentence,
} from './planner.js'

// k8s/loadgen.yaml requests exactly this query (B50): the UI default must stay byte-identical.
const LOADGEN_QUERY = 'service_level=95&horizon_days=30'

test('default planner query equals the loadgen query and omits scenarios', () => {
  const query = buildPlanQuery({ serviceLevel: SERVICE_LEVEL.default, horizonDays: DEFAULT_HORIZON, surgePct: 0 })
  assert.equal(query, LOADGEN_QUERY)
  assert.ok(!query.includes('scenarios'))
})

test('surge 20 appends surge_pct=20 after the fixed parameters', () => {
  assert.equal(
    buildPlanQuery({ serviceLevel: 95, horizonDays: 60, surgePct: 20 }),
    'service_level=95&horizon_days=60&surge_pct=20',
  )
})

test('riskLevel (0.02, 0.01, 95) green; (0.30, 0.03, 95) red; (0.05, 0.02, 95) amber; (0, 0, 95) green', () => {
  assert.equal(riskLevel(0.02, 0.01, 95), 'green')
  assert.equal(riskLevel(0.3, 0.03, 95), 'red')
  assert.equal(riskLevel(0.05, 0.02, 95), 'amber')
  assert.equal(riskLevel(0, 0, 95), 'green')
})

test('riskBand clamps to 0..1', () => {
  assert.deepEqual(riskBand(0.01, 0.02), [0, 0.03])
  assert.deepEqual(riskBand(0.99, 0.05), [0.94, 1])
})

test('formatPct uses whole percent, one decimal below 1 %, and formatRisk adds the margin', () => {
  assert.equal(formatPct(0.2312), '23%')
  assert.equal(formatPct(0.004), '0.4%')
  assert.equal(formatPct(0), '0%')
  assert.equal(formatPct(0.0004), '<0.1%')
  assert.equal(formatRisk(0.23, 0.03), '23% ± 3')
})

test('horizonWord for 14, 30 and 60 days', () => {
  assert.equal(horizonWord(14), 'fortnights')
  assert.equal(horizonWord(30), 'months')
  assert.equal(horizonWord(60), 'two-month periods')
  assert.equal(horizonWord(45), '45-day periods')
})

test('targetRisk is 100 − service level as a fraction, without float noise', () => {
  assert.equal(targetRisk(95), 0.05)
  assert.equal(targetRisk(80), 0.2)
  assert.equal(targetRisk(99), 0.01)
  assert.equal(targetRisk(99.9), 0.001)
})

test('riskLevel on the boundary: an interval touching the target from below meets it, from above is too close', () => {
  // 0.03 + 0.02 is 0.05 exactly in basis points, whatever the float sum says.
  assert.equal(riskLevel(0.03, 0.02, 95), 'green')
  assert.equal(riskLevel(0.07, 0.02, 95), 'amber')
  assert.equal(riskLevel(0.0701, 0.02, 95), 'red')
  assert.equal(riskLevel(0.0005, 0.0005, 99.9), 'green')
})

const item = (stockout_risk, risk_margin, avg_daily_demand = 2) => ({ stockout_risk, risk_margin, avg_daily_demand })

test('planVerdict maps the interval against the target, and no demand to idle rather than safe', () => {
  assert.equal(planVerdict(item(0.953, 0.0131), 95), 'misses')
  assert.equal(planVerdict(item(0.052, 0.0138), 95), 'close')
  assert.equal(planVerdict(item(0.02, 0.0087), 95), 'meets')
  assert.equal(planVerdict(item(0, 0, 0), 95), 'idle')
  // The same row against a looser target.
  assert.equal(planVerdict(item(0.052, 0.0138), 90), 'meets')
  for (const verdict of ['misses', 'close', 'meets', 'idle']) {
    assert.ok(VERDICTS[verdict].label && VERDICTS[verdict].tone)
  }
  assert.equal(VERDICTS.misses.label, 'misses target')
  assert.equal(VERDICTS.close.label, 'too close to call')
  assert.equal(VERDICTS.meets.label, 'meets target')
})

test('countVerdicts tallies every row once', () => {
  const items = [item(0.95, 0.013), item(0.7, 0.03), item(0.052, 0.014), item(0.01, 0.006), item(0, 0, 0)]
  assert.deepEqual(countVerdicts(items, 95), { misses: 2, close: 1, meets: 1, idle: 1 })
  assert.deepEqual(countVerdicts([], 95), { misses: 0, close: 0, meets: 0, idle: 0 })
})

test('verdictParts names the products once, agrees in number, and says "it" only after the target', () => {
  const text = (counts) => verdictParts(counts).map((part) => part.text)
  assert.deepEqual(text({ misses: 7, close: 4, meets: 29 }), [
    '7 products miss the target',
    '4 are too close to call',
    '29 meet it',
  ])
  assert.deepEqual(text({ misses: 1, close: 1, meets: 1 }), [
    '1 product misses the target',
    '1 is too close to call',
    '1 meets it',
  ])
  assert.deepEqual(text({ close: 4, meets: 36 }), ['4 products are too close to call', '36 meet the target'])
  assert.deepEqual(text({ misses: 3 }), ['All 3 products miss the target'])
  assert.deepEqual(text({ misses: 1 }), ['1 product misses the target'])
  assert.deepEqual(text({ meets: 2 }), ['Both products meet the target'])
  assert.deepEqual(text({ meets: 40 }), ['All 40 products meet the target'])
  assert.deepEqual(text({ meets: 1 }), ['The one product meets the target'])
  assert.deepEqual(text({ misses: 2, meets: 5, idle: 1 }), [
    '2 products miss the target',
    '5 meet it',
    '1 has no recent sales',
  ])
  assert.deepEqual(text({ idle: 2 }), ['2 products have no recent sales'])
  assert.deepEqual(text({}), [])
  assert.deepEqual(
    verdictParts({ misses: 1, close: 2 }).map((part) => part.verdict),
    ['misses', 'close'],
  )
})

test('verdictParts names the target value once, and verdictSentence joins the parts', () => {
  const parts = verdictParts({ misses: 18, close: 8, meets: 14 }, { target: '5%' })
  assert.deepEqual(
    parts.map((part) => part.text),
    ['18 products miss the 5% target', '8 are too close to call', '14 meet it'],
  )
  assert.equal(verdictSentence(parts), '18 products miss the 5% target, 8 are too close to call and 14 meet it.')
  assert.equal(
    verdictSentence(verdictParts({ close: 4, meets: 36 }, { target: '1%' })),
    '4 products are too close to call and 36 meet the 1% target.',
  )
  assert.equal(verdictSentence(verdictParts({ meets: 40 }, { target: '5%' })), 'All 40 products meet the 5% target.')
  assert.equal(verdictSentence(verdictParts({ misses: 2 })), 'Both products miss the target.')
  assert.equal(verdictSentence(verdictParts({ misses: 40 }, { target: '5%' })), 'All 40 products miss the 5% target.')
})

test('formatPct shows a margin just under one point as 1%, never 1.0%', () => {
  assert.equal(formatPct(0.0099), '1%')
  assert.equal(formatPct(0.0096), '1%')
  assert.equal(formatPct(0.0094), '0.9%')
  assert.equal(formatMargin(0.0099), '± 1')
})

test('axisPct places a fraction on the 0–100 axis, clamped', () => {
  assert.equal(axisPct(0.953), 95.3)
  assert.equal(axisPct(0.0131), 1.31)
  assert.equal(axisPct(0), 0)
  assert.equal(axisPct(-0.002), 0)
  assert.equal(axisPct(1.004), 100)
})

test('formatMargin and spokenMargin give the margin in percentage points', () => {
  assert.equal(formatMargin(0.0131), '± 1')
  assert.equal(formatMargin(0.0309), '± 3')
  assert.equal(formatMargin(0.0087), '± 0.9')
  assert.equal(spokenMargin(0.0131), 'plus or minus 1 percentage point')
  assert.equal(spokenMargin(0.0309), 'plus or minus 3 percentage points')
  assert.equal(spokenMargin(0.0087), 'plus or minus 0.9 percentage points')
  assert.equal(spokenMargin(0.0004), 'plus or minus less than 0.1 percentage points')
})

test('a null median reads as "none in most runs", never as no stock-out', () => {
  assert.equal(NO_MEDIAN_STOCKOUT, 'none in most runs')
  assert.ok(!/no stock-out/i.test(NO_MEDIAN_STOCKOUT))
})

test('scenarioLabel, planLabel and sameScenario describe the controls and the returned plan', () => {
  const controls = { serviceLevel: 95, horizonDays: 30, surgePct: 0 }
  assert.equal(scenarioLabel(controls), '95% · 30 d · no surge')
  assert.equal(scenarioLabel({ serviceLevel: 90, horizonDays: 60, surgePct: 40 }), '90% · 60 d · +40% surge')
  // The server echoes floats (95.0 arrives as 95 through JSON).
  const plan = { service_level: 95, horizon_days: 30, surge_pct: 0 }
  assert.equal(planLabel(plan), '95% service level · 30 days · no surge')
  assert.equal(planLabel({ service_level: 99, horizon_days: 14, surge_pct: 20 }), '99% service level · 14 days · +20% surge')
  assert.ok(sameScenario(controls, plan))
  assert.ok(!sameScenario({ ...controls, surgePct: 20 }, plan))
  assert.ok(!sameScenario({ ...controls, serviceLevel: 96 }, plan))
  assert.ok(!sameScenario({ ...controls, horizonDays: 60 }, plan))
})
