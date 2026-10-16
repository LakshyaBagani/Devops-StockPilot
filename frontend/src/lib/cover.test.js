import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  coverAria,
  coverBeyond,
  coverFigure,
  coverFill,
  coverLabel,
  coverLevel,
  coverPhrase,
  needsReorder,
  runwayLevel,
} from './cover.js'

test('coverLevel boundaries: null none, 0 red, 6.99 red, 7 amber, 13.99 amber, 14 green', () => {
  assert.equal(coverLevel(null, 7), 'none')
  assert.equal(coverLevel(0, 7), 'red')
  assert.equal(coverLevel(6.99, 7), 'red')
  assert.equal(coverLevel(7, 7), 'amber')
  assert.equal(coverLevel(13.99, 7), 'amber')
  assert.equal(coverLevel(14, 7), 'green')
})

test('runwayLevel is coverLevel, except that nothing on hand is always red', () => {
  assert.equal(runwayLevel(20, 7, 50), 'green')
  assert.equal(runwayLevel(null, 7, 50), 'none')
  assert.equal(runwayLevel(null, 7, 0), 'red')
  assert.equal(runwayLevel(0, 7, 0), 'red')
  assert.equal(runwayLevel(30, 7, -2), 'red')
})

test('coverFill maps 0..3L onto 0..1 and clamps', () => {
  assert.ok(Math.abs(coverFill(7, 7) - 1 / 3) < 1e-9)
  assert.equal(coverFill(21, 7), 1)
  assert.equal(coverFill(500, 7), 1)
  assert.equal(coverFill(null, 7), 0)
  assert.equal(coverFill(-3, 7), 0)
})

test('coverBeyond is true only past the runway end at 3L', () => {
  assert.equal(coverBeyond(21, 7), false)
  assert.equal(coverBeyond(21.1, 7), true)
  assert.equal(coverBeyond(79.1, 14), true)
  assert.equal(coverBeyond(null, 7), false)
})

test("coverFigure: floored days, '<1' under a day, '365+' from a year, null without demand", () => {
  assert.equal(coverFigure(null), null)
  assert.equal(coverFigure(0), '<1')
  assert.equal(coverFigure(0.99), '<1')
  assert.equal(coverFigure(1), '1')
  assert.equal(coverFigure(15.1), '15')
  assert.equal(coverFigure(364.9), '364')
  assert.equal(coverFigure(365), '365+')
})

test("coverLabel: on hand 0 → 'out', null → 'no demand', then floored days", () => {
  assert.equal(coverLabel(0, 0), 'out')
  assert.equal(coverLabel(null, 12), 'no demand')
  assert.equal(coverLabel(0.4, 3), '<1 d')
  assert.equal(coverLabel(12.9, 40), '12 d')
  assert.equal(coverLabel(400, 4000), '365+ d')
})

test('coverPhrase splits the caption into a figure and words, out of stock first', () => {
  assert.deepEqual(coverPhrase(32.2, 44), { figure: '32', words: 'd cover' })
  assert.deepEqual(coverPhrase(0.4, 3), { figure: '<1', words: 'd cover' })
  assert.deepEqual(coverPhrase(null, 12), { figure: null, words: 'No demand' })
  assert.deepEqual(coverPhrase(0, 0), { figure: null, words: 'Out of stock' })
  assert.deepEqual(coverPhrase(null, 0), { figure: null, words: 'Out of stock' })
})

test('coverAria names the cover, the delivery time and the level word', () => {
  assert.equal(coverAria(4.2, 7), '4 days of cover, delivery takes 7 days, short')
  assert.equal(coverAria(20, 7), '20 days of cover, delivery takes 7 days, healthy')
  assert.equal(coverAria(10, 7, 30), '10 days of cover, delivery takes 7 days, watch')
  assert.equal(coverAria(0.5, 5, 2), 'Under 1 day of cover, delivery takes 5 days, short')
  assert.equal(coverAria(null, 1), 'No demand in 30 days, delivery takes 1 day')
  assert.equal(coverAria(0, 7, 0), 'Out of stock, delivery takes 7 days')
  assert.equal(coverAria(null, 7, 0), 'Out of stock, delivery takes 7 days')
})

test('needsReorder uses on_hand ≤ reorder_point: (10, 10) true, (11, 10) false', () => {
  assert.equal(needsReorder(10, 10), true)
  assert.equal(needsReorder(11, 10), false)
})
