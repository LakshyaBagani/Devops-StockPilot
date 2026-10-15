"""The demo seed (app.seed) and the database wait in app.prestart."""

import time
from datetime import timedelta

import pytest
from sqlalchemy import func, select

from app import prestart, seed
from app.models import Product, StockMovement
from app.services import stock

# Nothing listens on port 1, so every connection attempt is refused at once.
UNREACHABLE_URL = "postgresql+psycopg://x:y@127.0.0.1:1/never_test"


def movement_count(db, *where) -> int:
    return db.scalar(select(func.count(StockMovement.id)).where(*where))


def test_seed_is_idempotent_and_never_negative(db):
    now = stock.utcnow()
    first = seed.run(db, days=14, now=now)
    assert (first.created, first.skipped) == (40, 0)
    assert first.movements == movement_count(db)
    assert seed.run(db, days=14, now=now) == seed.SeedReport(created=0, skipped=40, movements=0)
    assert db.scalar(select(func.count(Product.id))) == 40
    assert movement_count(db) == first.movements

    by_product = select(func.sum(StockMovement.delta)).group_by(StockMovement.product_id)
    on_hand = db.scalars(by_product).all()
    assert len(on_hand) == 40
    assert min(on_hand) >= 0
    # Back-dated, yet never into the future and never before the requested window.
    assert movement_count(db, StockMovement.created_at > now) == 0
    assert movement_count(db, StockMovement.created_at < now - timedelta(days=14)) == 0


def test_seed_history_spans_sixty_days_up_to_now(db):
    now = stock.utcnow()
    report = seed.run(db, now=now)
    assert 2000 <= report.movements <= 3000
    kinds = set(db.scalars(select(StockMovement.kind).distinct()))
    assert kinds == {"IN", "OUT", "ADJUST"}
    assert movement_count(db, StockMovement.created_at > now) == 0
    assert movement_count(db, StockMovement.created_at < now - timedelta(days=61)) == 0
    # 60 shop days: the oldest delivery is more than 59 days back.
    assert movement_count(db, StockMovement.created_at < now - timedelta(days=59)) > 0
    summary = stock.inventory_summary(db, now)
    assert summary["movements_24h"] > 0  # today's sales are there
    assert summary["items_below_reorder"] >= 1  # the overview opens with something to reorder


def test_seed_ids_follow_time_so_the_ledger_reads_newest_first(db):
    # The ledger lists id DESC as newest first, so ids must increase with created_at.
    seed.run(db, days=14)
    stamps = db.scalars(select(StockMovement.created_at).order_by(StockMovement.id)).all()
    assert len(stamps) > 40
    assert stamps == sorted(stamps)


def test_seed_leaves_fast_movers_below_lead_time_cover(db, client):
    seed.run(db)
    rows = client.get("/api/products", params={"limit": 200}).json()
    short = {
        row["sku"]
        for row in rows
        if row["days_of_cover"] is not None and row["days_of_cover"] < row["lead_time_days"]
    }
    assert {item.sku for item in seed.CATALOGUE if item.story == "short"} <= short
    assert len(short) >= 3
    plan = client.get("/api/reorder-plan", params={"scenarios": 200, "seed": 42}).json()
    assert [item["stockout_risk"] >= 0.2 for item in plan["items"][:3]] == [True, True, True]


def test_seed_demo_pen_flips_green_to_amber_after_out_20(db, client):
    seed.run(db)

    def pen() -> dict:
        [row] = client.get("/api/products", params={"q": seed.DEMO_SKU}).json()
        return row

    before = pen()
    lead_time = before["lead_time_days"]
    assert before["days_of_cover"] >= 2 * lead_time  # green
    sale = {"product_id": before["id"], "kind": "OUT", "quantity": 20}
    assert client.post("/api/movements", json=sale).status_code == 201
    after = pen()
    assert lead_time <= after["days_of_cover"] < 2 * lead_time  # amber
    assert after["needs_reorder"] is False


def test_demo_reset_is_idempotent(db):
    assert seed.demo_reset(db) == []  # nothing seeded, nothing to reset
    seed.run(db)
    assert all(on_hand == target for _, on_hand, target in seed.demo_reset(db))
    pen_id = db.scalar(select(Product.id).where(Product.sku == seed.DEMO_SKU))
    stock.record_movement(db, pen_id, "OUT", 20)  # the live demo

    applied = {sku: (on_hand, target) for sku, on_hand, target in seed.demo_reset(db)}
    on_hand, target = applied[seed.DEMO_SKU]
    assert on_hand < target
    assert stock.current_on_hand(db, pen_id) == target
    movements = movement_count(db)
    assert all(on_hand == target for _, on_hand, target in seed.demo_reset(db))
    assert movement_count(db) == movements


def test_prestart_exits_nonzero_when_db_unreachable(override_settings, capsys):
    # The default timeout comes from settings at call time, not at import.
    override_settings(database_url=UNREACHABLE_URL, db_wait_timeout_s=1)
    with pytest.raises(SystemExit) as exited:
        prestart.wait_for_db()
    assert str(exited.value.code).startswith("database not reachable after 1s")
    assert "waiting for database: OperationalError" in capsys.readouterr().out


def test_wait_for_db_returns_once_database_answers(override_settings):
    override_settings(database_url="sqlite+pysqlite:///:memory:")
    assert prestart.wait_for_db(timeout_s=1) is None


def test_wait_for_db_exits_after_timeout(override_settings):
    override_settings(database_url=UNREACHABLE_URL)
    started = time.monotonic()
    with pytest.raises(SystemExit):
        prestart.wait_for_db(timeout_s=0)
    assert time.monotonic() - started < 2
