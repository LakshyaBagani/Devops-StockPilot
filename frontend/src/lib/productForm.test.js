import assert from 'node:assert/strict'
import { test } from 'node:test'

import { EMPTY_PRODUCT, changedFields, productToForm, validateProduct } from './productForm.js'

const STORED = {
  id: 3,
  sku: 'PEN-REY-BLU',
  name: 'Reynolds pen (blue)',
  category: 'STATIONERY',
  unit: 'pcs',
  unit_cost_paise: 1000,
  reorder_point: 40,
  lead_time_days: 7,
}

test("a new product's lowercase sku is upper-cased and '12.5' becomes 1250 paise", () => {
  const values = { ...EMPTY_PRODUCT, sku: 'test-01', name: ' Test item ', category: 'OTHER', unitCost: '12.5' }
  const { errors, payload } = validateProduct(values, { isNew: true })
  assert.deepEqual(errors, {})
  assert.deepEqual(payload, {
    sku: 'TEST-01',
    name: 'Test item',
    category: 'OTHER',
    unit: 'pcs',
    unit_cost_paise: 1250,
    reorder_point: 0,
    lead_time_days: 7,
  })
})

test("client checks block '1.005', a 2-character sku, lead time 61 and a blank name", () => {
  const values = { ...EMPTY_PRODUCT, sku: 'ab', category: 'OTHER', unitCost: '1.005', leadTime: '61' }
  const { errors } = validateProduct(values, { isNew: true })
  assert.deepEqual(Object.keys(errors).sort(), ['leadTime', 'name', 'sku', 'unitCost'])
})

test('editing only the name produces a PUT body of exactly {name}', () => {
  const values = { ...productToForm(STORED), name: 'Reynolds pen (blue, 045)' }
  const { errors, payload } = validateProduct(values, { isNew: false })
  assert.deepEqual(errors, {})
  assert.deepEqual(changedFields(STORED, payload), { name: 'Reynolds pen (blue, 045)' })
})

test('an unchanged edit form produces an empty PUT body', () => {
  const { payload } = validateProduct(productToForm(STORED), { isNew: false })
  assert.deepEqual(changedFields(STORED, payload), {})
})
