import { useEffect } from 'react'

import { getJson, paths } from '../api.js'
import { useApiStatus } from '../hooks/useApiStatus.js'

const PING_MS = 5000

function ping(signal) {
  // Success flips the status store back to 'up', which hides this banner; failures are expected.
  getJson(paths.version(), { signal, timeoutMs: PING_MS - 1000 }).catch(() => {})
}

export function ApiBanner() {
  const status = useApiStatus()

  useEffect(() => {
    if (status !== 'down') return undefined
    const controller = new AbortController()
    const timer = setInterval(() => ping(controller.signal), PING_MS)
    return () => {
      clearInterval(timer)
      controller.abort()
    }
  }, [status])

  // The live region stays mounted so screen readers announce the banner when it appears.
  return (
    <div className="api-banner-region" role="status">
      {status === 'down' && (
        <div className="api-banner">
          <p>Can&rsquo;t reach the StockPilot API — showing the last data loaded.</p>
          <button type="button" className="btn btn-small" onClick={() => ping()}>
            Retry
          </button>
        </div>
      )}
    </div>
  )
}
