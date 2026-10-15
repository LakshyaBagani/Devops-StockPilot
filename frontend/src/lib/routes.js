// Route table for the History-API router. Only positive-integer ids match.

const ID = '([1-9][0-9]*)'

export const ROUTES = [
  { name: 'stock', pattern: /^\/$/ },
  { name: 'record', pattern: /^\/record$/ },
  { name: 'ledger', pattern: /^\/ledger$/ },
  { name: 'planner', pattern: /^\/planner$/ },
  { name: 'products', pattern: /^\/products$/ },
  { name: 'productNew', pattern: /^\/products\/new$/ },
  { name: 'productDetail', pattern: new RegExp(`^/products/${ID}$`) },
  { name: 'productEdit', pattern: new RegExp(`^/products/${ID}/edit$`) },
]

export function matchRoute(pathname) {
  let path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/index.html') path = '/'
  for (const route of ROUTES) {
    const match = route.pattern.exec(path)
    if (match) return { name: route.name, params: match[1] ? { id: Number(match[1]) } : {} }
  }
  return { name: 'notFound', params: {} }
}

const TABS = {
  stock: 'stock',
  ledger: 'ledger',
  planner: 'planner',
  products: 'products',
  productNew: 'products',
  productDetail: 'products',
  productEdit: 'products',
}

export function tabFor(routeName) {
  return TABS[routeName] ?? null
}

// Applies a patch to a query string. null, undefined and '' delete the key.
export function withQuery(search, patch) {
  const params = new URLSearchParams(search)
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === '') params.delete(key)
    else params.set(key, String(value))
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}
