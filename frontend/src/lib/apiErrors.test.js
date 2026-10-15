import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseApiError } from './apiErrors.js'

test('a 422 list detail maps to fieldErrors.sku', () => {
  const payload = {
    detail: [{ loc: ['body', 'sku'], msg: "String should match pattern '^[A-Z0-9-]{3,20}$'", type: 'string_pattern_mismatch' }],
  }
  const parsed = parseApiError(422, payload)
  assert.equal(parsed.fieldErrors.sku, "String should match pattern '^[A-Z0-9-]{3,20}$'")
  assert.match(parsed.message, /pattern/)
})

test("a model-level 422 strips pydantic's 'Value error, ' prefix and has no field", () => {
  const payload = { detail: [{ loc: ['body'], msg: 'Value error, name may not be null', type: 'value_error' }] }
  const parsed = parseApiError(422, payload)
  assert.equal(parsed.message, 'name may not be null')
  assert.deepEqual(parsed.fieldErrors, {})
})

test('a string detail becomes the message', () => {
  const parsed = parseApiError(422, { detail: 'Insufficient stock: on hand 160, requested 99999' })
  assert.equal(parsed.message, 'Insufficient stock: on hand 160, requested 99999')
  assert.deepEqual(parsed.fieldErrors, {})
})

test("an nginx HTML 502 becomes 'API unavailable'", () => {
  assert.equal(parseApiError(502, '<html><body>502 Bad Gateway</body></html>').message, 'API unavailable')
})

test("status 0 → Can't reach the API; unknown statuses → HTTP <n>", () => {
  assert.equal(parseApiError(0, null).message, "Can't reach the API")
  assert.equal(parseApiError(418, '').message, 'HTTP 418')
})
