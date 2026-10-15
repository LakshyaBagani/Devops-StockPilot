import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  dayGroupLabel,
  formatDelta,
  formatPaise,
  formatQty,
  paiseToRupeesText,
  parseApiDate,
  rupeesToPaise,
} from './format.js'

test('formatPaise 123456 → ₹1,234.56', () => {
  assert.equal(formatPaise(123456), '₹1,234.56')
})

test('formatPaise whole 41235000 → ₹4,12,350 (lakh grouping)', () => {
  assert.equal(formatPaise(41235000, { whole: true }), '₹4,12,350')
})

test('formatPaise keeps single-digit paise padded and rounds whole rupees half up', () => {
  assert.equal(formatPaise(105), '₹1.05')
  assert.equal(formatPaise(0), '₹0.00')
  assert.equal(formatPaise(149, { whole: true }), '₹1')
  assert.equal(formatPaise(150, { whole: true }), '₹2')
})

test("rupeesToPaise '12.5' → 1250 and '12.50' → 1250", () => {
  assert.equal(rupeesToPaise('12.5'), 1250)
  assert.equal(rupeesToPaise('12.50'), 1250)
  assert.equal(rupeesToPaise(' 40 '), 4000)
})

test("rupeesToPaise rejects '1.005', 'abc', '' and negatives", () => {
  assert.equal(rupeesToPaise('1.005'), null)
  assert.equal(rupeesToPaise('abc'), null)
  assert.equal(rupeesToPaise(''), null)
  assert.equal(rupeesToPaise('-5'), null)
})

test('paiseToRupeesText round-trips through rupeesToPaise', () => {
  assert.equal(paiseToRupeesText(1250), '12.50')
  assert.equal(paiseToRupeesText(1200), '12')
  assert.equal(paiseToRupeesText(5), '0.05')
  for (const paise of [1, 99, 1250, 999999]) assert.equal(rupeesToPaise(paiseToRupeesText(paise)), paise)
})

test('formatDelta uses U+2212 for negative deltas', () => {
  assert.equal(formatDelta(-20), '−20')
  assert.equal(formatDelta(20), '+20')
  assert.equal(formatDelta(1500), '+1,500')
})

test('formatQty groups en-IN and appends the unit', () => {
  assert.equal(formatQty(123456, 'pcs'), '1,23,456 pcs')
  assert.equal(formatQty(7), '7')
})

test("parseApiDate('2026-10-15T10:00:00') is read as UTC", () => {
  assert.equal(parseApiDate('2026-10-15T10:00:00').getTime(), Date.UTC(2026, 9, 15, 10))
  assert.equal(parseApiDate('2026-10-15T10:00:00Z').getTime(), Date.UTC(2026, 9, 15, 10))
  assert.equal(parseApiDate('2026-10-15T15:30:00+05:30').getTime(), Date.UTC(2026, 9, 15, 10))
})

test('dayGroupLabel says Today, Yesterday, then a short date', () => {
  const now = new Date(2026, 9, 15, 12, 0).getTime()
  assert.equal(dayGroupLabel(new Date(2026, 9, 15, 0, 5), now), 'Today')
  assert.equal(dayGroupLabel(new Date(2026, 9, 14, 23, 55), now), 'Yesterday')
  assert.equal(dayGroupLabel(new Date(2026, 9, 14 - 6, 9, 0), now), 'Thu, 8 Oct')
})
