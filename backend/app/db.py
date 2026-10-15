"""Declarative base, engine and sessions. Alembic owns the schema: nothing here creates tables."""

from collections.abc import Iterator
from typing import Any

from sqlalchemy import Engine, MetaData, create_engine, make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

# Deterministic constraint and index names, so models, migrations and `alembic check` agree.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def build_engine(url: str) -> Engine:
    """Create an engine without connecting. Pool options apply to Postgres only."""
    options: dict[str, Any] = {"pool_pre_ping": True}
    if make_url(url).get_backend_name() == "postgresql":
        # 5 replicas x (5 + 5) connections stays below Postgres' default max_connections of 100;
        # the connect timeout makes /ready fail fast instead of hanging on an unreachable host.
        options |= {"pool_size": 5, "max_overflow": 5, "connect_args": {"connect_timeout": 3}}
    return create_engine(url, **options)


engine = build_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """Request-scoped session: the only way routers reach the database, so tests can override it."""
    with SessionLocal() as db:
        yield db
