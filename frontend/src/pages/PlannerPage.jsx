import { Fragment, useState } from 'react'

import { paths } from '../api.js'
import { Icon } from '../components/Icon.jsx'
import { Link } from '../components/Link.jsx'
import { RiskAxis, RiskBar } from '../components/RiskBar.jsx'
import { SegmentedControl } from '../components/SegmentedControl.jsx'
import { EmptyState, ErrorState, Skeleton } from '../components/StatusViews.jsx'
import { DEFAULT_HORIZON, HORIZONS, SERVICE_LEVEL, SURGE_PRESETS, TIMEOUT_MS } from '../config.js'
import { useApiGet } from '../hooks/useApiGet.js'
import { useDocumentTitle } from '../hooks/useDocumentTitle.js'
import { formatNumber } from '../lib/format.js'
import {
  NO_MEDIAN_STOCKOUT,
  VERDICTS,
  countVerdicts,
  formatMargin,
  formatPct,
  horizonWord,
  partJoiner,
  planLabel,
  planVerdict,
  sameScenario,
  scenarioLabel,
  spokenMargin,
  targetRisk,
  verdictParts,
  verdictSentence,
} from '../lib/planner.js'

const HORIZON_OPTIONS = HORIZONS.map((days) => ({ value: days, label: `${days} d` }))
// Presets come from config.js (the live demo adds one), so the control takes any number of them.
const SURGE_OPTIONS = SURGE_PRESETS.map((preset) => ({ value: preset.pct, label: preset.label }))
// Server text worth showing inline: bounds and work budget (422) or the busy bulkhead (503).
const INLINE_STATUSES = new Set([422, 503])
const TONE_CLASS = {
  danger: 'sp-tone-danger',
  warning: 'sp-tone-warning',
  success: 'sp-tone-success',
  quiet: 'sp-plan-quiet',
}

function planSummary(plan) {
  const target = formatPct(targetRisk(plan.service_level))
  return verdictParts(countVerdicts(plan.items, plan.service_level), { target })
}

// 'a · b · c' that wraps only after a dot, never before one or inside a part.
function DotJoined({ parts }) {
  return parts.map((part, index) => (
    <Fragment key={part}>
      {index > 0 && ' '}
      <span className="sp-plan-nowrap">
        {part}
        {index < parts.length - 1 && ' ·'}
      </span>
    </Fragment>
  ))
}

function NoValue() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="visually-hidden">none</span>
    </>
  )
}

// Product, then risk ± margin with its verdict and the chart, then the suggested order; the reorder
// point and the median stock-out day follow, quieter. A product without recent sales gets no
// suggestions at all rather than zeros that read as advice.
function PlanRow({ item, serviceLevel }) {
  const verdict = planVerdict(item, serviceLevel)
  const { label, tone } = VERDICTS[verdict]
  const idle = verdict === 'idle'
  const current = item.current_reorder_point
  const suggested = item.recommended_reorder_point
  const median = item.median_days_to_stockout
  return (
    <tr data-verdict={verdict}>
      <th scope="row" className="sp-plan-product">
        <Link to={`/products/${item.product_id}`} className="sp-plan-name">
          {item.name}
        </Link>
        <span className="sp-sku">{item.sku}</span>
      </th>
      <td className="sp-plan-risk">
        <span className="sp-plan-p num">{idle ? <NoValue /> : formatPct(item.stockout_risk)}</span>
        {/* A zero margin (no run, or every run, ran out) is no claim of certainty: leave it out. */}
        {!idle && item.risk_margin > 0 && (
          <>
            <span className="sp-plan-margin num" aria-hidden="true">
              {formatMargin(item.risk_margin)}
            </span>
            <span className="visually-hidden"> {spokenMargin(item.risk_margin)}, </span>
          </>
        )}
        <span className={`sp-plan-verdict ${TONE_CLASS[tone]}`}>{label}</span>
      </td>
      <td className="sp-plan-chart">
        <RiskBar p={item.stockout_risk} margin={item.risk_margin} serviceLevel={serviceLevel} verdict={verdict} />
      </td>
      <td className="sp-plan-order num" data-label="Order">
        {idle ? (
          <>
            <NoValue />
            <span className="sp-unit sp-unit-slot" />
          </>
        ) : (
          <>
            {formatNumber(item.suggested_order_qty)}
            <span className="sp-unit sp-unit-slot">{item.unit}</span>
          </>
        )}
      </td>
      <td className="sp-plan-rop num" data-label="Reorder point">
        {idle ? (
          <NoValue />
        ) : (
          <>
            <span className="sp-plan-now">{formatNumber(current)}</span>
            <span className="visually-hidden"> now, suggested </span>
            <Icon name="arrow" size={14} />
            <span className={suggested > current ? 'sp-plan-raise' : undefined}>{formatNumber(suggested)}</span>
          </>
        )}
      </td>
      <td className="sp-plan-median num" data-label="Median stock-out">
        {idle && <NoValue />}
        {!idle && median == null && <span className="sp-plan-quiet">{NO_MEDIAN_STOCKOUT}</span>}
        {!idle && median != null && (
          <>
            <span aria-hidden="true">
              {formatNumber(median)}
              <span className="sp-unit">d</span>
            </span>
            <span className="visually-hidden">{formatNumber(median)} days</span>
          </>
        )}
      </td>
    </tr>
  )
}

