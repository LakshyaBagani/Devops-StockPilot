import pytest

from app.config import settings


def test_health_returns_ok(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_swagger_ui_served_at_api_docs(client):
    response = client.get("/api/docs")
    assert response.status_code == 200
    assert "swagger-ui" in response.text
    assert "/api/openapi.json" in response.text


def test_openapi_served_at_api_openapi_json(client):
    response = client.get("/api/openapi.json")
    assert response.status_code == 200
    info = response.json()["info"]
    assert info["title"] == "StockPilot API"
    assert info["version"] == settings.app_version


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_root_docs_not_served(client, path):
    assert client.get(path).status_code == 404


def test_cors_preflight_allows_vite_origin_only(client):
    preflight = {"Access-Control-Request-Method": "GET"}
    allowed = client.options(
        "/api/version", headers={**preflight, "Origin": "http://localhost:5173"}
    )
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"

    refused = client.options("/api/version", headers={**preflight, "Origin": "http://evil.test"})
    assert refused.status_code == 400
    assert "access-control-allow-origin" not in refused.headers


def test_version_returns_full_git_sha_verbatim(client, override_settings):
    sha = "0123456789abcdef0123456789abcdef01234567"
    override_settings(git_sha=sha, build_time="2026-10-15T09:30:00Z")
    response = client.get("/api/version")
    assert response.status_code == 200
    assert response.json() == {
        "version": settings.app_version,
        "git_sha": sha,
        "build_time": "2026-10-15T09:30:00Z",
    }
