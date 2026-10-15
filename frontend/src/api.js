// The single fetch wrapper, the API status store, path builders and mutations.
// Every call is a same-origin /api path: the Vite proxy in dev, nginx in compose, the Ingress in K8s.
// It reads neither Vite's build-time env nor the DOM, so node:test can import it.

import { PAGE_SIZE, TIMEOUT_MS } from './config.js'
import { parseApiError, statusMessage } from './lib/apiErrors.js'
import { buildPlanQuery } from './lib/planner.js'

// FastAPI ≥ 0.132 rejects JSON bodies sent without this content type.
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' }
const OUTAGE_STATUSES = new Set([502, 503, 504])

export class ApiError extends Error {
  constructor({ status, message, code = null, fieldErrors = {}, detail = null, method, path }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fieldErrors = fieldErrors
    this.detail = detail
    this.method = method
    this.path = path
  }
}

// --- API status store (read with useSyncExternalStore) ---

let apiStatus = 'up'
const statusListeners = new Set()

export function getApiStatus() {
  return apiStatus
}

export function subscribeApiStatus(listener) {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

function setApiStatus(next) {
  if (next === apiStatus) return
  apiStatus = next
  for (const listener of statusListeners) listener()
}

// The planner's bulkhead answers 503 with Retry-After: busy, but reachable.
function isOutage(res) {
  return OUTAGE_STATUSES.has(res.status) && !(res.status === 503 && res.headers.has('retry-after'))
}

// --- requests ---

function parseBody(res, text) {
  if (res.status === 204) return null
  if (!(res.headers.get('content-type') ?? '').includes('json')) return text
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function request(path, { method = 'GET', body, signal, timeoutMs = TIMEOUT_MS.default } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs)
  let res
  let text
  try {
    res = await fetch(path, {
      method,
      headers: JSON_HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    text = await res.text()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    // A network failure (TypeError) or our own timeout.
    setApiStatus('down')
    const message =
      error?.name === 'TimeoutError' ? 'The API took too long to answer' : statusMessage(0)
    throw new ApiError({ status: 0, message, method, path })
  }

  setApiStatus(isOutage(res) ? 'down' : 'up')
  const payload = parseBody(res, text)
  if (!res.ok) {
    const { message, fieldErrors, code } = parseApiError(res.status, payload)
    throw new ApiError({ status: res.status, message, code, fieldErrors, detail: payload, method, path })
  }
  return payload
}

export function getJson(path, { signal, timeoutMs } = {}) {
  return request(path, { signal, timeoutMs })
}

export function asList(json) {
  if (Array.isArray(json)) return json
  return Array.isArray(json?.items) ? json.items : []
}

// --- path builders: §2.4 parameter names, stable order, empty values dropped ---

function withParams(base, params) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '' && value !== false) {
      search.set(key, String(value))
    }
  }
  const text = search.toString()
  return text ? `${base}?${text}` : base
}

export const paths = {
  products: ({
    q,
    category,
    belowReorder = false,
    includeDiscontinued = false,
    limit = PAGE_SIZE.products,
    offset = 0,
  } = {}) =>
    withParams('/api/products', {
      q: q?.trim(),
      category,
      below_reorder: belowReorder,
      include_discontinued: includeDiscontinued,
      limit,
      offset: offset || null,
    }),
  product: (id) => `/api/products/${id}`,
  movements: ({ productId, kind, limit = PAGE_SIZE.movements, offset = 0 } = {}) =>
    withParams('/api/movements', { product_id: productId, kind, limit, offset: offset || null }),
  movement: (id) => `/api/movements/${id}`,
  summary: () => '/api/summary',
  reorderPlan: (params) => `/api/reorder-plan?${buildPlanQuery(params)}`,
  version: () => '/api/version',
}

// --- mutations ---

export function createProduct(body) {
  return request('/api/products', { method: 'POST', body })
}

// Sends the changed keys only and never null: the backend rejects an explicit null with 422.
export function updateProduct(id, patch) {
  const body = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== null && value !== undefined),
  )
  return request(paths.product(id), { method: 'PUT', body })
}

export function deleteProduct(id) {
  return request(paths.product(id), { method: 'DELETE' })
}

export function recordMovement({ productId, kind, quantity, note }) {
  const body = { product_id: productId, kind, quantity }
  const trimmed = note?.trim()
  if (trimmed) body.note = trimmed
  return request('/api/movements', { method: 'POST', body })
}

export function undoMovement(id) {
  return request(paths.movement(id), { method: 'DELETE' })
}
