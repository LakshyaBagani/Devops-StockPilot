"""app.services.planner, tested without a database.

The textbook reorder-point oracle is computed here, never imported from app code, so it stays
independent of the simulator it checks.
"""

import math
import random
from statistics import NormalDist, fmean, pstdev

import pytest

from app.services.planner import (
    PlanParams,
    ProductPlan,
    ProductSnapshot,
    draw_lead_time,
    margin95,
    median_stockout_day,
    nearest_rank,
    parse_spread,
    run_plan,
    work_units,
)

FIXED_LEAD_TIME = (1.0, 1.0, 1.0)
DEFAULT_SPREAD = (0.7, 1.0, 1.6)


def textbook_rop(mean: float, sd: float, lead_time_days: int, service_level: float) -> float:
    """ROP = mean x L + z x sd x sqrt(L), for i.i.d. normal demand and a fixed lead time."""
    z = NormalDist().inv_cdf(service_level / 100)
    return mean * lead_time_days + z * sd * math.sqrt(lead_time_days)


def snapshot(**fields) -> ProductSnapshot:
    defaults = {
        "product_id": 1,
        "sku": "PEN-001",
        "name": "Reynolds pen (blue)",
        "unit": "pcs",
        "on_hand": 100,
        "reorder_point": 20,
        "lead_time_days": 7,
        "daily_out": (5,) * 60,
    }
    return ProductSnapshot(**{**defaults, **fields})


def plan_params(**fields) -> PlanParams:
    defaults = {
        "service_level": 95,
        "horizon_days": 30,
        "surge_pct": 0,
        "scenarios": 500,
        "seed": 42,
        "spread": DEFAULT_SPREAD,
    }
    return PlanParams(**{**defaults, **fields})


def plan_one(snap: ProductSnapshot, **params) -> ProductPlan:
    return run_plan([snap], plan_params(**params))[0]


def lumpy_history(seed: int) -> tuple[int, ...]:
    """60 shop days: about 20% with no sale, about 10% with a bulk order of 15-30 extra units."""
    rng = random.Random(seed)
    return tuple(
        0
        if rng.random() < 0.2
        else rng.randint(2, 8) + (rng.randint(15, 30) if rng.random() < 0.1 else 0)
        for _ in range(60)
    )


def test_simulator_matches_textbook_rop_for_normal_demand_and_fixed_lead_time():
    # The oracle check: with the formula's own assumptions the simulation must agree with it.
    rng = random.Random(7)
    history = tuple(round(rng.gauss(20, 5)) for _ in range(5000))
    result = plan_one(
        snapshot(daily_out=history, lead_time_days=9), spread=FIXED_LEAD_TIME, scenarios=20_000
    )
    expected = textbook_rop(fmean(history), pstdev(history), 9, 95)
    assert abs(result.recommended_reorder_point - expected) <= max(2, 0.02 * expected)


def test_lumpy_demand_and_late_suppliers_need_more_than_textbook_rop():
    # The viva answer to "why not just use the formula": zero days, bulk orders and late
    # suppliers need a higher reorder point than the normal-demand formula gives.
    history = lumpy_history(2026)
    result = plan_one(snapshot(daily_out=history), scenarios=1000)
    textbook = textbook_rop(fmean(history), pstdev(history), 7, 95)
    assert result.recommended_reorder_point >= 1.10 * textbook


def test_higher_service_level_never_lowers_rop():
    snap = snapshot(daily_out=lumpy_history(1))
    levels = (80, 90, 95, 99)
    rops = [plan_one(snap, service_level=sl).recommended_reorder_point for sl in levels]
    assert rops == sorted(rops)
    assert rops[-1] > rops[0]


@pytest.mark.parametrize("on_hand", [0, 25])
def test_zero_demand_product_has_zero_risk(on_hand):
    result = plan_one(snapshot(daily_out=(0,) * 60, on_hand=on_hand))
    assert result.stockout_risk == 0.0
    assert result.risk_margin == 0.0
    assert result.recommended_reorder_point == 0
    assert result.suggested_order_qty == 0
    assert result.median_days_to_stockout is None
    assert result.expected_units_short == 0.0


def test_zero_demand_product_draws_nothing_from_the_rng():
    busy = snapshot(product_id=2, sku="INK-001", daily_out=lumpy_history(3))
    idle = snapshot(product_id=1, daily_out=(0,) * 60)  # planned first, by product_id
    alone = run_plan([busy], plan_params())
    assert run_plan([idle, busy], plan_params())[0] == alone[0]


def test_surge_raises_risk():
    # 30 days x 5 = 150 units fit in 200 on hand; with +40% it is 30 x 7 = 210, which cannot.
    steady = snapshot(daily_out=(5,) * 60, on_hand=200, reorder_point=0)
    assert plan_one(steady, surge_pct=0, scenarios=200).stockout_risk == 0.0
    assert plan_one(steady, surge_pct=40, scenarios=200).stockout_risk == 1.0
    # Lumpy demand: the same scenarios, scaled by the surge, run out strictly more often.
    lumpy = snapshot(daily_out=lumpy_history(1), on_hand=180, reorder_point=0)
    base = plan_one(lumpy).stockout_risk
    assert 0 < base < 1
    assert plan_one(lumpy, surge_pct=40).stockout_risk > base


