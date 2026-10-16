import { useEffect } from 'react'

import { getJson, paths } from '../api.js'
import { useApiStatus } from '../hooks/useApiStatus.js'
import { Icon } from './Icon.jsx'

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
    <div className="sp-frame" role="status">
      {status === 'down' && (
        <div className="sp-api-banner">
          <Icon name="alert" size={20} />
          <p>Can&rsquo;t reach the StockPilot API — showing the last data loaded.</p>
          <button type="button" className="sp-btn sp-btn-small" onClick={() => ping()}>
            Retry
          </button>
        </div>
      )}
    </div>
  )
}
