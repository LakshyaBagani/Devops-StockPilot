"""The test-database isolation layers in conftest.py (M2: tests never touch production data)."""

import pytest
from sqlalchemy import make_url

from app import db as app_db

APP = "postgresql+psycopg://stockpilot:stockpilot@localhost:5432/stockpilot"
PG_TEST = "postgresql+psycopg://test:test@localhost:5432/stockpilot_test"


@pytest.mark.parametrize(
    ("test_url", "app_url", "allowed"),
    [
        ("sqlite+pysqlite:///:memory:", APP, True),
        ("sqlite://", APP, True),
        (PG_TEST, APP, True),
        ("postgresql+psycopg://test:test@127.0.0.1:55432/stockpilot_test", APP, True),
        # the production database name
        ("postgresql+psycopg://test:test@stockpilot-postgres:5432/stockpilot", APP, False),
        # the database CI runs Alembic on
        ("postgresql+psycopg://test:test@localhost:5432/postgres", APP, False),
        # a SQLite file
        ("sqlite:///./stockpilot.db", APP, False),
        # the name must END in _test
        ("postgresql+psycopg://test:test@localhost:5432/stockpilot_test_old", APP, False),
        # the app's own database, reached with another password
        (PG_TEST, "postgresql+psycopg://test:other@localhost:5432/stockpilot_test", False),
        # ... or another driver and the default port
        (PG_TEST, "postgresql://app@localhost/stockpilot_test", False),
    ],
)
def test_guard_allows_only_memory_sqlite_or_star_test_databases(
    db_url_guard, test_url, app_url, allowed
):
    if allowed:
        assert db_url_guard(test_url, app_url) == make_url(test_url)
    else:
        with pytest.raises(RuntimeError, match="Refusing"):
            db_url_guard(test_url, app_url)


def test_app_engine_tripwire_blocks_real_database():
    with pytest.raises(RuntimeError, match="tripwire"):
        app_db.engine.connect()


def test_report_header_never_shows_passwords(db_describer):
    described = db_describer(make_url("postgresql+psycopg://test:not-a-real-pw@h:5432/x_test"))
    assert "***" in described
    assert "not-a-real-pw" not in described
    assert "in-memory" in db_describer(make_url("sqlite+pysqlite:///:memory:"))
