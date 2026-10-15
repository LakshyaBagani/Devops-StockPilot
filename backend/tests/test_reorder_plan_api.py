"""Reorder-plan API: bounds, work budget, seeded determinism, the bulkhead and session release.

The main tests pass every numeric parameter explicitly: a test that relied on the defaults would
hide a parameter typed as Literal, which turns every real request into a 422.
"""

import inspect
import math
from datetime import timedelta

import pytest

from app.config import settings
from app.db import get_db
from app.metrics import PLANNER_BULKHEAD
from app.models import Product
from app.routers import planner as planner_router
from app.schemas import PlanItem
from app.services.stock import record_movement, utcnow

EXPLICIT = {"service_level": 95, "horizon_days": 30, "surge_pct": 0, "scenarios": 300, "seed": 42}
# 60 days of lumpy demand: a bulk order of 25 every tenth day, 0 to 2 units on the others.
BURSTY = [25 if day % 10 == 4 else day % 3 for day in range(60)]


def add_product(db, sku: str, *, opening: int, sales=(), reorder_point: int = 20) -> int:
    """A product with an opening delivery 61 days ago, then one OUT per entry of `sales` on
    consecutive days up to today (0 = no sale). Committed, so the API sees it."""
    now = utcnow()
    product = Product(
        sku=sku,
        name=f"Item {sku}",
        category="OTHER",
        unit="pcs",
        unit_cost_paise=1000,
        reorder_point=reorder_point,
        lead_time_days=7,
    )
    db.add(product)
    db.commit()
    record_movement(db, product.id, "IN", opening, at=now - timedelta(days=61))
    for days_ago, units in enumerate(reversed(sales)):
        if units:
            record_movement(db, product.id, "OUT", units, at=now - timedelta(days=days_ago))
    return product.id


@pytest.fixture
def shop(db) -> dict[str, int]:
    """Three products the planner must tell apart: nearly out, well stocked, never sold."""
    return {
        "bursty": add_product(db, "BURSTY-1", opening=sum(BURSTY) + 6, sales=BURSTY),
        "steady": add_product(db, "STEADY-1", opening=1000, sales=[3] * 60, reorder_point=40),
        "idle": add_product(db, "IDLE-1", opening=50),
    }


def plan(client, **params) -> dict:
    response = client.get("/api/reorder-plan", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_reorder_plan_200_with_explicit_params_is_deterministic(client, shop):
    body = plan(client, **EXPLICIT)
    assert {name: body[name] for name in EXPLICIT} == EXPLICIT  # every parameter is echoed
    assert body["lead_time_spread"] == list(settings.spread)
    assert (body["products_considered"], body["work"]) == (3, 300 * 3 * 30)
    items = [PlanItem.model_validate(item) for item in body["items"]]
    assert {item.product_id for item in items} == set(shop.values())
    for item in items:
        assert 0 <= item.stockout_risk <= 1
        p = item.stockout_risk
        assert item.risk_margin == pytest.approx(1.96 * math.sqrt(p * (1 - p) / 300), abs=1e-3)
    assert plan(client, **EXPLICIT) == body  # same seed, byte-identical plan


def test_reorder_plan_median_days_is_int_or_null(client, shop):
    # An even scenario count: a plain median could average two days into x.5 (B71).
    items = plan(client, **EXPLICIT)["items"]
    medians = {item["sku"]: item["median_days_to_stockout"] for item in items}
    assert all(day is None or type(day) is int for day in medians.values())
    assert isinstance(medians["BURSTY-1"], int)  # it runs out in most scenarios
    assert medians["IDLE-1"] is None


def test_reorder_plan_returns_generated_seed_that_reproduces(client, shop):
    params = {name: value for name, value in EXPLICIT.items() if name != "seed"}
    body = plan(client, **params)
    assert 0 <= body["seed"] <= 2**31 - 1
    assert plan(client, **params, seed=body["seed"]) == body


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("service_level", 49.9),
        ("service_level", 100),
        ("service_level", "abc"),
        ("horizon_days", 6),
        ("horizon_days", 91),
        ("horizon_days", 7.5),
        ("surge_pct", -1),
        ("surge_pct", 201),
        ("scenarios", 99),
        ("scenarios", 20_001),
        ("seed", -1),
        ("seed", 2**31),
        ("seed", ""),  # clients must omit an unset parameter
    ],
)
def test_reorder_plan_bounds_are_422(client, name, value):
    response = client.get("/api/reorder-plan", params={**EXPLICIT, name: value})
    assert response.status_code == 422


