import assert from 'node:assert/strict'
import { test } from 'node:test'

import { matchRoute, tabFor, withQuery } from './routes.js'

test('the 7 valid paths match their routes', () => {
  assert.deepEqual(matchRoute('/'), { name: 'stock', params: {} })
  assert.deepEqual(matchRoute('/ledger'), { name: 'ledger', params: {} })
  assert.deepEqual(matchRoute('/planner'), { name: 'planner', params: {} })
  assert.deepEqual(matchRoute('/products'), { name: 'products', params: {} })
  assert.deepEqual(matchRoute('/products/new'), { name: 'productNew', params: {} })
  assert.deepEqual(matchRoute('/products/3'), { name: 'productDetail', params: { id: 3 } })
  assert.deepEqual(matchRoute('/products/3/edit'), { name: 'productEdit', params: { id: 3 } })
})

test("'/products/abc', '/products/0' and '/nope' → notFound", () => {
  assert.equal(matchRoute('/products/abc').name, 'notFound')
  assert.equal(matchRoute('/products/0').name, 'notFound')
  assert.equal(matchRoute('/nope').name, 'notFound')
})

test("trailing slashes are tolerated, '/index.html' is stock and '/record' is the sheet alias", () => {
  assert.equal(matchRoute('/ledger/').name, 'ledger')
  assert.equal(matchRoute('/index.html').name, 'stock')
  assert.equal(matchRoute('/record').name, 'record')
})

test('tabFor maps product detail, new and edit to the products tab', () => {
  assert.equal(tabFor('productDetail'), 'products')
  assert.equal(tabFor('productNew'), 'products')
  assert.equal(tabFor('productEdit'), 'products')
  assert.equal(tabFor('notFound'), null)
})

test('withQuery sets keys and deletes null or empty ones', () => {
  assert.equal(withQuery('?q=pen', { category: 'GROCERY' }), '?q=pen&category=GROCERY')
  assert.equal(withQuery('?q=pen&below=1', { q: null, below: '' }), '')
  assert.equal(withQuery('', { sheet: 'record', product: 12, kind: undefined }), '?sheet=record&product=12')
})
