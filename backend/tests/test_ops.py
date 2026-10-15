import json
import re

from sqlalchemy.exc import OperationalError

from app.db import get_db

# The 12 business operations of the API contract, with path parameters written as {id}.
BUSINESS_OPERATIONS = {
    ("GET", "/api/products"),
    ("POST", "/api/products"),
    ("GET", "/api/products/{id}"),
    ("PUT", "/api/products/{id}"),
    ("DELETE", "/api/products/{id}"),
    ("GET", "/api/movements"),
    ("POST", "/api/movements"),
    ("GET", "/api/movements/{id}"),
    ("DELETE", "/api/movements/{id}"),
    ("GET", "/api/summary"),
    ("GET", "/api/reorder-plan"),
    ("GET", "/api/version"),
}
BUSINESS_SERIES = [
    "stockpilot_movements_total",
    "stockpilot_units_moved_total",
    "stockpilot_insufficient_stock_total",
    "stockpilot_undo_total",
    "stockpilot_planner_seconds_bucket",
    "stockpilot_planner_scenarios_total",
    "stockpilot_planner_inflight",
]


class BrokenSession:
    """Stands in for a session whose database has gone away."""

    def execute(self, *args, **kwargs):
        raise OperationalError("SELECT 1", {}, Exception("connection refused"))


def test_health_never_touches_the_database(client, fastapi_app):
    fastapi_app.dependency_overrides[get_db] = BrokenSession
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    # Control: the same override does break the probe that uses the database.
    assert client.get("/ready").status_code == 503


def test_openapi_lists_every_business_endpoint(client):
    paths = client.get("/api/openapi.json").json()["paths"]
    operations = {
        (method.upper(), re.sub(r"\{[^}]+\}", "{id}", path))
        for path, methods in paths.items()
        for method in methods
    }
    assert operations == BUSINESS_OPERATIONS | {("GET", "/health"), ("GET", "/ready")}
    assert "/metrics" not in paths


def test_metrics_endpoint_exposes_http_and_business_series(client):
    for path in ("/api/products", "/api/products/999999", "/health", "/ready", "/nope"):
        client.get(path)
    response = client.get("/metrics")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    exposition = response.text
    assert 'http_requests_total{handler="/api/products",method="GET",status="2xx"}' in exposition
    assert (
        'http_requests_total{handler="/api/products/{product_id}",method="GET",status="4xx"}'
        in exposition
    )
    assert "http_request_duration_highr_seconds_bucket" in exposition
    assert [name for name in BUSINESS_SERIES if name not in exposition] == []
    # Probes, the scrape itself and unknown paths are never labelled.
    for path in ("/health", "/ready", "/metrics", "/nope"):
        assert f'handler="{path}"' not in exposition


def test_json_body_without_content_type_is_rejected(client):
    # FastAPI parses JSON only under a JSON content type, which is why api.js always sets it.
    body = {
        "sku": "PEN-001",
        "name": "Pen",
        "category": "OTHER",
        "unit": "pcs",
        "unit_cost_paise": 1,
    }
    response = client.post(
        "/api/products", content=json.dumps(body), headers={"Content-Type": "text/plain"}
    )
    assert response.status_code == 422
    assert client.get("/api/products").json() == []
