import { useCallback, useEffect, useState } from 'react'

import { getJson } from '../api.js'

// Loads `path` and refetches whenever the key (path + version + reload nonce) changes.
// State is set only in the promise callbacks, and `loading` is derived from the key, which keeps
// the hook clean under the React Compiler lint rules. The previous data stays visible while a
// refetch runs (stale-while-revalidate). A null path means idle.
export function useApiGet(path, { version = 0, enabled = true, timeoutMs } = {}) {
  const [nonce, setNonce] = useState(0)
  const [result, setResult] = useState({ key: null, data: undefined, error: null, elapsedMs: null })
  const key = enabled && path ? `${path}|${version}|${nonce}` : null

  useEffect(() => {
    if (key === null) return undefined
    const controller = new AbortController()
    const started = performance.now()
    getJson(path, { signal: controller.signal, timeoutMs }).then(
      (data) => setResult({ key, data, error: null, elapsedMs: performance.now() - started }),
      (error) => {
        // StrictMode runs effects twice in dev, and a superseded request is aborted: neither is an error.
        if (error.name === 'AbortError') return
        setResult((previous) => ({ ...previous, key, error }))
      },
    )
    return () => controller.abort()
  }, [key, path, timeoutMs])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  return {
    data: key === null ? undefined : result.data,
    error: key === null ? null : result.error,
    loading: key !== null && result.key !== key,
    elapsedMs: result.elapsedMs,
    reload,
  }
}
