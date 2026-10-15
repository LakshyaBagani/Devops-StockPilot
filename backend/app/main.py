"""StockPilot API: app shell, probes, Prometheus instrumentation and the /api routers."""

import logging
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_fastapi_instrumentator import Instrumentator
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app import metrics  # noqa: F401  (registers the business series before the first scrape)
from app.config import settings
from app.db import engine, get_db
from app.routers import meta, movements, planner, products, summary

log = logging.getLogger("stockpilot")
# uvicorn configures only its own loggers: without a handler, INFO lines from this logger would
# never reach the container log.
_log_handler = logging.StreamHandler()
_log_handler.setFormatter(logging.Formatter("%(levelname)s:     %(message)s"))
log.addHandler(_log_handler)
log.setLevel(logging.INFO)

DESCRIPTION = """\
Inventory for small shops and godowns. Staff record stock IN, OUT and ADJUST movements; stock on
hand, stock value and days of cover are always derived from that ledger. The reorder planner
simulates demand and supplier lead times to estimate the stock-out risk of every product and
how much to reorder."""

OPENAPI_TAGS = [
    {"name": "products", "description": "Products with live stock, value and days of cover"},
    {"name": "movements", "description": "The stock ledger: record and undo movements"},
    {"name": "summary", "description": "Stock value, reorder count, recent activity, top movers"},
    {"name": "planner", "description": "Monte-Carlo reorder planner (CPU-bound)"},
    {"name": "meta", "description": "Build identity of the running image"},
    {"name": "ops", "description": "Liveness and readiness probes, outside /api"},
]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # No database work: Alembic owns the schema, and the app must start while the DB is down.
    log.info(
        "starting %s %s (git %s), database %s",
        settings.app_name,
        settings.app_version,
        settings.git_sha,
        engine.url.render_as_string(hide_password=True),
    )
    yield
    engine.dispose()


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description=DESCRIPTION,
    openapi_tags=OPENAPI_TAGS,
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url=None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type"],
)
Instrumentator(
    should_group_status_codes=True,
    should_ignore_untemplated=True,
    should_instrument_requests_inprogress=True,
    inprogress_labels=True,
    excluded_handlers=["^/metrics$", "^/health$", "^/ready$"],
).instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)


@app.get("/health", tags=["ops"])
async def health() -> dict[str, str]:
    """Liveness. async and DB-free: it needs no worker thread, so it still answers while
    planner runs occupy the threadpool."""
    return {"status": "ok"}


@app.get("/ready", tags=["ops"], responses={503: {"description": "Database unreachable"}})
def ready(db: Annotated[Session, Depends(get_db)]):
    """Readiness: SELECT 1 only. Checking tables would deadlock the first Helm install, whose
    migration hook waits for Ready pods."""
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        log.warning("readiness check failed: %s", type(exc).__name__)
        return JSONResponse(status_code=503, content={"status": "unavailable"})
    return {"status": "ready"}


# Single-level includes: instrumentator 8.1 labels requests with the route template, such as
# /api/products/{product_id}, so ids never explode the metric cardinality.
for module in (meta, products, movements, summary, planner):
    app.include_router(module.router, prefix="/api")