// The plan on screen, always labelled with the parameters the server echoed back: a re-run keeps
// it visible (dimmed) until the new one lands, and changed controls never relabel it. One notice
// line says which: a re-run in progress, or controls that no longer match this plan.
function PlanResults({ result, plan, controls, pending, reveal }) {
  const serviceLevel = result.service_level
  const horizon = result.horizon_days
  const parts = planSummary(result)
  let notice = null
  if (pending) {
    notice = <p className="sp-note sp-note-info sp-plan-notice">{pending}</p>
  } else if (!sameScenario(controls, result)) {
    notice = (
      <p className="sp-note sp-note-warning sp-plan-notice">
        The controls have changed since this plan ran. Run the simulation to update it.
      </p>
    )
  }
  return (
    <section className="sp-plan-results" aria-labelledby="planner-plan-title">
      <div className="sp-plan-head">
        <h2 id="planner-plan-title" className="sp-section-title">
          Reorder plan
        </h2>
        <p className="sp-meta">{planLabel(result)}</p>
      </div>
      <p className="sp-plan-summary">
        {parts.map((part, index) => (
          <Fragment key={part.verdict}>
            {index > 0 && partJoiner(index, parts.length)}
            <span className={TONE_CLASS[VERDICTS[part.verdict].tone]}>{part.text}</span>
          </Fragment>
        ))}
        .
      </p>
      {notice}
      <p className="sp-hint sp-plan-key">
        Stock-out risk is the chance of running out within {horizon} days, ± a margin in percentage points.
      </p>
      <RiskAxis serviceLevel={serviceLevel} className="sp-plan-axis-stacked" />
      <div className="sp-table-scroll sp-plan-scroll" data-refreshing={plan.loading || undefined}>
        <table className="sp-table sp-plan" aria-busy={plan.loading || undefined}>
          <caption className="visually-hidden">Reorder plan, highest stock-out risk first</caption>
          <thead>
            <tr>
              <th scope="col" className="sp-plan-product">
                Product
              </th>
              <th scope="col">Stock-out risk</th>
              <th scope="col" className="sp-plan-chart">
                <span className="visually-hidden">Range against the target</span>
                <RiskAxis serviceLevel={serviceLevel} />
              </th>
              <th scope="col" className="sp-num-col">
                Suggested order
              </th>
              <th scope="col" className="sp-num-col">
                Reorder point
              </th>
              <th scope="col" className="sp-num-col">
                Median stock-out
              </th>
            </tr>
          </thead>
          <tbody className={reveal ? 'sp-reveal-rows' : undefined}>
            {result.items.map((item) => (
              <PlanRow key={item.product_id} item={item} serviceLevel={serviceLevel} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="sp-plan-method">
        <p className="num">
          <DotJoined
            parts={[
              `${formatNumber(result.items.length)} products`,
              `from ${formatNumber(result.scenarios)} simulated ${horizonWord(horizon)}`,
              ...(plan.elapsedMs === null ? [] : [`${(plan.elapsedMs / 1000).toFixed(2)} s`]),
            ]}
          />
        </p>
        <p>
          Each run plays {horizon} days forward, drawing every day&rsquo;s sales at random from the last 60 days and a
          random supplier delay. Stock-out risk is the share of runs that ran out; its ± is the 95% margin in
          percentage points, so 23% ± 3 means between 20% and 26%. The suggested reorder point covers lead-time demand
          in {serviceLevel}% of runs, and the order covers {horizon} days of average demand
          {result.surge_pct > 0 && ` with the +${result.surge_pct}% surge`}. The median stock-out is the day by which
          half the runs had run out.
        </p>
      </div>
    </section>
  )
}

export function PlannerPage() {
  useDocumentTitle('Planner')
  const [serviceLevel, setServiceLevel] = useState(SERVICE_LEVEL.default)
  const [horizonDays, setHorizonDays] = useState(DEFAULT_HORIZON)
  const [surgePct, setSurgePct] = useState(0)
  // Each click is a new run id: a re-run aborts the previous request, so two never overlap.
  const [run, setRun] = useState(null)
  const plan = useApiGet(run?.path ?? null, { version: run?.id ?? 0, timeoutMs: TIMEOUT_MS.planner })
  // Phones fold the controls into a one-line scenario once a plan arrives. Reopening them holds
  // for that plan only, so the next plan to land folds them again (derived, no effect).
  const [openFor, setOpenFor] = useState(null)

  const controls = { serviceLevel, horizonDays, surgePct }
  const result = plan.data
  const pending = plan.loading ? `Simulating ${run.params.horizonDays} days of demand for every product…` : null
  const collapsed = Boolean(result) && openFor !== result
  // A failed re-run is also shown inline, because the previous plan stays on screen. A new run
  // replaces the note with its own progress until it settles.
  const inlineError = plan.error && (INLINE_STATUSES.has(plan.error.status) || result) ? plan.error : null
  const failure =
    inlineError && !plan.loading && `Couldn’t run the simulation: ${inlineError.message.replace(/[.\s]+$/, '')}.`

  function handleRun(event) {
    event.preventDefault()
    const params = { serviceLevel, horizonDays, surgePct }
    setRun((previous) => ({ id: (previous?.id ?? 0) + 1, params, path: paths.reorderPlan(params) }))
  }

  let body
  if (!run) {
    body = (
      <EmptyState
        title="No plan yet"
        body="Run the simulation: it replays your last 60 days of sales many times over, with random supplier delays, and ranks every product by its chance of running out."
      />
    )
  } else if (!result && plan.loading) {
    body = <Skeleton rows={8} />
  } else if (!result && plan.error && !inlineError) {
    body = <ErrorState error={plan.error} onRetry={plan.reload} />
  } else if (result && result.items.length === 0) {
    body = <EmptyState title="Nothing to plan" body="Add products and record some sales first." />
  } else if (result) {
    body = <PlanResults result={result} plan={plan} controls={controls} pending={pending} reveal={run.id === 1} />
  }

  // One live region, present from the start, so both the wait and the outcome are announced.
  let status = ''
  if (pending) status = pending
  else if (result && result.items.length > 0) status = `Plan ready. ${verdictSentence(planSummary(result))}`

  return (
    <section aria-labelledby="planner-title">
      <header className="sp-page-head">
        <h1 id="planner-title" className="sp-page-title">
          Planner
        </h1>
        <p className="sp-lede">See what may run out, and how much to order.</p>
      </header>

      <form
        className="sp-plan-form sp-reveal"
        style={{ '--i': 1 }}
        aria-label="Scenario"
        data-collapsed={collapsed || undefined}
        onSubmit={handleRun}
      >
        {result && (
          <button
            type="button"
            className="sp-plan-toggle"
            aria-expanded={!collapsed}
            aria-controls="planner-controls"
            onClick={() => setOpenFor(collapsed ? result : null)}
          >
            <span className="sp-plan-toggle-label">Scenario</span>
            <span className="sp-plan-toggle-value">
              <DotJoined parts={scenarioLabel(controls).split(' · ')} />
            </span>
          </button>
        )}
        <div id="planner-controls" className="sp-plan-controls">
          <div className="sp-field sp-plan-sl">
            <div className="sp-plan-sl-head">
              <label className="sp-label" htmlFor="planner-sl">
                Service level
              </label>
              <output className="num sp-plan-sl-value" htmlFor="planner-sl">
                {serviceLevel}%
              </output>
              <span id="planner-sl-help" className="sp-hint">
                chance of not running out
              </span>
            </div>
            <input
              id="planner-sl"
              type="range"
              min={SERVICE_LEVEL.min}
              max={SERVICE_LEVEL.max}
              step={SERVICE_LEVEL.step}
              value={serviceLevel}
              aria-describedby="planner-sl-help"
              aria-valuetext={`${serviceLevel}%`}
              onChange={(event) => setServiceLevel(Number(event.target.value))}
            />
          </div>
          <SegmentedControl
            name="planner-horizon"
            legend="Horizon"
            showLegend
            options={HORIZON_OPTIONS}
            value={horizonDays}
            onChange={setHorizonDays}
          />
          <SegmentedControl
            name="planner-surge"
            legend="Demand surge"
            showLegend
            options={SURGE_OPTIONS}
            value={surgePct}
            onChange={setSurgePct}
          />
        </div>
        <button type="submit" className="sp-btn sp-btn-action sp-plan-run" disabled={plan.loading}>
          {plan.loading ? 'Simulating…' : 'Run simulation'}
        </button>
      </form>

      <p className="visually-hidden" role="status">
        {status}
      </p>
      {pending && !result && <p className="sp-hint sp-plan-status">{pending}</p>}
      {failure && (
        <p className="sp-note sp-note-danger sp-plan-error" role="alert">
          {failure}
          {result && ' The plan below is from the previous run.'}
        </p>
      )}
      {body}
    </section>
  )
}
