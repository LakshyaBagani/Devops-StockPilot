import { createContext, useContext } from 'react'

// `version` goes into every list's request key; notifyChanged() bumps it after any successful
// mutation. The server stays the authority for derived stock: there are no optimistic updates.
export const InventoryEventsContext = createContext({ version: 0, notifyChanged: () => {} })

export function useInventoryEvents() {
  return useContext(InventoryEventsContext)
}
