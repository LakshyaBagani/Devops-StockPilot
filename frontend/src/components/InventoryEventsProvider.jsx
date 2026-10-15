import { useCallback, useEffect, useMemo, useState } from 'react'

import { getApiStatus, subscribeApiStatus } from '../api.js'
import { InventoryEventsContext } from '../state/inventoryEvents.js'

export function InventoryEventsProvider({ children }) {
  const [version, setVersion] = useState(0)
  const notifyChanged = useCallback(() => setVersion((v) => v + 1), [])

  // When the API comes back, refetch every list so the screen stops showing stale data.
  useEffect(() => {
    let last = getApiStatus()
    return subscribeApiStatus(() => {
      const next = getApiStatus()
      if (last === 'down' && next === 'up') notifyChanged()
      last = next
    })
  }, [notifyChanged])

  const value = useMemo(() => ({ version, notifyChanged }), [version, notifyChanged])
  return <InventoryEventsContext value={value}>{children}</InventoryEventsContext>
}
