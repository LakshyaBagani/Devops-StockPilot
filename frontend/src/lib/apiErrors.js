// Turns an error response into {message, fieldErrors, code}. FastAPI sends `detail` as a string
// (business errors) or as a list of {loc, msg, type} (validation); nginx and proxies send HTML or text.

const LOCATION_PARTS = new Set(['body', 'query', 'path', 'header', 'cookie'])

const STATUS_MESSAGES = {
  0: "Can't reach the API",
  404: 'Not found',
  409: 'Conflict',
  502: 'API unavailable',
  503: 'API unavailable',
  504: 'API unavailable',
}

export function statusMessage(status) {
  return STATUS_MESSAGES[status] ?? `HTTP ${status}`
}

function fieldOf(loc) {
  if (!Array.isArray(loc)) return null
  const names = loc.filter((part) => typeof part === 'string' && !LOCATION_PARTS.has(part))
  return names.at(-1) ?? null
}

// Pydantic prefixes errors raised in validators with 'Value error, '.
function cleanMessage(msg) {
  return String(msg ?? '').replace(/^Value error, /, '')
}

export function parseApiError(status, payload) {
  const detail = payload !== null && typeof payload === 'object' ? payload.detail : undefined

  if (typeof detail === 'string') return { message: detail, fieldErrors: {}, code: null }

  if (Array.isArray(detail)) {
    const fieldErrors = {}
    for (const item of detail) {
      const field = fieldOf(item?.loc)
      if (field && !(field in fieldErrors)) fieldErrors[field] = cleanMessage(item.msg)
    }
    const message = detail.map((item) => cleanMessage(item?.msg)).filter(Boolean).join('; ')
    return { message: message || statusMessage(status), fieldErrors, code: null }
  }

  if (detail !== null && typeof detail === 'object') {
    return {
      message: typeof detail.message === 'string' ? detail.message : statusMessage(status),
      fieldErrors: {},
      code: detail.code ?? null,
    }
  }

  return { message: statusMessage(status), fieldErrors: {}, code: null }
}