def test_same_seed_same_output():
    snaps = [snapshot(product_id=i, sku=f"SKU-{i}", daily_out=lumpy_history(i)) for i in (1, 2, 3)]
    assert run_plan(snaps, plan_params(seed=7)) == run_plan(snaps, plan_params(seed=7))


def test_different_seed_changes_result():
    snaps = [snapshot(product_id=i, sku=f"SKU-{i}", daily_out=lumpy_history(i)) for i in (1, 2, 3)]
    assert run_plan(snaps, plan_params(seed=7)) != run_plan(snaps, plan_params(seed=8))


def test_margin_formula():
    assert margin95(0.5, 10_000) == pytest.approx(0.0098)
    assert margin95(0.1, 400) == pytest.approx(0.0294)
    assert margin95(0.0, 1000) == 0.0
    assert margin95(1.0, 1000) == 0.0
    result = plan_one(snapshot(daily_out=lumpy_history(5), on_hand=150, reorder_point=40))
    assert 0 < result.stockout_risk < 1
    assert result.risk_margin == round(margin95(result.stockout_risk, 500), 4)


def test_nearest_rank_uses_exact_integer_ceil():
    values = list(range(1, 5001))
    assert math.ceil(5000 * (80.2 / 100)) == 4011  # the float version is off by one
    assert nearest_rank(values, 80.2) == 4010
    assert nearest_rank(values, 95) == 4750
    assert nearest_rank(values, 99.9) == 4995
    assert nearest_rank([7], 50) == 7


def test_lead_time_draws_within_triangular_bounds():
    rng = random.Random(1)
    draws = [draw_lead_time(rng, 10, DEFAULT_SPREAD) for _ in range(20_000)]
    assert all(isinstance(days, int) for days in draws)
    assert min(draws) >= 7
    # Swapped random.triangular arguments would cap the draws near 12 and skew them early.
    assert max(draws) == 16
    late = sum(days > 10 for days in draws)
    early = sum(days < 10 for days in draws)
    assert late > 3 * early
    week = [draw_lead_time(rng, 7, DEFAULT_SPREAD) for _ in range(5000)]
    assert min(week) >= 5
    assert max(week) <= 12
    assert fmean(week) > 7
    assert {draw_lead_time(rng, 10, FIXED_LEAD_TIME) for _ in range(100)} == {10}


def test_work_units():
    assert work_units(1000, 40, 30) == 1_200_000


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("0.7,1.0,1.6", (0.7, 1.0, 1.6)),
        (" 1, 1 ,1 ", (1.0, 1.0, 1.0)),
        ("1,0.5,2", None),  # mode below low
        ("a,b,c", None),
        ("1,2", None),
        ("0,1,2", None),  # a zero multiplier
        ("1,2,3,4", None),
        ("1,1,inf", None),
        ("", None),
    ],
)
def test_parse_spread_valid_and_invalid(text, expected):
    if expected is None:
        with pytest.raises(ValueError, match="expected"):
            parse_spread(text)
    else:
        assert parse_spread(text) == expected


def test_results_sorted_by_risk_then_shortfall_then_sku():
    # A fixed lead time makes the always-out products deterministic: 6 days short before the
    # day-0 order lands on day 7.
    def always_out(product_id: int, sku: str, demand: int) -> ProductSnapshot:
        return snapshot(
            product_id=product_id, sku=sku, on_hand=0, reorder_point=0, daily_out=(demand,) * 60
        )

    snaps = [
        snapshot(product_id=1, sku="IDLE-B", daily_out=(0,) * 60),
        always_out(2, "OUT-B", 5),
        always_out(3, "OUT-A", 5),
        always_out(4, "OUT-C", 9),
        snapshot(product_id=5, sku="IDLE-A", daily_out=(0,) * 60),
    ]
    plans = run_plan(snaps, plan_params(spread=FIXED_LEAD_TIME))
    assert [p.sku for p in plans] == ["OUT-C", "OUT-A", "OUT-B", "IDLE-A", "IDLE-B"]
    assert [p.expected_units_short for p in plans[:3]] == [54.0, 30.0, 30.0]


def test_median_days_none_when_risk_below_half():
    rare = plan_one(snapshot(daily_out=lumpy_history(1), on_hand=180, reorder_point=40))
    assert 0 < rare.stockout_risk < 0.5
    assert rare.median_days_to_stockout is None
    certain = plan_one(snapshot(on_hand=0, reorder_point=0), spread=FIXED_LEAD_TIME, scenarios=100)
    assert certain.stockout_risk == 1.0
    assert certain.median_days_to_stockout == 1


def test_median_stockout_day_uses_median_low():
    inf = math.inf
    assert median_stockout_day([5] * 50 + [6] * 50) == 5  # an element, never 5.5
    assert isinstance(median_stockout_day([5] * 50 + [6] * 50), int)
    assert median_stockout_day([3, inf, inf]) is None
    assert median_stockout_day([2, 4, inf]) == 4


def test_plan_reports_order_quantity_and_rounded_figures():
    result = plan_one(snapshot(daily_out=lumpy_history(4), on_hand=60), surge_pct=20)
    mean_with_surge = fmean(lumpy_history(4)) * 1.2
    assert result.avg_daily_demand == round(mean_with_surge, 2)
    assert result.suggested_order_qty == math.ceil(round(mean_with_surge * 30, 6))
    assert result.stockout_risk == round(result.stockout_risk, 4)
    assert result.expected_units_short == round(result.expected_units_short, 2)
    assert result.current_reorder_point == 20
