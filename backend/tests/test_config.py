import pytest
from pydantic import ValidationError
from sqlalchemy import make_url

from app.config import Settings

# The environment contract (playbook C.2): the defaults the ConfigMap and compose rely on.
CONTRACT_DEFAULTS = {
    "planner_default_scenarios": 1000,
    "planner_max_work": 4_000_000,
    "planner_max_concurrency": 2,
    "planner_queue_timeout_s": 30,
    "lead_time_spread": "0.7,1.0,1.6",
    "db_wait_timeout_s": 120,
}


@pytest.fixture
def clean_env(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    for name in [*CONTRACT_DEFAULTS, "database_url", "cors_origins"]:
        monkeypatch.delenv(name.upper(), raising=False)
    return monkeypatch


def test_contract_defaults(clean_env):
    settings = Settings(_env_file=None)
    assert {name: getattr(settings, name) for name in CONTRACT_DEFAULTS} == CONTRACT_DEFAULTS


def test_lead_time_spread_parses(clean_env):
    assert Settings(_env_file=None).spread == (0.7, 1.0, 1.6)
    clean_env.setenv("LEAD_TIME_SPREAD", " 0.5, 1 ,2.5")
    assert Settings(_env_file=None).spread == (0.5, 1.0, 2.5)


@pytest.mark.parametrize("value", ["1,0.5,2", "a,b,c", "1,2", "0,1,2"])
def test_bad_lead_time_spread_rejected(clean_env, value):
    clean_env.setenv("LEAD_TIME_SPREAD", value)
    with pytest.raises(ValidationError, match="lead_time_spread"):
        Settings(_env_file=None)


def test_cors_origin_list_splits_and_strips(clean_env):
    clean_env.setenv("CORS_ORIGINS", " http://localhost:5173 , ,http://127.0.0.1:5173,")
    assert Settings(_env_file=None).cors_origin_list == [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]


def test_database_url_default_has_no_password(clean_env):
    url = make_url(Settings(_env_file=None).database_url)
    assert url.get_backend_name() == "postgresql"
    assert url.password is None
