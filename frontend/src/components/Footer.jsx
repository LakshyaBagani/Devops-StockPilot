import { useEffect } from 'react'

import { paths } from '../api.js'
import { APP_NAME, APP_SUBTITLE } from '../config.js'
import { useApiGet } from '../hooks/useApiGet.js'
import { useApiStatus } from '../hooks/useApiStatus.js'

// Baked in at build time from the VITE_GIT_SHA build arg; it cannot change at runtime. The full
// SHA stays in the tooltip, so the bundle can be matched to its commit.
const UI_BUILD = import.meta.env.VITE_GIT_SHA || 'dev'
const UI_SHA = UI_BUILD.slice(0, 7)
const REAL_SHA = /^[0-9a-f]{7}$/i

export function Footer() {
  const status = useApiStatus()
  // Keyed on the status, so the API SHA is refetched as soon as the API comes back.
  const { data, error, reload } = useApiGet(paths.version(), { version: status })

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') reload()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [reload])

  const apiSha = status === 'up' && data ? String(data.git_sha).slice(0, 7) : null
  const apiLabel = apiSha ?? (status === 'down' || error ? '—' : '…')
  const apiBuild = data ? `API v${data.version}, commit ${data.git_sha}, built ${data.build_time}` : undefined
  const skew = apiSha !== null && REAL_SHA.test(UI_SHA) && REAL_SHA.test(apiSha) && apiSha !== UI_SHA

  // The shop's line (config.js, changed by the live demo) and the printer's imprint: both builds.
  return (
    <footer className="sp-footer">
      <div className="sp-frame sp-footer-row">
        <p>{APP_SUBTITLE}</p>
        <p className="num">
          {APP_NAME} v{__APP_VERSION__} · <span title={`UI commit ${UI_BUILD}`}>ui {UI_SHA}</span> ·{' '}
          <span title={apiBuild}>api {apiLabel}</span>
          {skew && (
            <span
              className="sp-skew"
              title={`UI ${UI_SHA} and API ${apiSha} differ: a rolling update is in progress or one image was not redeployed. ${apiBuild}.`}
            >
              builds differ
            </span>
          )}
        </p>
      </div>
    </footer>
  )
}
