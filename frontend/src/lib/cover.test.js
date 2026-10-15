import assert from 'node:assert/strict'
import { test } from 'node:test'

import { coverAria, coverFill, coverLabel, coverLevel, needsReorder } from './cover.js'

test('coverLevel boundaries: null none, 0 red, 6.99 red, 7 amber, 13.99 amber, 14 green', () => {
  assert.equal(coverLevel(null, 7), 'none')
  assert.equal(coverLevel(0, 7), 'red')
  assert.equal(coverLevel(6.99, 7), 'red')
  assert.equal(coverLevel(7, 7), 'amber')
  assert.equal(coverLevel(13.99, 7), 'amber')
  assert.equal(coverLevel(14, 7), 'green')
})

test('coverFill maps 0..3L onto 0..1 and clamps', () => {
  assert.ok(Math.abs(coverFill(7, 7) - 1 / 3) < 1e-9)
  assert.equal(coverFill(21, 7), 1)
  assert.equal(coverFill(500, 7), 1)
  assert.equal(coverFill(null, 7), 0)
})

test("coverLabel: on hand 0 → 'out', null → 'no demand', then floored days", () => {
  assert.equal(coverLabel(0, 0), 'out')
  assert.equal(coverLabel(null, 12), 'no demand')
  assert.equal(coverLabel(0.4, 3), '<1 d')
  assert.equal(coverLabel(12.9, 40), '12 d')
  assert.equal(coverLabel(400, 4000), '365+ d')
})

test('coverAria names the cover, lead time and level word', () => {
  assert.equal(coverAria(4.2, 7), '4 days of cover, lead time 7 days, short')
  assert.equal(coverAria(20, 7), '20 days of cover, lead time 7 days, healthy')
  assert.equal(coverAria(null, 1), 'No demand in 30 days, lead time 1 day')
})

test('needsReorder uses on_hand ≤ reorder_point: (10, 10) true, (11, 10) false', () => {
  assert.equal(needsReorder(10, 10), true)
  assert.equal(needsReorder(11, 10), false)
})
