"""`python -m app.prestart`: wait for the database, then run `alembic upgrade head`.

The compose command and the Helm migrate Job run it before uvicorn starts. It writes no files,
so it works under readOnlyRootFilesystem, and it never imports app.main.
"""

import sys
import time
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.config import settings
from app.db import build_engine

# Absolute, so the migration runs from any working directory.
ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"
RETRY_EVERY_S = 2


def wait_for_db(timeout_s: float | None = None) -> None:
    """Return once SELECT 1 succeeds; exit non-zero after timeout_s (default DB_WAIT_TIMEOUT_S)."""
    if timeout_s is None:
        timeout_s = settings.db_wait_timeout_s
    engine = build_engine(settings.database_url)
    deadline = time.monotonic() + timeout_s
    try:
        while True:
            try:
                with engine.connect() as connection:
                    connection.execute(text("SELECT 1"))
                return
            except SQLAlchemyError as exc:  # DNS not ready, connection refused, server starting
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    sys.exit(f"database not reachable after {timeout_s}s: {exc}")
                print(f"waiting for database: {type(exc).__name__}", flush=True)
                time.sleep(min(RETRY_EVERY_S, remaining))
    finally:
        engine.dispose()


def main() -> None:  # pragma: no cover
    wait_for_db()
    command.upgrade(Config(str(ALEMBIC_INI)), "head")
    print("migrations applied", flush=True)


if __name__ == "__main__":
    main()
