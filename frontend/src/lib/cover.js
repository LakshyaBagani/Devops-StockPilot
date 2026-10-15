// Days-of-cover bar logic. JSON has no infinity: days_of_cover null means no OUT demand in 30 days.
// The track spans 0..3L, with ticks at the lead time L and at 2L.

const LEVEL_WORDS = { red: 'short', amber: 'watch', green: 'healthy', none: 'no demand' }

export function coverLevel(daysOfCover, leadTime) {
  if (daysOfCover == null) return 'none'
  if (daysOfCover < leadTime) return 'red'
  if (daysOfCover < 2 * leadTime) return 'amber'
  return 'green'
}

export function coverFill(daysOfCover, leadTime) {
  if (daysOfCover == null) return 0
  return Math.min(1, Math.max(0, daysOfCover / (3 * leadTime)))
}

export function coverLabel(daysOfCover, onHand) {
  if (onHand <= 0) return 'out'
  if (daysOfCover == null) return 'no demand'
  if (daysOfCover < 1) return '<1 d'
  if (daysOfCover >= 365) return '365+ d'
  return `${Math.floor(daysOfCover)} d`
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export function coverAria(daysOfCover, leadTime) {
  const lead = `lead time ${plural(leadTime, 'day')}`
  const level = coverLevel(daysOfCover, leadTime)
  if (level === 'none') return `No demand in 30 days, ${lead}`
  const cover = daysOfCover < 1 ? 'Under 1 day' : plural(Math.floor(daysOfCover), 'day')
  return `${cover} of cover, ${lead}, ${LEVEL_WORDS[level]}`
}

// The REORDER flag: the same ≤ rule as the summary's at/below count and the below_reorder filter.
export function needsReorder(onHand, reorderPoint) {
  return onHand <= reorderPoint
}
