// Pure formatting and parsing. Money is integer paise end to end: nothing here multiplies
// or divides rupee floats.

export const MINUS = '−'

const GROUPED = new Intl.NumberFormat('en-IN')
const CLOCK = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const DAY = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
const DAY_WITH_YEAR = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
const RELATIVE = new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' })
const DAY_MS = 86_400_000

export function formatPaise(paise, { whole = false } = {}) {
  const sign = paise < 0 ? MINUS : ''
  const abs = Math.abs(paise)
  const rest = abs % 100
  const rupees = (abs - rest) / 100
  if (whole) return `${sign}₹${GROUPED.format(rest >= 50 ? rupees + 1 : rupees)}`
  return `${sign}₹${GROUPED.format(rupees)}.${String(rest).padStart(2, '0')}`
}

// '12.5' → 1250. Returns null for anything that is not a plain rupee amount with at most 2 decimals.
export function rupeesToPaise(text) {
  const match = /^([0-9]{1,7})(?:[.]([0-9]{1,2}))?$/.exec(String(text ?? '').trim())
  if (!match) return null
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
}

// The editable text for a stored price: 1250 → '12.50', 1200 → '12'.
export function paiseToRupeesText(paise) {
  const rest = paise % 100
  const rupees = (paise - rest) / 100
  return rest === 0 ? String(rupees) : `${rupees}.${String(rest).padStart(2, '0')}`
}

// A typed quantity: digits only, at most 6 of them; anything else is null.
export function parseQuantity(text) {
  return /^[0-9]{1,6}$/.test(text) ? Number(text) : null
}

export function formatNumber(n) {
  return GROUPED.format(n)
}

export function formatQty(n, unit) {
  return unit ? `${GROUPED.format(n)} ${unit}` : GROUPED.format(n)
}

export function formatDelta(delta) {
  if (delta > 0) return `+${GROUPED.format(delta)}`
  if (delta < 0) return `${MINUS}${GROUPED.format(-delta)}`
  return '0'
}

export function formatDays(days) {
  return days == null ? '—' : `${GROUPED.format(days)} d`
}

// SQLite hands back naive timestamps; treat them as UTC instead of local time (IST would shift 5h30).
export function parseApiDate(value) {
  const text = String(value)
  return new Date(/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text}Z`)
}

export function formatClock(date) {
  return CLOCK.format(date)
}

export function formatRelative(date, nowMs) {
  const seconds = Math.round((date.getTime() - nowMs) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 45) return RELATIVE.format(0, 'second')
  if (abs < 3600) return RELATIVE.format(Math.round(seconds / 60), 'minute')
  if (abs < DAY_MS / 1000) return RELATIVE.format(Math.round(seconds / 3600), 'hour')
  return RELATIVE.format(Math.round(seconds / (DAY_MS / 1000)), 'day')
}

function startOfLocalDay(ms) {
  const day = new Date(ms)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

export function dayGroupLabel(date, nowMs) {
  const daysAgo = Math.round((startOfLocalDay(nowMs) - startOfLocalDay(date.getTime())) / DAY_MS)
  if (daysAgo === 0) return 'Today'
  if (daysAgo === 1) return 'Yesterday'
  const sameYear = new Date(nowMs).getFullYear() === date.getFullYear()
  return (sameYear ? DAY : DAY_WITH_YEAR).format(date)
}
