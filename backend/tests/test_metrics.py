import ast
import subprocess
import sys
from pathlib import Path

from prometheus_client import REGISTRY

from app.config import settings
from app.metrics import PLANNER_BULKHEAD
from app.models import KINDS

BACKEND = Path(__file__).resolve().parents[1]


def test_business_series_exist_at_zero_before_traffic():
    # A fresh interpreter: in this process other tests may already have moved the counters.
    exposition = subprocess.run(
        [
            sys.executable,
            "-c",
            "import app.main, prometheus_client; print(prometheus_client.generate_latest().decode())",
        ],
        cwd=BACKEND,
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    ).stdout.splitlines()
    expected = [
        *(f'stockpilot_movements_total{{kind="{kind}"}} 0.0' for kind in KINDS),
        *(f'stockpilot_units_moved_total{{kind="{kind}"}} 0.0' for kind in KINDS),
        "stockpilot_insufficient_stock_total 0.0",
        "stockpilot_undo_total 0.0",
        "stockpilot_planner_scenarios_total 0.0",
        "stockpilot_planner_seconds_count 0.0",
        "stockpilot_planner_inflight 0.0",
    ]
    assert [line for line in expected if line not in exposition] == []


def test_http_requests_total_appears_after_api_call(client, metric):
    labels = {"handler": "/api/version", "method": "GET", "status": "2xx"}
    before = metric("http_requests_total", **labels)
    client.get("/api/version")
    assert metric("http_requests_total", **labels) == before + 1


def test_probe_handlers_not_instrumented(client):
    for path in ("/health", "/ready", "/metrics", "/no-such-page"):
        client.get(path)
    exposition = client.get("/metrics").text
    for path in ("/health", "/ready", "/metrics", "/no-such-page"):
        assert f'handler="{path}"' not in exposition


def test_inprogress_and_highr_histogram_present(client):
    client.get("/api/version")
    exposition = client.get("/metrics").text
    assert 'http_requests_inprogress{handler="/api/version",method="GET"}' in exposition
    assert "http_request_duration_highr_seconds_bucket" in exposition


def test_planner_bulkhead_capacity_matches_setting():
    capacity = settings.planner_max_concurrency
    held = [PLANNER_BULKHEAD.acquire(blocking=False) for _ in range(capacity)]
    try:
        assert all(held)
        assert not PLANNER_BULKHEAD.acquire(blocking=False)
    finally:
        for _ in range(sum(held)):
            PLANNER_BULKHEAD.release()


def test_metrics_route_hidden_from_openapi(client):
    assert "/metrics" not in client.get("/api/openapi.json").json()["paths"]
    response = client.get("/metrics")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")


def test_metrics_module_has_no_db_access():
    tree = ast.parse((BACKEND / "app" / "metrics.py").read_text())
    used = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            used.add(node.id)
        elif isinstance(node, ast.Attribute):
            used.add(node.attr)
        elif isinstance(node, ast.ImportFrom):
            used.update(alias.name for alias in node.names)
    assert used.isdisjoint({"Session", "SessionLocal", "engine", "get_db", "execute", "text"})
    # No custom collector classes: a collector queries at scrape time.
    assert not any(isinstance(node, ast.ClassDef) for node in ast.walk(tree))


def test_movement_counters_count_by_kind_and_units(client, make_product, move, metric):
    names = ("stockpilot_movements_total", "stockpilot_units_moved_total")
    before = {(name, kind): metric(name, kind=kind) for name in names for kind in KINDS}
    product = make_product()
    move(product["id"], "IN", 10)
    move(product["id"], "OUT", 4)
    move(product["id"], "ADJUST", -2)
    deltas = {key: metric(key[0], kind=key[1]) - value for key, value in before.items()}
    assert deltas == {
        ("stockpilot_movements_total", "IN"): 1,
        ("stockpilot_movements_total", "OUT"): 1,
        ("stockpilot_movements_total", "ADJUST"): 1,
        ("stockpilot_units_moved_total", "IN"): 10,
        ("stockpilot_units_moved_total", "OUT"): 4,
        ("stockpilot_units_moved_total", "ADJUST"): 2,  # absolute units
    }


def test_planner_metrics_record_runs_scenarios_and_inflight(client, make_product, move, metric):
    for _ in range(2):
        product = make_product()
        move(product["id"], "IN", 50)
        move(product["id"], "OUT", 5)
    runs = metric("stockpilot_planner_seconds_count")
    scenarios = metric("stockpilot_planner_scenarios_total")

    response = client.get("/api/reorder-plan", params={"scenarios": 200, "seed": 3})
    assert response.status_code == 200
    assert metric("stockpilot_planner_seconds_count") == runs + 1
    assert metric("stockpilot_planner_scenarios_total") == scenarios + 400  # 200 x 2 products
    assert metric("stockpilot_planner_inflight") == 0
    buckets = {
        sample.labels["le"]
        for family in REGISTRY.collect()
        if family.name == "stockpilot_planner_seconds"
        for sample in family.samples
        if sample.name.endswith("_bucket")
    }
    assert buckets == {"0.05", "0.1", "0.25", "0.5", "1.0", "2.5", "5.0", "10.0", "+Inf"}
