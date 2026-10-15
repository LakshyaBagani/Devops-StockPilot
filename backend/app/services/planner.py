"""Monte-Carlo (s, Q) reorder planner: pure functions, standard library only.

For every product and scenario the planner draws a supplier lead time, bootstraps daily demand
from the product's own history (zero days and bulk orders included) and walks the horizon under
the shop's CURRENT reorder point, with at most one outstanding order of Q units and lost sales.

- stockout_risk: the share of scenarios that ran out, with a 95% margin (margin95).
- recommended_reorder_point: the service-level quantile of simulated lead-time demand.
- suggested_order_qty: Q = max(1, ceil(mean daily demand x (1 + surge) x horizon_days)).

The RNG draws of a scenario do not depend on service_level or surge_pct (those only select or
scale values), so one seed compares service levels and surges on identical scenarios.
"""

import argparse
import math
import random
import statistics
import time
from collections.abc import Sequence
from dataclasses import dataclass

Spread = tuple[float, float, float]


@dataclass(frozen=True, slots=True)
class ProductSnapshot:
    """One product as the planner sees it. daily_out runs oldest to newest, zero days included."""

    product_id: int
    sku: str
    name: str
    unit: str
    on_hand: int
    reorder_point: int
    lead_time_days: int
    daily_out: tuple[int, ...]


@dataclass(frozen=True)
class PlanParams:
    service_level: float  # percent, e.g. 95
    horizon_days: int
    surge_pct: float
    scenarios: int
    seed: int
    spread: Spread  # lead-time multipliers (low, mode, high)


@dataclass(frozen=True)
class ProductPlan:
    """One row of the plan; mirrors schemas.PlanItem."""

    product_id: int
    sku: str
    name: str
    unit: str
    on_hand: int
    avg_daily_demand: float
    current_reorder_point: int
    recommended_reorder_point: int
    suggested_order_qty: int
    stockout_risk: float
    risk_margin: float
    median_days_to_stockout: int | None
    expected_units_short: float


def parse_spread(text: str) -> Spread:
    """Parse LEAD_TIME_SPREAD, the lead-time multipliers 'low,mode,high' (e.g. '0.7,1.0,1.6')."""
    try:
        low, mode, high = (float(part) for part in text.split(","))
    except ValueError:
        raise ValueError(
            f"expected 3 comma-separated numbers low,mode,high, got {text!r}"
        ) from None
    if not (math.isfinite(high) and 0 < low <= mode <= high):
        raise ValueError(f"expected 0 < low <= mode <= high, got {text!r}")
    return low, mode, high


def margin95(p: float, n: int) -> float:
    """Half-width of the 95% normal-approximation interval of a proportion (0 when p is 0 or 1)."""
    return 1.96 * math.sqrt(p * (1 - p) / n)


