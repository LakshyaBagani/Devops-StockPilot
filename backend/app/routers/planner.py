"""GET /api/reorder-plan: the CPU-bound endpoint the HPA scales on.

A plain def, so it runs in the threadpool and the event loop (and the async /health) stays free.
Settings are read per request rather than copied at import, so tests can override them.
"""

import random
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.metrics import PLANNER_BULKHEAD, PLANNER_INFLIGHT, PLANNER_SCENARIOS, PLANNER_SECONDS
from app.schemas import PlanItem, ReorderPlanOut
from app.services import stock
from app.services.planner import PlanParams, run_plan, work_units

router = APIRouter(prefix="/reorder-plan", tags=["planner"])
DB = Annotated[Session, Depends(get_db)]

MAX_SEED = 2**31 - 1


@router.get(
    "",
    responses={503: {"description": "Planner busy, retry (all slots taken; see Retry-After)"}},
)
def reorder_plan(
    db: DB,
    service_level: Annotated[
        float, Query(ge=50, le=99.9, description="Target service level, in percent")
    ] = 95,
    horizon_days: Annotated[int, Query(ge=7, le=90)] = 30,
    surge_pct: Annotated[
        float, Query(ge=0, le=200, description="Demand surge in percent, e.g. 40 for a festival")
    ] = 0,
    scenarios: Annotated[
        int | None, Query(ge=100, le=20_000, description="Default: PLANNER_DEFAULT_SCENARIOS")
    ] = None,
    seed: Annotated[
        int | None, Query(ge=0, le=MAX_SEED, description="Omit for a random seed; it is echoed")
    ] = None,
) -> ReorderPlanOut:
    """Simulate demand and supplier lead times for every product and rank them by stock-out
    risk, with recommended reorder points and order quantities.

    A plan larger than PLANNER_MAX_WORK (scenarios x products x horizon_days) is refused with
    422 before any simulation."""
    if scenarios is None:
        scenarios = settings.planner_default_scenarios
    if seed is None:
        seed = random.SystemRandom().randrange(MAX_SEED + 1)

    snapshot = stock.demand_snapshot(db, stock.utcnow())
    # Hand the pooled connection back before the CPU work, so /ready and other requests get one.
    db.close()

    work = work_units(scenarios, len(snapshot), horizon_days)
    if work > settings.planner_max_work:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"Work budget exceeded: {work} > {settings.planner_max_work} "
            "(scenarios x products x horizon_days)",
        )
    params = PlanParams(service_level, horizon_days, surge_pct, scenarios, seed, settings.spread)

    # A bounded wait for a slot: unbounded queueing would exhaust the threadpool.
    if not PLANNER_BULKHEAD.acquire(timeout=settings.planner_queue_timeout_s):
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Planner busy, retry", headers={"Retry-After": "5"}
        )
    try:
        with PLANNER_INFLIGHT.track_inprogress(), PLANNER_SECONDS.time():
            plans = run_plan(snapshot, params)
    finally:
        PLANNER_BULKHEAD.release()
    # Products without demand are answered without simulating, so they add no scenarios.
    PLANNER_SCENARIOS.inc(scenarios * sum(1 for snap in snapshot if any(snap.daily_out)))

    return ReorderPlanOut(
        service_level=service_level,
        horizon_days=horizon_days,
        surge_pct=surge_pct,
        scenarios=scenarios,
        seed=seed,
        lead_time_spread=params.spread,
        products_considered=len(snapshot),
        work=work,
        items=[PlanItem.model_validate(plan) for plan in plans],
    )
