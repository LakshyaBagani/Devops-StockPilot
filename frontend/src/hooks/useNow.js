import { useSyncExternalStore } from 'react'

// One shared clock for relative times and day groups, so render never calls Date.now().
const TICK_MS = 30_000

let now = Date.now()
let timer = null
const listeners = new Set()

function tick() {
  now = Date.now()
  for (const listener of listeners) listener()
}

function subscribe(listener) {
  listeners.add(listener)
  if (timer === null) {
    now = Date.now()
    timer = setInterval(tick, TICK_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      clearInterval(timer)
      timer = null
    }
  }
}

function getSnapshot() {
  return now
}

export function useNow() {
  return useSyncExternalStore(subscribe, getSnapshot)
}
