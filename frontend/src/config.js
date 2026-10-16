// Every UI constant lives here. The live demo edits only this file (one preset line + the subtitle).

export const APP_NAME = 'StockPilot'
export const APP_SUBTITLE = 'Diwali stock check 2026'

export const SURGE_PRESETS = [
  { label: 'No surge', pct: 0 },
  { label: '+20%', pct: 20 },
  { label: 'Diwali rush +40%', pct: 40 },
]

export const SERVICE_LEVEL = { min: 80, max: 99, step: 1, default: 95 }
export const HORIZONS = [14, 30, 60]
export const DEFAULT_HORIZON = 30

// The backend's category enum, in display order.
export const CATEGORIES = [
  { value: 'STATIONERY', label: 'Stationery' },
  { value: 'ELECTRONICS', label: 'Electronics' },
  { value: 'GROCERY', label: 'Grocery' },
  { value: 'PERSONAL_CARE', label: 'Personal care' },
  { value: 'HOUSEHOLD', label: 'Household' },
  { value: 'OTHER', label: 'Other' },
]

export const UNITS = ['pcs', 'box', 'pack', 'kg', 'litre']

export const KINDS = {
  IN: 'Delivery received',
  OUT: 'Sale or dispatch',
  ADJUST: 'Stock-count correction',
}

export const PAGE_SIZE = { products: 100, movements: 50, picker: 8 }
// The planner waits longer than the backend's 30 s bulkhead queue (PLANNER_QUEUE_TIMEOUT_S), so a
// saturated planner's 503 'Planner busy, retry' arrives before the browser gives up.
export const TIMEOUT_MS = { default: 10_000, planner: 45_000 }

// Backend bounds mirrored for client-side validation (the server stays the authority).
export const LIMITS = {
  search: 50,
  quantity: 100_000,
  noteLength: 120,
  nameLength: 120,
  unitCostPaise: 100_000_000,
  reorderPoint: 1_000_000,
  leadTime: { min: 1, max: 60 },
}

export function categoryLabel(value) {
  return CATEGORIES.find((category) => category.value === value)?.label ?? value
}
