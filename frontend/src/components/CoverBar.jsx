import { coverAria, coverFill, coverLabel, coverLevel } from '../lib/cover.js'

const ANIMATED_ROWS = 10

// Days-of-cover bar: the track spans 0..3× lead time with ticks at 1× and 2×. The fill and the
// stagger index go through the style prop (CSSOM), which CSP style-src 'self' allows.
export function CoverBar({ daysOfCover, leadTimeDays, onHand, index = ANIMATED_ROWS }) {
  const max = 3 * leadTimeDays
  const level = coverLevel(daysOfCover, leadTimeDays)
  const animated = index < ANIMATED_ROWS
  // With no demand there is no value to measure, so it is a labelled image, not a meter.
  const semantics =
    daysOfCover == null
      ? { role: 'img', 'aria-label': `Days of cover: ${coverAria(daysOfCover, leadTimeDays)}` }
      : {
          role: 'meter',
          'aria-label': 'Days of cover',
          'aria-valuemin': 0,
          'aria-valuemax': max,
          'aria-valuenow': Math.min(daysOfCover, max),
          'aria-valuetext': coverAria(daysOfCover, leadTimeDays),
        }
  return (
    <div className="cover" {...semantics}>
      <span className="cover-track" data-level={level}>
        <span
          className="cover-fill"
          data-level={level}
          data-animated={animated || undefined}
          style={{ '--fill': coverFill(daysOfCover, leadTimeDays), '--i': animated ? index : 0 }}
        />
      </span>
      <span className="cover-label num">{coverLabel(daysOfCover, onHand)}</span>
    </div>
  )
}
