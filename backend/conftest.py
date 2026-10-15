"""Test harness. Three isolation layers keep every test off a real database:

1. Allowlist guard: TEST_DATABASE_URL must be in-memory SQLite or a database whose name ends in
   _test, and never the app's DATABASE_URL. It runs before the app is imported.
2. Tripwire: any connection through the app's own engine raises, so code that bypasses get_db
   fails loudly instead of touching settings.database_url.
3. get_db override: requests in tests get sessions on the test engine.

It sits at the backend root, so `pytest` also works from the repository root.
"""

import importlib
import itertools
import os
from collections.abc import Callable, Iterator
from datetime import timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from prometheus_client import REGISTRY
from sqlalchemy import URL, Engine, create_engine, event, make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import db as app_db
from app.config import settings
from app.db import Base, get_db
from app.models import Product
from app.services.stock import record_movement, utcnow

DEFAULT_TEST_DB_URL = "sqlite+pysqlite:///:memory:"
TEST_DB_URL = os.getenv("TEST_DATABASE_URL", DEFAULT_TEST_DB_URL)
_DEFAULT_PORTS = {"postgresql": 5432}


def _is_memory_sqlite(url: URL) -> bool:
    return url.get_backend_name() == "sqlite" and url.database in (None, "", ":memory:")


def _db_identity(url: URL) -> tuple[str, str, int | None, str | None]:
    """Which database a URL reaches, whatever the driver or password."""
    backend = url.get_backend_name()
    return backend, url.host or "", url.port or _DEFAULT_PORTS.get(backend), url.database


def check_test_db_url(test_url: str, app_url: str) -> URL:
    url = make_url(test_url)
    allowed = _is_memory_sqlite(url) or (url.database or "").endswith("_test")
    if not allowed or _db_identity(url) == _db_identity(make_url(app_url)):
        raise RuntimeError(
            f"Refusing to run tests against {url.render_as_string(hide_password=True)}: tests "
            "may only use in-memory SQLite or a database whose name ends in _test, and never "
            "settings.database_url"
        )
    return url


def describe_db(url: URL) -> str:
    # render_as_string() would print ':memory:' as '%3Amemory%3A'.
    if _is_memory_sqlite(url):
        return "sqlite in-memory (fresh schema per test, discarded after the run)"
    return url.render_as_string(hide_password=True)


# 1. Guard, before anything imports app.main.
TEST_URL = check_test_db_url(TEST_DB_URL, settings.database_url)
if os.getenv("TEST_REQUIRE_POSTGRES") == "1" and TEST_URL.get_backend_name() != "postgresql":
    raise RuntimeError(
        "TEST_REQUIRE_POSTGRES=1 but TEST_DATABASE_URL is not PostgreSQL; "
        "refusing to fall back to SQLite"
    )

# 2. Tripwire on the app engine.
APP_DB = make_url(settings.database_url).render_as_string(hide_password=True)


def _refuse_app_db(*_args: object) -> None:
    raise RuntimeError(
        f"tripwire: a test tried to connect to settings.database_url ({APP_DB}); "
        "route DB access through get_db"
    )


event.listen(app_db.engine, "do_connect", _refuse_app_db)


# 3. The test engine.
def _sqlite_foreign_keys_on(dbapi_connection, _record) -> None:
    dbapi_connection.execute("PRAGMA foreign_keys=ON")  # SQLite ignores FKs by default


def make_test_engine(url: URL) -> Engine:
    if url.get_backend_name() == "sqlite":
        # One shared connection: every session sees the same in-memory database.
        pool = {"poolclass": StaticPool} if _is_memory_sqlite(url) else {}
        engine = create_engine(url, connect_args={"check_same_thread": False}, **pool)
        event.listen(engine, "connect", _sqlite_foreign_keys_on)
        return engine
    # lock_timeout: a leaked row lock fails a test after 5 s instead of hanging drop_all.
    return create_engine(
        url,
        pool_pre_ping=True,
        connect_args={"connect_timeout": 5, "options": "-c lock_timeout=5000"},
    )


engine = make_test_engine(TEST_URL)
TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

# Only now import the app: import-time DB access would hit the tripwire.
app: FastAPI = importlib.import_module("app.main").app


def pytest_configure(config: pytest.Config) -> None:
    # pytest.ini registers the marker too, but it is not loaded when pytest runs from the root.
    config.addinivalue_line(
        "markers",
        "postgres: needs PostgreSQL row locks (FOR UPDATE); auto-skipped on SQLite; run make test-pg",
    )


