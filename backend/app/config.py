"""12-factor settings: every field can be set by the environment variable of the same name."""

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.services.planner import Spread, parse_spread


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "StockPilot API"
    app_version: str = "1.0.0"
    git_sha: str = "dev"  # Helm and CI set the full 40-character commit SHA
    build_time: str = "unknown"
    # No password in code: compose and Helm pass the full URL.
    database_url: str = "postgresql+psycopg://stockpilot@localhost:5432/stockpilot"
    # Only the Vite dev server needs CORS; compose and Kubernetes serve UI and API same-origin.
    cors_origins: str = "http://localhost:5173"

    planner_default_scenarios: int = Field(1000, ge=100, le=20000)
    # scenarios x products x horizon_days: the default 1000 scenarios over 60 days for up to
    # 66 products.
    planner_max_work: int = Field(4_000_000, ge=1)
    planner_max_concurrency: int = Field(2, ge=1, le=16)
    planner_queue_timeout_s: int = Field(30, ge=1, le=120)
    # Kept as str (also CORS_ORIGINS): pydantic-settings would JSON-decode a tuple or list field
    # read from the environment, and '0.7,1.0,1.6' is not JSON.
    lead_time_spread: str = "0.7,1.0,1.6"
    db_wait_timeout_s: int = Field(120, ge=1, le=600)

    @field_validator("lead_time_spread")
    @classmethod
    def _check_spread(cls, value: str) -> str:
        parse_spread(value)  # a bad value fails at startup, so the pod log says why
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def spread(self) -> Spread:
        return parse_spread(self.lead_time_spread)


settings = Settings()
