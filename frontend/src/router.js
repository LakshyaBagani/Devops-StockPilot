// A tiny History-API router: the location is an external store read with useSyncExternalStore.

import { useMemo, useSyncExternalStore } from 'react'

import { withQuery } from './lib/routes.js'

const listeners = new Set()

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener) {
  listeners.add(listener)
  if (listeners.size === 1) window.addEventListener('popstate', notify)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('popstate', notify)
  }
}

// A primitive snapshot, so React can compare it cheaply and never loops.
function getSnapshot() {
  return window.location.pathname + window.location.search
}

export function useLocation() {
  const href = useSyncExternalStore(subscribe, getSnapshot)
  return useMemo(() => {
    const url = new URL(href, window.location.origin)
    return { pathname: url.pathname, search: url.search, query: url.searchParams }
  }, [href])
}

// A replace keeps the entry's state (e.g. the sheet marker) unless a new one is given.
// Only a push to another page scrolls to the top.
export function navigate(to, { replace = false, state } = {}) {
  const url = new URL(to, window.location.href)
  const samePage = url.pathname === window.location.pathname
  if (replace) window.history.replaceState(state ?? window.history.state, '', url)
  else window.history.pushState(state ?? null, '', url)
  notify()
  if (!replace && !samePage) window.scrollTo(0, 0)
}

export function setQuery(patch, { replace = true } = {}) {
  navigate(window.location.pathname + withQuery(window.location.search, patch), { replace })
}

// The record sheet lives in the URL (?sheet=record&product=&kind=). Opening it pushes an entry
// marked sheetPushed, so Back (including the Android back gesture) closes it.
const SHEET_PARAMS = { sheet: null, product: null, kind: null }

export function openRecordSheet({ product, kind } = {}) {
  const search = withQuery(window.location.search, { ...SHEET_PARAMS, sheet: 'record', product, kind })
  navigate(window.location.pathname + search, { state: { sheetPushed: true } })
}

// Esc, the close button and a native dialog close can all fire for one close; going back twice
// would leave the app, so ignore repeats until the popstate lands.
let sheetClosing = false

export function closeRecordSheet() {
  if (sheetClosing || !new URLSearchParams(window.location.search).has('sheet')) return
  if (window.history.state?.sheetPushed) {
    sheetClosing = true
    window.addEventListener('popstate', () => (sheetClosing = false), { once: true })
    window.history.back()
  } else {
    setQuery(SHEET_PARAMS)
  }
}
