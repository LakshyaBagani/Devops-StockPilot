import { createContext, useContext } from 'react'

// show({message, tone: 'ok' | 'error' | 'info', action?: {label, onClick}, ms?})
export const ToastContext = createContext({ show: () => {} })

export function useToast() {
  return useContext(ToastContext)
}
