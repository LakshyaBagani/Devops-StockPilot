import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SERVICE_LEVEL, DEFAULT_HORIZON } from '../config.js'
import { buildPlanQuery, formatPct, formatRisk, horizonWord, riskBand, riskLevel } from './planner.js'

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
