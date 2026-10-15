"""Migration runner: URL from settings, naming convention from Base, advisory lock on Postgres."""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool, text

from app import models  # noqa: F401  (registers the tables on Base.metadata)
from app.config import settings
from app.db import Base

config = context.config
if config.config_file_name:
    # Keep loggers created before this point (the app's, when prestart runs Alembic in-process).
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# Base.metadata carries the naming convention, so op.* objects get the same names as the models.
target_metadata = Base.metadata
# One constant shared by every migrator: compose, the Helm hook Job and CI.
MIGRATION_LOCK_ID = 727_001


def run_migrations_offline() -> None:
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(settings.database_url, poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            render_as_batch=connection.dialect.name == "sqlite",
        )
        with context.begin_transaction():
            if connection.dialect.name == "postgresql":
                # Serialises concurrent `alembic upgrade head` runs. It must be taken inside
                # Alembic's transaction (released at COMMIT): a session lock taken before it
                # left the migration unpersisted, and no lock let parallel runs crash.
                connection.execute(
                    text("SELECT pg_advisory_xact_lock(:id)"), {"id": MIGRATION_LOCK_ID}
                )
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