def pytest_report_header(config: pytest.Config) -> list[str]:
    return [
        f"test-db: {describe_db(TEST_URL)}",
        f"app-db: {APP_DB} (never used by tests; tripwire armed)",
    ]


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if engine.dialect.name == "postgresql":
        return
    skip = pytest.mark.skip(reason="needs PostgreSQL row locks; run make test-pg")
    for item in items:
        if "postgres" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(scope="session")
def fastapi_app() -> FastAPI:
    return app


@pytest.fixture(scope="session")
def db_url_guard() -> Callable[[str, str], URL]:
    return check_test_db_url


@pytest.fixture(scope="session")
def db_describer() -> Callable[[URL], str]:
    return describe_db


@pytest.fixture
def schema() -> Iterator[None]:
    """A fresh schema per test, dropped afterwards."""
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture
def db(schema: None) -> Iterator[Session]:
    """A session on the test database. On SQLite, commit before any API call: the API's
    session shares the one connection, and closing either rolls back the other's work."""
    with TestingSession() as session:
        yield session


@pytest.fixture
def session_factory(schema: None) -> sessionmaker[Session]:
    return TestingSession


@pytest.fixture
def client(schema: None) -> Iterator[TestClient]:
    def override_get_db() -> Iterator[Session]:
        with TestingSession() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:  # `with` runs the lifespan
            yield test_client
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def make_product(client: TestClient) -> Callable[..., dict]:
    """POST a valid product (SKUs T-0001, T-0002, ...) merged with overrides; asserts 201."""
    skus = itertools.count(1)

    def create(**overrides: object) -> dict:
        body = {
            "sku": f"T-{next(skus):04d}",
            "name": "Reynolds pen (blue)",
            "category": "STATIONERY",
            "unit": "pcs",
            "unit_cost_paise": 1050,
            "reorder_point": 20,
            "lead_time_days": 7,
            **overrides,
        }
        response = client.post("/api/products", json=body)
        assert response.status_code == 201, response.text
        return response.json()

    return create


@pytest.fixture
def move(client: TestClient) -> Callable[..., dict]:
    """POST one movement; asserts 201. Negative cases call client.post directly."""

    def record(product_id: int, kind: str, quantity: int, note: str | None = None) -> dict:
        body = {"product_id": product_id, "kind": kind, "quantity": quantity, "note": note}
        response = client.post("/api/movements", json=body)
        assert response.status_code == 201, response.text
        return response.json()

    return record


@pytest.fixture
def stocked_product(make_product: Callable[..., dict], move: Callable[..., dict]) -> dict:
    """A product with IN 160 and OUT 20: on hand 140."""
    product = make_product()
    move(product["id"], "IN", 160)
    move(product["id"], "OUT", 20)
    return product


@pytest.fixture
def backdated_ledger(db: Session) -> dict:
    """One product whose movements are back-dated through the stock service (the API never
    accepts timestamps), far from the 24 h and 7 d window edges. Committed before any API call."""
    now = utcnow()
    product = Product(
        sku="PEN-001",
        name="Reynolds pen (blue)",
        category="STATIONERY",
        unit="pcs",
        unit_cost_paise=1050,
        reorder_point=20,
        lead_time_days=7,
    )
    db.add(product)
    db.commit()
    for kind, quantity, age in [
        ("IN", 100, timedelta(days=45)),
        ("ADJUST", -1, timedelta(days=40)),
        ("OUT", 11, timedelta(days=10)),
        ("OUT", 7, timedelta(days=3)),
        ("OUT", 5, timedelta(hours=2)),
    ]:
        record_movement(db, product.id, kind, quantity, at=now - age)
    return {"product_id": product.id, "movements_24h": 1, "units_out_7d": 12, "on_hand": 76}


@pytest.fixture(scope="session")
def metric() -> Callable[..., float]:
    """Read a sample from the process-wide registry. Tests compare deltas, never absolutes."""

    def read(name: str, **labels: str) -> float:
        return REGISTRY.get_sample_value(name, labels) or 0.0

    return read


@pytest.fixture
def override_settings(monkeypatch: pytest.MonkeyPatch) -> Callable[..., None]:
    """Patch attributes of the settings singleton for one test (code reads them per call)."""

    def apply(**values: object) -> None:
        for key, value in values.items():
            monkeypatch.setattr(settings, key, value, raising=True)

    return apply
