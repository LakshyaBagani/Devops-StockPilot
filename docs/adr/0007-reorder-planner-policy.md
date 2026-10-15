# ADR-0007: Reorder planner simulates the shop's (s, Q) policy, with Q covering the horizon

- **Status:** Accepted
- **Date:** 2026-10-15
- **Deciders:** Lakshya Bagani
- **Related:** `backend/app/services/planner.py`, `backend/app/routers/planner.py`,
  `backend/tests/test_planner.py`, [ADR-0005](0005-derived-stock-ledger.md)

## Context

Before a festival an owner wants to know which products will run out and how much to reorder. The
textbook answer is a reorder point

```text
ROP = d̄·L + z·σ·√L
```

(mean daily demand d̄, lead time L, demand standard deviation σ, service-level factor z). It assumes
normally distributed, independent daily demand and a fixed lead time. A neighbourhood shop sees
neither: many days with no sale of an item, occasional bulk orders, and suppliers who are late more
often than early. The planner also has a second job in this project: it is the CPU-heavy endpoint the
HorizontalPodAutoscaler scales on, so it must be honest work and it must be bounded.

## Decision

`GET /api/reorder-plan` runs a seeded Monte-Carlo simulation per product (pure functions, standard
library only):

1. **Snapshot.** One query reads, for every product, `on_hand`, the reorder point, the lead time and
   the daily OUT units of the last 60 days, zero days included. The database session is closed before
   any CPU work.
2. **Per scenario.** Draw a lead time from a triangular distribution over
   (0.7·LT, 1.0·LT, 1.6·LT), rounded up to whole days (`LEAD_TIME_SPREAD`, skewed late). Draw each
   day's demand by bootstrapping from the product's own 60 days, times `1 + surge_pct/100`. Walk the
   horizon day by day under the shop's **current** policy (s, Q): when the stock on hand is at or
   below the current reorder point s and no order is outstanding, order Q units, which arrive L days
   later. Demand above the shelf stock is a lost sale.
3. **Order quantity (the Q rule):** `Q = max(1, ceil(d̄ · (1 + surge) · horizon_days))`, the expected
   demand of the whole horizon, so one order covers the planning period. At most one order is
   outstanding.
4. **Outputs per product,** riskiest first:
   - `stockout_risk`: the share of scenarios that ran out within the horizon, with a 95% margin
     `1.96·√(p(1−p)/S)`;
   - `recommended_reorder_point`: the service-level quantile (nearest rank) of simulated lead-time
     demand, scaled by the surge;
   - `suggested_order_qty` (Q), `expected_units_short`, and `median_days_to_stockout` computed with
     `statistics.median_low` over first stock-out days (infinite when a scenario never runs out), so
     it is always a whole day or `null`, never 5.5.
5. **Reproducible:** one `random.Random(seed)` per request; the seed is echoed, and the same seed and
   inputs give the same plan.
6. **Bounded:** work = scenarios × products × horizon days must not exceed `PLANNER_MAX_WORK`
   (4,000,000), otherwise 422 before any simulation; a per-pod bulkhead (`PLANNER_MAX_CONCURRENCY`=2)
   with a 30 s queue limit answers 503 `Planner busy, retry` with `Retry-After: 5`. The endpoint is a
   plain `def`, so it runs in the threadpool and the async `/health` stays responsive.

## Alternatives considered

- **The ROP formula alone:** cheap, but wrong exactly where it matters (lumpy demand, late
  suppliers), and it gives no stock-out probability. It is kept as the test oracle.
- **Economic order quantity for Q:** needs ordering and holding costs that a small shop does not
  track; the horizon-coverage rule is explainable at the counter.
- **Searching for the optimal s by simulation:** many plans per request, far more CPU, harder to
  explain; the recommended reorder point already tells the owner where s should move.
- **Caching plans:** every recorded movement and every what-if setting changes the inputs, and
  per-pod caches would disagree. A cache keyed by the last movement id and the parameters is future
  work.

## Consequences

- The simulator is validated against the formula: with normal demand and a fixed lead time its
  reorder point is within 2% (or 2 units) of the textbook ROP, while lumpy demand with late suppliers
  needs at least 10% more. Other tests cover monotonicity in the service level, zero demand (zero
  risk, no random draws), surge raising risk, seeded determinism, the margin formula and `median_low`.
- Risk is measured under the shop's current reorder point, which answers "what happens if I change
  nothing"; the recommended reorder point is reported next to it.
- The Q rule ignores supplier minimums, case sizes and costs; that is a deliberate simplification.
- Sizing: the default call (1,000 scenarios, 30 days, 40 seeded products, 1.2 million day-steps) takes
  about 0.29 s of compute in a backend pod on kind, so `PLANNER_DEFAULT_SCENARIOS` stays at 1000.
  The calibration on the EKS node type is recorded after the EKS session.
