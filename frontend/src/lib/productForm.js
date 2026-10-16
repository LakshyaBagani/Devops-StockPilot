// Product form values (strings, as typed) ↔ API payloads, with client checks that mirror the
// backend schema. The server stays the authority; these only catch typos before a round trip.

import { CATEGORIES, LIMITS, UNITS } from '../config.js'
import { formatNumber, paiseToRupeesText, rupeesToPaise } from './format.js'

// The form's fields in screen order, which is also the order focus takes to the first invalid one.
export const FIELD_ORDER = ['name', 'sku', 'category', 'unit', 'unitCost', 'reorderPoint', 'leadTime']

export const EMPTY_PRODUCT = {
  sku: '',
  name: '',
  category: '',
  unit: 'pcs',
  unitCost: '',
  reorderPoint: '0',
  leadTime: '7',
}

// Form field → API field. Server-side 422 field errors map back through this.
export const API_FIELDS = {
  sku: 'sku',
  name: 'name',
  category: 'category',
  unit: 'unit',
  unitCost: 'unit_cost_paise',
  reorderPoint: 'reorder_point',
  leadTime: 'lead_time_days',
}

export const FORM_FIELDS = Object.fromEntries(
  Object.entries(API_FIELDS).map(([form, api]) => [api, form]),
)

const SKU_PATTERN = /^[A-Z0-9-]{3,20}$/
const WHOLE = /^[0-9]{1,9}$/

export function productToForm(product) {
  return {
    sku: product.sku,
    name: product.name,
    category: product.category,
    unit: product.unit,
    unitCost: paiseToRupeesText(product.unit_cost_paise),
    reorderPoint: String(product.reorder_point),
    leadTime: String(product.lead_time_days),
  }
}

function wholeNumber(text) {
  const trimmed = String(text).trim()
  return WHOLE.test(trimmed) ? Number(trimmed) : null
}

// Returns {errors, payload}; payload is the full API body when errors is empty.
export function validateProduct(values, { isNew }) {
  const errors = {}
  const payload = {}

  if (isNew) {
    const sku = values.sku.trim().toUpperCase()
    if (!SKU_PATTERN.test(sku)) errors.sku = 'Use 3–20 capital letters, digits or hyphens'
    payload.sku = sku
  }

  const name = values.name.trim()
  if (!name) errors.name = 'Enter a product name'
  else if (name.length > LIMITS.nameLength) errors.name = `At most ${LIMITS.nameLength} characters`
  payload.name = name

  if (!CATEGORIES.some((category) => category.value === values.category)) {
    errors.category = 'Choose a category'
  }
  payload.category = values.category

  if (!UNITS.includes(values.unit)) errors.unit = 'Choose a unit'
  payload.unit = values.unit

  const paise = rupeesToPaise(values.unitCost)
  if (paise === null) errors.unitCost = 'Enter rupees, e.g. 12.50'
  else if (paise <= 0) errors.unitCost = 'Must be more than ₹0'
  else if (paise > LIMITS.unitCostPaise) errors.unitCost = 'At most ₹10,00,000'
  payload.unit_cost_paise = paise

  const reorderPoint = wholeNumber(values.reorderPoint)
  if (reorderPoint === null || reorderPoint > LIMITS.reorderPoint) {
    errors.reorderPoint = 'Enter a whole number, 0 or more'
  }
  payload.reorder_point = reorderPoint

  const leadTime = wholeNumber(values.leadTime)
  const { min, max } = LIMITS.leadTime
  if (leadTime === null || leadTime < min || leadTime > max) {
    errors.leadTime = `Enter whole days from ${min} to ${max}`
  }
  payload.lead_time_days = leadTime

  return { errors, payload }
}

// The PUT body: only the fields whose value differs from the stored product. Never null.
export function changedFields(product, payload) {
  const patch = {}
  for (const [key, value] of Object.entries(payload)) {
    if (key !== 'sku' && value !== null && value !== product[key]) patch[key] = value
  }
  return patch
}

// Why Delete is unavailable, or null when it is available. Movements are never deleted, so a
// product with any history stays for the audit trail (the API answers 409 otherwise).
export function deleteBlockedReason(movementsCount) {
  if (!(movementsCount > 0)) return null
  const noun = movementsCount === 1 ? 'movement' : 'movements'
  return `Can’t delete: ${formatNumber(movementsCount)} ${noun} kept for audit`
}
