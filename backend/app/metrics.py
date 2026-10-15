"""Business metrics for Grafana and the per-pod planner bulkhead.

Declared once at import on the default registry (the client appends _total to counters).
No collectors and no database access: a DB-backed collector runs at import or scrape time, so it
can crash the first install before migrations run, or turn /metrics into a 500.
"""

import threading

from prometheus_client import Counter, Gauge, Histogram

from app.config import settings
from app.models import KINDS

MOVEMENTS = Counter("stockpilot_movements", "Stock movements recorded, by kind", ["kind"])
UNITS_MOVED = Counter(
    "stockpilot_units_moved", "Units moved (absolute delta) by recorded movements", ["kind"]
)
INSUFFICIENT_STOCK = Counter(
    "stockpilot_insufficient_stock", "Movements rejected because stock would go below zero"
)
UNDO = Counter("stockpilot_undo", "Movements undone")
PLANNER_SECONDS = Histogram(
    "stockpilot_planner_seconds",
    "Planner compute time inside the bulkhead (queue wait excluded)",
    buckets=(0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10),
)
PLANNER_SCENARIOS = Counter(
    "stockpilot_planner_scenarios", "Product-scenarios simulated (scenarios x products with demand)"
)
PLANNER_INFLIGHT = Gauge("stockpilot_planner_inflight", "Planner runs computing in this pod")

# Create every kind's child now, so each series exists at 0 before the first movement.
for _kind in KINDS:
    MOVEMENTS.labels(_kind)
    UNITS_MOVED.labels(_kind)

# Caps concurrent planner runs per pod, so CPU-bound plans cannot starve the other endpoints.
PLANNER_BULKHEAD = threading.BoundedSemaphore(settings.planner_max_concurrency)
