"""Migration checks that need no database. `make test-pg` and CI also run the real
upgrade/check/downgrade/upgrade cycle on Postgres."""

import io
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

from app.db import Base

ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"


def test_single_linear_head():
    script = ScriptDirectory.from_config(Config(str(ALEMBIC_INI)))
    assert script.get_heads() == ["0001"]
    for revision in script.walk_revisions():
        assert revision.down_revision is None or isinstance(revision.down_revision, str)


def test_offline_sql_contains_every_model_name(override_settings):
    override_settings(database_url="postgresql+psycopg://offline@localhost:5432/offline")
    sql = io.StringIO()
    command.upgrade(Config(str(ALEMBIC_INI), output_buffer=sql), "head", sql=True)
    tables = Base.metadata.tables.values()
    names = {c.name for t in tables for c in t.constraints}
    names |= {i.name for t in tables for i in t.indexes}
    # alembic check does not compare CHECK constraints, so this keeps 0001 in step with the models.
    assert sorted(name for name in names if name not in sql.getvalue()) == []
    assert "ck_products_ck_" not in sql.getvalue()
