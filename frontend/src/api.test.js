import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

import { ApiError, getApiStatus, getJson, paths, recordMovement, request, updateProduct } from './api.js'

const realFetch = globalThis.fetch
let calls

function respond(status, body, headers = {}) {
  const isJson = body !== null && typeof body === 'object'
  return new Response(status === 204 ? null : isJson ? JSON.stringify(body) : body, {
    status,
    headers: { 'content-type': isJson ? 'application/json' : 'text/html', ...headers },
  })
}

function stubFetch(handler) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return handler(url, init)
  }
}

beforeEach(() => {
  calls = []
})

afterEach(() => {
  globalThis.fetch = realFetch
})

test('GET and POST both send the JSON Content-Type and Accept headers', async () => {
  stubFetch(() => respond(200, { ok: true }))
  await getJson('/api/summary')
  await request('/api/products', { method: 'POST', body: { sku: 'TEST-01' } })
  for (const { init } of calls) {
    assert.equal(init.headers['Content-Type'], 'application/json')
    assert.equal(init.headers.Accept, 'application/json')
  }
  assert.equal(calls[0].init.body, undefined)
  assert.equal(calls[1].init.body, '{"sku":"TEST-01"}')
})

test('204 → null without reading JSON', async () => {
  stubFetch(() => respond(204, null))
  assert.equal(await request('/api/movements/7', { method: 'DELETE' }), null)
})

test('422 with a list detail → ApiError with fieldErrors.sku', async () => {
  stubFetch(() =>
    respond(422, { detail: [{ loc: ['body', 'sku'], msg: 'String should match pattern', type: 'string_pattern_mismatch' }] }),
  )
  await assert.rejects(request('/api/products', { method: 'POST', body: {} }), (error) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.status, 422)
    assert.equal(error.fieldErrors.sku, 'String should match pattern')
    return true
  })
})

test('422 with a string detail → message; 409 → status 409', async () => {
  stubFetch(() => respond(422, { detail: 'Insufficient stock: on hand 5, requested 20' }))
  await assert.rejects(getJson('/api/movements'), { status: 422, message: 'Insufficient stock: on hand 5, requested 20' })
  stubFetch(() => respond(409, { detail: 'SKU already exists' }))
  await assert.rejects(request('/api/products', { method: 'POST', body: {} }), { status: 409, message: 'SKU already exists' })
})

test("502 marks the API 'down', then a 200 marks it 'up' again", async () => {
  stubFetch(() => respond(502, { detail: 'API unavailable' }))
  await assert.rejects(getJson('/api/summary'), { status: 502, message: 'API unavailable' })
  assert.equal(getApiStatus(), 'down')
  stubFetch(() => respond(200, []))
  await getJson('/api/summary')
  assert.equal(getApiStatus(), 'up')
})

test("the planner's 503 with Retry-After is busy, not down", async () => {
  stubFetch(() => respond(503, { detail: 'Planner busy, retry' }, { 'retry-after': '5' }))
  await assert.rejects(getJson('/api/reorder-plan?service_level=95&horizon_days=30'), {
    status: 503,
    message: 'Planner busy, retry',
  })
  assert.equal(getApiStatus(), 'up')
})

test("a network TypeError → ApiError status 0 and the API is 'down'", async () => {
  stubFetch(() => {
    throw new TypeError('fetch failed')
  })
  await assert.rejects(getJson('/api/version'), { name: 'ApiError', status: 0, message: "Can't reach the API" })
  assert.equal(getApiStatus(), 'down')
})

test('a timeout → status 0, while a caller abort is re-thrown untouched', async () => {
  stubFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))),
  )
  await assert.rejects(getJson('/api/reorder-plan', { timeoutMs: 5 }), { status: 0 })

  const controller = new AbortController()
  const pending = getJson('/api/products', { signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})

test('path builders omit empty params and keep a stable order', () => {
  assert.equal(paths.products({ q: 'pen' }), '/api/products?q=pen&limit=100')
  assert.equal(paths.products({ q: '  ', category: '', belowReorder: false }), '/api/products?limit=100')
  assert.equal(
    paths.products({ q: 'pen', category: 'STATIONERY', belowReorder: true, limit: 8 }),
    '/api/products?q=pen&category=STATIONERY&below_reorder=true&limit=8',
  )
  assert.equal(paths.movements({ offset: 50 }), '/api/movements?limit=50&offset=50')
  assert.equal(paths.movements({ productId: 4, kind: 'OUT' }), '/api/movements?product_id=4&kind=OUT&limit=50')
  assert.equal(paths.reorderPlan({ serviceLevel: 95, horizonDays: 30, surgePct: 0 }), '/api/reorder-plan?service_level=95&horizon_days=30')
})

test('recordMovement without a note omits the key', async () => {
  stubFetch(() => respond(201, { id: 1, on_hand: 140 }))
  await recordMovement({ productId: 3, kind: 'OUT', quantity: 20, note: '   ' })
  assert.deepEqual(JSON.parse(calls[0].init.body), { product_id: 3, kind: 'OUT', quantity: 20 })
  await recordMovement({ productId: 3, kind: 'IN', quantity: 5, note: ' delivery ' })
  assert.deepEqual(JSON.parse(calls[1].init.body), { product_id: 3, kind: 'IN', quantity: 5, note: 'delivery' })
})

test('updateProduct never sends null values', async () => {
  stubFetch(() => respond(200, { id: 3 }))
  await updateProduct(3, { name: 'New name', reorder_point: null })
  assert.equal(calls[0].init.method, 'PUT')
  assert.deepEqual(JSON.parse(calls[0].init.body), { name: 'New name' })
})
