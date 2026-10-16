// Cover runway logic. JSON has no infinity: days_of_cover null means no OUT demand in 30 days.
// The runway spans 0..3L, where L is the lead time (shown as "delivery"): the delivery marker sits
// at L and a tick at 2L. Short under L, watch under 2L, healthy from 2L.

const LEVEL_WORDS = { red: 'short', amber: 'watch', green: 'healthy', none: 'no demand' }

export function coverLevel(daysOfCover, leadTime) {
  if (daysOfCover == null) return 'none'
  if (daysOfCover < leadTime) return 'red'
  if (daysOfCover < 2 * leadTime) return 'amber'
  return 'green'
}

// The runway's state: as coverLevel, except that nothing on hand is always short, demand or not.
export function runwayLevel(daysOfCover, leadTime, onHand) {
  return onHand <= 0 ? 'red' : coverLevel(daysOfCover, leadTime)
}

export function coverFill(daysOfCover, leadTime) {
  if (daysOfCover == null) return 0
  return Math.min(1, Math.max(0, daysOfCover / (3 * leadTime)))
}

// Past the runway's end (3L) the fill runs off it, so 40 days and 400 days never look equal to 21.
export function coverBeyond(daysOfCover, leadTime) {
  return daysOfCover != null && daysOfCover > 3 * leadTime
}

// The figure in "32 d cover": whole days, '<1' under a day, '365+' from a year; null without demand.
export function coverFigure(daysOfCover) {
  if (daysOfCover == null) return null
  if (daysOfCover < 1) return '<1'
  if (daysOfCover >= 365) return '365+'
  return String(Math.floor(daysOfCover))
}

export function coverLabel(daysOfCover, onHand) {
  if (onHand <= 0) return 'out'
  const figure = coverFigure(daysOfCover)
  return figure === null ? 'no demand' : `${figure} d`
}

// The cover half of the runway caption ("32 d cover · 7 d delivery"), split so the figure can be
// set in the number face: { figure: '32', words: 'd cover' }, or a figure of null for the states
// that have none: 'Out of stock' and 'No demand'.
export function coverPhrase(daysOfCover, onHand) {
  if (onHand <= 0) return { figure: null, words: 'Out of stock' }
  const figure = coverFigure(daysOfCover)
  return figure === null ? { figure: null, words: 'No demand' } : { figure, words: 'd cover' }
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// The runway's accessible value, in the caption's terms. onHand is optional: with nothing on hand
// it reads "Out of stock" first.
export function coverAria(daysOfCover, leadTime, onHand) {
  const delivery = `delivery takes ${plural(leadTime, 'day')}`
  if (onHand != null && onHand <= 0) return `Out of stock, ${delivery}`
  const level = coverLevel(daysOfCover, leadTime)
  if (level === 'none') return `No demand in 30 days, ${delivery}`
  const cover = daysOfCover < 1 ? 'Under 1 day' : plural(Math.floor(daysOfCover), 'day')
  return `${cover} of cover, ${delivery}, ${LEVEL_WORDS[level]}`
}

// The reorder flag: the same ≤ rule as the summary's need-reorder count and the below_reorder filter.
export function needsReorder(onHand, reorderPoint) {
  return onHand <= reorderPoint
}
