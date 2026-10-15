import { useSyncExternalStore } from 'react'

import { getApiStatus, subscribeApiStatus } from '../api.js'

// 'up' or 'down', from the status store that every request updates.
export function useApiStatus() {
  return useSyncExternalStore(subscribeApiStatus, getApiStatus)
}
