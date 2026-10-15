import { useState } from 'react'

import { paths } from '../api.js'
import { RiskBar } from '../components/RiskBar.jsx'
import { SegmentedControl } from '../components/SegmentedControl.jsx'
import { EmptyState, ErrorState, Skeleton } from '../components/StatusViews.jsx'
import { DEFAULT_HORIZON, HORIZONS, SERVICE_LEVEL, SURGE_PRESETS, TIMEOUT_MS } from '../config.js'
import { useApiGet } from '../hooks/useApiGet.js'
import { useDocumentTitle } from '../hooks/useDocumentTitle.js'
import { formatDays, formatNumber, formatQty } from '../lib/format.js'
import { horizonWord } from '../lib/planner.js'

const HORIZON_OPTIONS = HORIZONS.map((days) => ({ value: days, label: `${days} d` }))
// Server text worth showing inline: bounds and work budget (422) or the busy bulkhead (503).
const INLINE_STATUSES = new Set([422, 503])

function PlanRow({ item, serviceLevel }) {
  const raise = item.recommended_reorder_point > item.current_reorder_point
  return (
    <tr>
      <td className="c-product">
        <span className="num c-sku-inline">{item.sku}</span> <span className="c-name">{item.name}</span>
      </td>
      <td className="c-risk" data-label="Stock-out risk">
        <RiskBar p={item.stockout_risk} margin={item.risk_margin} serviceLevel={serviceLevel} />
      </td>
      <td className="c-rop num" data-label="Reorder point">
        now {formatNumber(item.current_reorder_point)} →{' '}
        {raise ? <strong>{formatNumber(item.recommended_reorder_point)}</strong> : formatNumber(item.recommended_reorder_point)}
      </td>
      <td className="c-order num" data-label="Order">
        {formatQty(item.suggested_order_qty, item.unit)}
      </td>
      <td className="c-stockout num" data-label="Stock-out (median)">
        {item.median_days_to_stockout === null ? 'no stock-out' : formatDays(item.median_days_to_stockout)}
      </td>
    </tr>
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

  function handleRun(event) {
    event.preventDefault()
    setRun((previous) => ({
      id: (previous?.id ?? 0) + 1,
      path: paths.reorderPlan({ serviceLevel, horizonDays, surgePct }),
    }))
  }

  const result = plan.data
  // A failed re-run is also shown inline, because the previous plan stays on screen.
  const inlineError = plan.error && (INLINE_STATUSES.has(plan.error.status) || result) ? plan.error : null

  let body
  if (!run) {
    body = (
      <div className="explainer">
        <p>
          Shop demand is lumpy, with quiet days and sudden bulk orders, and suppliers are late more often than early. The
          planner replays your last 60 days of sales thousands of times with random delivery delays, so its reorder points
          are checked against the textbook ROP&nbsp;=&nbsp;d̄·L&nbsp;+&nbsp;z·σ·√L.
        </p>
      </div>
    )
  } else if (!result && plan.loading) {
    body = <Skeleton rows={6} />
  } else if (!result && plan.error && !inlineError) {
    body = <ErrorState error={plan.error} onRetry={plan.reload} />
  } else if (result && result.items.length === 0) {
    body = <EmptyState title="Nothing to plan" body="Add products and record some sales first." />
  } else if (result) {
    body = (
      <>
        <p className="plan-head num">
          {formatNumber(result.items.length)} products · from {formatNumber(result.scenarios)} simulated{' '}
          {horizonWord(result.horizon_days)} · {result.service_level}% service level
          {result.surge_pct > 0 && ` · +${result.surge_pct}% surge`}
          {plan.elapsedMs !== null && ` · ${(plan.elapsedMs / 1000).toFixed(2)} s`}
        </p>
        <div className="table-scroll" data-refreshing={plan.loading || undefined}>
          <table className="ledger-table plan-table" aria-busy={plan.loading || undefined}>
            <caption className="visually-hidden">Reorder plan, highest stock-out risk first</caption>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Stock-out risk</th>
                <th scope="col" className="num-col">
                  Reorder point
                </th>
                <th scope="col" className="num-col">
                  Order
                </th>
                <th scope="col" className="num-col">
                  Stock-out (median)
                </th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((item) => (
                <PlanRow key={item.product_id} item={item} serviceLevel={result.service_level} />
              ))}
            </tbody>
          </table>
        </div>
      </>
    )
  }

  return (
    <section aria-labelledby="planner-title">
      <header className="page-head">
        <h1 id="planner-title" className="page-title">
          Planner
        </h1>
        <p className="page-lede">Festival reorder plan: how likely each product is to run out, and what to reorder.</p>
      </header>

      <form className="planner-form" onSubmit={handleRun}>
        <div className="field">
          <label className="field-label" htmlFor="planner-sl">
            Service level{' '}
            <output className="num" htmlFor="planner-sl">
              {serviceLevel}%
            </output>
          </label>
          <input
            id="planner-sl"
            type="range"
            min={SERVICE_LEVEL.min}
            max={SERVICE_LEVEL.max}
            step={SERVICE_LEVEL.step}
            value={serviceLevel}
            aria-describedby="planner-sl-help"
            onChange={(event) => setServiceLevel(Number(event.target.value))}
          />
          <p id="planner-sl-help" className="field-hint">
            Chance of not running out
          </p>
        </div>

        <SegmentedControl
          name="planner-horizon"
          legend="Horizon"
          showLegend
          options={HORIZON_OPTIONS}
          value={horizonDays}
          onChange={setHorizonDays}
        />

        <fieldset className="surge">
          <legend className="field-label">Demand surge</legend>
          <div className="chip-row">
            {SURGE_PRESETS.map((preset) => (
              <button
                key={preset.pct}
                type="button"
                className="bin-chip"
                aria-pressed={surgePct === preset.pct}
                onClick={() => setSurgePct(preset.pct)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </fieldset>

        <button type="submit" className="btn btn-hivis planner-run" disabled={plan.loading}>
          {plan.loading ? 'Simulating…' : 'Run simulation'}
        </button>
      </form>

      {plan.loading && (
        <p className="field-hint" role="status">
          Simulating {horizonDays} days of demand for every product…
        </p>
      )}
      {inlineError && (
        <p className="field-error" role="alert">
          {inlineError.message}
        </p>
      )}
      {body}
    </section>
  )
}
