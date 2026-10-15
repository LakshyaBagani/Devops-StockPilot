import logging

import pytest
from sqlalchemy.orm import Session

from app.db import NAMING_CONVENTION, Base, build_engine, get_db

# Nothing listens on port 1, so connecting fails at once (connection refused).
UNREACHABLE_URL = "postgresql+psycopg://x:y@127.0.0.1:1/none"


@pytest.fixture
def unreachable_db(client, fastapi_app):
    engine = build_engine(UNREACHABLE_URL)

    def override_get_db():
        with Session(engine) as session:
            yield session

    fastapi_app.dependency_overrides[get_db] = override_get_db
    yield
    engine.dispose()


def test_ready_ok(client):
    response = client.get("/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_ready_503_when_database_unreachable(client, unreachable_db, caplog):
    with caplog.at_level(logging.WARNING, logger="stockpilot"):
        response = client.get("/ready")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}
    assert "readiness check failed: OperationalError" in caplog.text


def test_health_ok_when_database_unreachable(client, unreachable_db):
    assert client.get("/health").json() == {"status": "ok"}


def test_engine_options_postgres_only():
    postgres = build_engine("postgresql+psycopg://u:p@db.invalid:5432/app")
    assert postgres.pool.size() == 5
    assert postgres.pool.checkedout() == 0  # built lazily: nothing has connected
    # SQLite pools reject pool_size/max_overflow, so these must not be passed there.
    sqlite = build_engine("sqlite+pysqlite:///:memory:")
    assert sqlite.dialect.name == "sqlite"


def test_base_metadata_has_naming_convention():
    assert dict(Base.metadata.naming_convention) == NAMING_CONVENTION
    assert set(NAMING_CONVENTION) == {"ix", "uq", "ck", "fk", "pk"}