def nearest_rank(sorted_values: Sequence[float], service_level: float) -> float:
    """The service-level percentile by nearest rank: rank = ceil(n x service_level / 100).

    The level is taken in permille so the ceil is exact integer maths. In floats, 80.2% of 5000
    is 4010.0000000000005, which would pick rank 4011.
    """
    permille = round(service_level * 10)
    rank = max(1, (len(sorted_values) * permille + 999) // 1000)
    return sorted_values[rank - 1]


def draw_lead_time(rng: random.Random, lead_time_days: int, spread: Spread) -> int:
    """A whole-day supplier lead time from a triangular distribution: late more often than early."""
    low, mode, high = spread
    # random.triangular takes (low, HIGH, mode), not (low, mode, high).
    days = rng.triangular(low * lead_time_days, high * lead_time_days, mode * lead_time_days)
    return max(1, math.ceil(days))


def work_units(scenarios: int, n_products: int, horizon_days: int) -> int:
    """Day-steps one plan simulates. The API rejects a plan above PLANNER_MAX_WORK."""
    return scenarios * n_products * horizon_days


def median_stockout_day(days: Sequence[float]) -> int | None:
    """Median first stock-out day over all scenarios (math.inf = never ran out), or None.

    median_low always returns an element, so the answer is a whole day or None: never 5.5, and
    never the mean of a day and infinity.
    """
    day = statistics.median_low(days)
    return None if math.isinf(day) else int(day)


def _ceil(value: float) -> int:
    # Drop float noise first: 10 x 1.2 is 12.000000000000002, which must stay 12, not become 13.
    return math.ceil(round(value, 6))


def _plan(snap: ProductSnapshot, **fields: object) -> ProductPlan:
    return ProductPlan(
        product_id=snap.product_id,
        sku=snap.sku,
        name=snap.name,
        unit=snap.unit,
        on_hand=snap.on_hand,
        current_reorder_point=snap.reorder_point,
        **fields,
    )


def plan_product(snap: ProductSnapshot, params: PlanParams, rng: random.Random) -> ProductPlan:
    """Simulate one product. A product with no demand returns zeros and draws nothing from rng."""
    surge = 1 + params.surge_pct / 100
    history = snap.daily_out
    mean_demand = statistics.fmean(history) * surge if history else 0.0
    if mean_demand == 0:
        return _plan(
            snap,
            avg_daily_demand=0.0,
            recommended_reorder_point=0,
            suggested_order_qty=0,
            stockout_risk=0.0,
            risk_margin=0.0,
            median_days_to_stockout=None,
            expected_units_short=0.0,
        )

    horizon = params.horizon_days
    order_qty = max(1, _ceil(mean_demand * horizon))
    reorder_point = snap.reorder_point
    scaled = [units * surge for units in history]
    lead_time_demand: list[int] = []
    first_stockout: list[float] = []
    stockouts = 0
    units_short = 0.0

    for _ in range(params.scenarios):
        lead_time = draw_lead_time(rng, snap.lead_time_days, params.spread)
        # Unscaled here; scaling the chosen quantile by the surge gives the same answer.
        lead_time_demand.append(sum(rng.choices(history, k=lead_time)))
        stock = float(snap.on_hand)
        # An order placed on day d arrives at the start of day d + lead_time.
        arrival = lead_time if stock <= reorder_point else None
        first_day = 0
        for day, demand in enumerate(rng.choices(scaled, k=horizon), start=1):
            if day == arrival:
                stock += order_qty
                arrival = None
            if demand > stock:
                units_short += demand - stock  # lost sale
                stock = 0.0
                if not first_day:
                    first_day = day
            else:
                stock -= demand
            if arrival is None and stock <= reorder_point:
                arrival = day + lead_time
        if first_day:
            stockouts += 1
            first_stockout.append(first_day)
        else:
            first_stockout.append(math.inf)

    lead_time_demand.sort()
    risk = stockouts / params.scenarios
    return _plan(
        snap,
        avg_daily_demand=round(mean_demand, 2),
        recommended_reorder_point=_ceil(
            nearest_rank(lead_time_demand, params.service_level) * surge
        ),
        suggested_order_qty=order_qty,
        stockout_risk=round(risk, 4),
        risk_margin=round(margin95(risk, params.scenarios), 4),
        median_days_to_stockout=median_stockout_day(first_stockout),
        expected_units_short=round(units_short / params.scenarios, 2),
    )


def run_plan(snapshots: Sequence[ProductSnapshot], params: PlanParams) -> list[ProductPlan]:
    """Plan every product with one seeded RNG, riskiest first. Equal seeds give equal plans."""
    rng = random.Random(params.seed)
    plans = [plan_product(s, params, rng) for s in sorted(snapshots, key=lambda s: s.product_id)]
    plans.sort(key=lambda p: (-p.stockout_risk, -p.expected_units_short, p.sku))
    return plans


def _synthetic_snapshots(n: int, rng: random.Random) -> list[ProductSnapshot]:  # pragma: no cover
    """Lumpy 60-day histories for the bench: about 20% zero days and 10% bulk-order days."""
    snapshots = []
    for i in range(1, n + 1):
        daily_out = tuple(
            0
            if rng.random() < 0.2
            else rng.randint(1, 8) + (rng.randint(15, 30) if rng.random() < 0.1 else 0)
            for _ in range(60)
        )
        snapshots.append(
            ProductSnapshot(
                product_id=i,
                sku=f"BENCH-{i:03d}",
                name=f"Bench item {i}",
                unit="pcs",
                on_hand=rng.randint(0, 200),
                reorder_point=rng.randint(0, 60),
                lead_time_days=rng.randint(3, 14),
                daily_out=daily_out,
            )
        )
    return snapshots


def main(argv: Sequence[str] | None = None) -> None:  # pragma: no cover
    """`python -m app.services.planner --bench ...`: time run_plan on synthetic demand."""
    parser = argparse.ArgumentParser(
        prog="python -m app.services.planner",
        description="Time the reorder planner on synthetic lumpy demand (mean and p95 per run).",
    )
    parser.add_argument("--bench", action="store_true", help="run the benchmark")
    parser.add_argument("--products", type=int, default=40)
    parser.add_argument("--scenarios", type=int, default=1000)
    parser.add_argument("--horizon", type=int, default=30)
    parser.add_argument("--runs", type=int, default=5)
    args = parser.parse_args(argv)
    if not args.bench:
        parser.print_help()
        return

    snapshots = _synthetic_snapshots(args.products, random.Random(2026))
    seconds = []
    for seed in range(args.runs):
        params = PlanParams(95, args.horizon, 0, args.scenarios, seed, (0.7, 1.0, 1.6))
        start = time.perf_counter()
        run_plan(snapshots, params)
        seconds.append(time.perf_counter() - start)
    seconds.sort()
    print(
        f"{args.products} products x {args.scenarios} scenarios x {args.horizon} days, "
        f"{args.runs} runs: mean {statistics.fmean(seconds):.3f} s, "
        f"p95 {nearest_rank(seconds, 95):.3f} s"
    )


if __name__ == "__main__":
    main()
