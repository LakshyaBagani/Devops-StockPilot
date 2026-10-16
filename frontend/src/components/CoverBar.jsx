import { coverAria, coverBeyond, coverFill, coverPhrase, runwayLevel } from '../lib/cover.js'

// The cover runway: a thin track spanning 0..3× the delivery time (the lead time), filled in the
// state's colour (short under 1×, watch under 2×, healthy from 2×). The delivery marker at 1× and
// the tick at 2× sit outside the fill, so the fill never hides them; past 3× the fill runs off the
// end. The caption carries the figures: "2 d cover · 5 d delivery".
//
// A meter's children are presentational, so the caption is read once, through aria-valuetext.
// `labelled` prints "delivery" over the marker (for a single runway; rows rely on the caption).
// The fill width goes through the style prop (CSSOM), which CSP style-src 'self' allows. Older
// callers may still pass `index`; there is no bar-growth animation any more, so it is ignored.
export function CoverBar({ daysOfCover, leadTimeDays, onHand, labelled = false }) {
  const level = runwayLevel(daysOfCover, leadTimeDays, onHand)
  const max = 3 * leadTimeDays
  const valueText = coverAria(daysOfCover, leadTimeDays, onHand)
  const { figure, words } = coverPhrase(daysOfCover, onHand)
  // With no demand there is no value to measure, so it is a labelled image, not a meter.
  const semantics =
    daysOfCover == null
      ? { role: 'img', 'aria-label': `Days of cover: ${valueText}` }
      : {
          role: 'meter',
          'aria-label': 'Days of cover',
          'aria-valuemin': 0,
          'aria-valuemax': max,
          'aria-valuenow': Math.min(Math.max(daysOfCover, 0), max),
          'aria-valuetext': valueText,
        }
  return (
    <div className="sp-cover" data-level={level} {...semantics}>
      <span className="sp-runway" data-labelled={labelled || undefined}>
        <span className="sp-runway-track">
          <span
            className="sp-runway-fill"
            data-beyond={coverBeyond(daysOfCover, leadTimeDays) || undefined}
            style={{ '--fill': onHand <= 0 ? 0 : coverFill(daysOfCover, leadTimeDays) }}
          />
        </span>
        <span className="sp-runway-tick" />
        <span className="sp-runway-delivery">{labelled && <span className="sp-runway-label">delivery</span>}</span>
      </span>
      <span className="sp-cover-caption">
        <span className="sp-cover-days">
          {figure === null ? (
            words
          ) : (
            <>
              <span className="num">{figure}</span> {words}
            </>
          )}
        </span>
        <span className="sp-cover-sep"> · </span>
        <span className="sp-cover-lead">
          <span className="num">{leadTimeDays}</span> d delivery
        </span>
      </span>
    </div>
  )
}