def test_reorder_plan_work_budget_is_422(client, override_settings, make_product, move, metric):
    product = make_product()
    move(product["id"], "IN", 10)
    override_settings(planner_max_work=1000)
    runs = metric("stockpilot_planner_seconds_count")

    response = client.get("/api/reorder-plan", params={"scenarios": 100, "horizon_days": 30})
    assert response.status_code == 422
    assert response.json() == {
        "detail": "Work budget exceeded: 3000 > 1000 (scenarios x products x horizon_days)"
    }
    assert metric("stockpilot_planner_seconds_count") == runs  # refused before any CPU work


def test_reorder_plan_uses_configured_default_scenarios(client, shop, override_settings):
    override_settings(planner_default_scenarios=200)
    body = plan(client, seed=1)
    assert (body["scenarios"], body["work"]) == (200, 200 * 3 * 30)
    assert (body["service_level"], body["horizon_days"], body["surge_pct"]) == (95, 30, 0)


def test_planner_closes_db_session_before_simulating(
    client, fastapi_app, session_factory, shop, monkeypatch
):
    sessions = []

    def recording_get_db():
        with session_factory() as session:
            sessions.append(session)
            yield session

    real_run_plan = planner_router.run_plan

    def checked_run_plan(snapshots, params):
        # A session still in a transaction would hold a pooled connection through the CPU work.
        assert not sessions[-1].in_transaction()
        return real_run_plan(snapshots, params)

    fastapi_app.dependency_overrides[get_db] = recording_get_db
    monkeypatch.setattr(planner_router, "run_plan", checked_run_plan)
    assert len(plan(client, **EXPLICIT)["items"]) == 3


def test_reorder_plan_observes_planner_metrics(client, shop, metric):
    runs = metric("stockpilot_planner_seconds_count")
    scenarios = metric("stockpilot_planner_scenarios_total")
    plan(client, **{**EXPLICIT, "scenarios": 200})
    assert metric("stockpilot_planner_seconds_count") == runs + 1
    # The idle product is answered without simulating: 200 scenarios x 2 products with demand.
    assert metric("stockpilot_planner_scenarios_total") == scenarios + 400
    assert metric("stockpilot_planner_inflight") == 0


def test_reorder_plan_items_sorted_by_risk(client, shop):
    items = plan(client, **EXPLICIT)["items"]
    keys = [(-item["stockout_risk"], -item["expected_units_short"], item["sku"]) for item in items]
    assert keys == sorted(keys)
    assert items[0]["product_id"] == shop["bursty"]
    assert 0 < items[0]["stockout_risk"] < 1
    assert items[0]["recommended_reorder_point"] > items[0]["current_reorder_point"]
    assert [item["stockout_risk"] for item in items[1:]] == [0.0, 0.0]


def test_reorder_plan_empty_inventory(client):
    body = plan(client, **EXPLICIT)
    assert (body["items"], body["work"], body["products_considered"]) == ([], 0, 0)


def test_reorder_plan_endpoint_runs_in_threadpool():
    # Look in the router itself: FastAPI wraps included routers, so app.routes hides the endpoint.
    [route] = [route for route in planner_router.router.routes if route.path == "/reorder-plan"]
    assert not inspect.iscoroutinefunction(route.endpoint)


def test_reorder_plan_busy_bulkhead_is_503_with_retry_after(client, override_settings, metric):
    override_settings(planner_queue_timeout_s=0.05)
    runs = metric("stockpilot_planner_seconds_count")
    held = 0
    try:
        while PLANNER_BULKHEAD.acquire(blocking=False):  # every slot busy with another plan
            held += 1
        response = client.get("/api/reorder-plan", params=EXPLICIT)
    finally:
        for _ in range(held):
            PLANNER_BULKHEAD.release()
    assert held == settings.planner_max_concurrency
    assert response.status_code == 503
    assert response.json() == {"detail": "Planner busy, retry"}
    assert response.headers["retry-after"] == "5"
    assert metric("stockpilot_planner_seconds_count") == runs
    assert client.get("/api/reorder-plan", params=EXPLICIT).status_code == 200
