"""app.services.stock: pure stock maths first, then the ledger service on the test database.

test_on_hand_is_sum_of_movements is the PR-A anchor: the CI evidence branch flips its
expected value to prove a failing test blocks the images. Keep its name.
"""

from datetime import UTC, date, datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select
from sqlalchemy.dialects import postgresql, sqlite

from app.models import Product, StockMovement
from app.services.stock import (
    InsufficientStock,
    MovementNotFound,
    NegativeStockOnUndo,
    ProductNotFound,
    as_utc,
    bucket_daily,
    current_on_hand,
    daily_out_series,
    days_of_cover,
    demand_snapshot,
    get_stock_row,
    has_movements,
    inventory_summary,
    list_movements,
    list_stock,
    lock_stmt,
    movement_delta,
    on_hand_from_deltas,
    recent_movements,
    record_movement,
    sku_exists,
    undo_movement,
    utcnow,
    value_paise,
)

IST = timezone(timedelta(hours=5, minutes=30))


# Pure maths


def test_on_hand_is_sum_of_movements():
    assert on_hand_from_deltas([160, -20, -5, 3]) == 139
    assert on_hand_from_deltas([]) == 0


@pytest.mark.parametrize("on_hand", [0, 50])
def test_days_of_cover_none_when_no_demand(on_hand):
    # No OUT in 30 days: no cover figure, never a division by zero.
    assert days_of_cover(on_hand, 0) is None


@pytest.mark.parametrize(
    ("on_hand", "units_out_30d", "expected"),
    [
        (140, 210, 20.0),  # 7 a day
        (10, 120, 2.5),
        (0, 90, 0.0),
        (100, 7, 428.6),  # 428.571...
    ],
)
def test_days_of_cover_rounds_to_one_decimal(on_hand, units_out_30d, expected):
    assert days_of_cover(on_hand, units_out_30d) == expected


def test_value_paise_is_exact_integer_maths():
    # Float rupees drift (0.1 * 3 == 0.30000000000000004); integer paise never do.
    assert value_paise(3, 10) == 30
    assert isinstance(value_paise(3, 10), int)
    assert value_paise(140, 1050) == 147_000


@pytest.mark.parametrize(
    ("kind", "quantity", "delta"),
    [("IN", 5, 5), ("OUT", 5, -5), ("ADJUST", -3, -3), ("ADJUST", 4, 4)],
)
def test_movement_delta_signs(kind, quantity, delta):
    assert movement_delta(kind, quantity) == delta


@pytest.mark.parametrize(
    ("kind", "quantity"),
    [("IN", 0), ("IN", -1), ("OUT", 0), ("OUT", -2), ("ADJUST", 0), ("MOVE", 1)],
)
def test_movement_delta_rejects_invalid(kind, quantity):
    with pytest.raises(ValueError, match="invalid movement"):
        movement_delta(kind, quantity)


def test_as_utc_handles_naive_and_aware():
    noon_utc = datetime(2026, 10, 15, 12, 0, tzinfo=UTC)
    assert as_utc(datetime(2026, 10, 15, 12, 0)) == noon_utc
    assert as_utc(datetime(2026, 10, 15, 17, 30, tzinfo=IST)) == noon_utc
    assert as_utc(datetime(2026, 10, 15, 17, 30, tzinfo=IST)).tzinfo is UTC


def test_bucket_daily_keeps_zero_days():
    rows = [
        (datetime(2026, 10, 15, 23, 0), 4),  # naive = UTC
        (datetime(2026, 10, 13, 8, 0, tzinfo=UTC), 2),
        (datetime(2026, 10, 14, 2, 0, tzinfo=IST), 1),  # 13 Oct 20:30 UTC
        (datetime(2026, 10, 1), 99),  # before the window
        (datetime(2026, 10, 16, 1, 0, tzinfo=UTC), 99),  # after it
    ]
    assert bucket_daily(rows, 5, date(2026, 10, 15)) == [0, 0, 3, 0, 4]


def test_lock_statement_has_for_update_only_on_postgres():
    statement = lock_stmt(1)
    assert "FOR UPDATE" in str(statement.compile(dialect=postgresql.dialect()))
    assert "FOR UPDATE" not in str(statement.compile(dialect=sqlite.dialect()))


# The ledger service, on SQLite or (make test-pg) Postgres


def add_product(db, sku="PEN-001", **fields) -> Product:
    product = Product(
        **{
            "sku": sku,
            "name": "Reynolds pen (blue)",
            "category": "STATIONERY",
            "unit": "pcs",
            "unit_cost_paise": 1050,
            "reorder_point": 20,
            "lead_time_days": 7,
            **fields,
        }
    )
    db.add(product)
    db.commit()
    return product


def movement_count(db) -> int:
    return db.scalar(select(func.count()).select_from(StockMovement))


def test_record_in_then_out_returns_new_on_hand(db):
    pen = add_product(db)
    stock_in, on_hand = record_movement(db, pen.id, "IN", 160)
    assert (stock_in.delta, on_hand) == (160, 160)
    sale, on_hand = record_movement(db, pen.id, "OUT", 20, "counter sale")
    assert (sale.kind, sale.delta, sale.note, on_hand) == ("OUT", -20, "counter sale", 140)
    assert sale.created_at is not None  # server-set, loaded by the refresh
    assert current_on_hand(db, pen.id) == 140


def test_out_beyond_stock_raises_and_writes_nothing(db):
    pen = add_product(db)
    record_movement(db, pen.id, "IN", 10)
    with pytest.raises(InsufficientStock, match="Insufficient stock: on hand 10, requested 11"):
        record_movement(db, pen.id, "OUT", 11)
    assert current_on_hand(db, pen.id) == 10
    assert movement_count(db) == 1


def test_negative_adjust_beyond_stock_raises(db):
    pen = add_product(db)
    record_movement(db, pen.id, "IN", 12)
    with pytest.raises(InsufficientStock, match="on hand 12, requested 13"):
        record_movement(db, pen.id, "ADJUST", -13)
    assert record_movement(db, pen.id, "ADJUST", -12)[1] == 0


def test_movement_for_unknown_product_raises(db):
    with pytest.raises(ProductNotFound, match="Product not found"):
        record_movement(db, 999_999, "IN", 5)


def test_record_movement_rejects_naive_or_future_at(db):
    pen = add_product(db)
    with pytest.raises(ValueError, match="aware"):
        record_movement(db, pen.id, "IN", 5, at=datetime(2026, 1, 1))
    with pytest.raises(ValueError, match="future"):
        record_movement(db, pen.id, "IN", 5, at=utcnow() + timedelta(minutes=5))
    three_days_ago = utcnow() - timedelta(days=3)
    movement, _ = record_movement(db, pen.id, "IN", 5, at=three_days_ago.astimezone(IST))
    assert as_utc(movement.created_at) == three_days_ago
    assert movement_count(db) == 1


def test_undo_rederives_on_hand(db):
    pen = add_product(db)
    record_movement(db, pen.id, "IN", 100)
    sale, _ = record_movement(db, pen.id, "OUT", 30)
    assert undo_movement(db, sale.id) == 100
    assert current_on_hand(db, pen.id) == 100
    assert db.get(StockMovement, sale.id) is None


def test_undo_of_in_that_would_go_negative_raises(db):
    pen = add_product(db)
    stock_in, _ = record_movement(db, pen.id, "IN", 50)
    record_movement(db, pen.id, "OUT", 40)
    with pytest.raises(NegativeStockOnUndo, match="on hand 10, movement 50"):
        undo_movement(db, stock_in.id)
    assert db.get(StockMovement, stock_in.id) is not None
    assert current_on_hand(db, pen.id) == 10


def test_undo_missing_movement_raises(db):
    with pytest.raises(MovementNotFound, match="Movement not found"):
        undo_movement(db, 999_999)


def test_list_stock_aggregates_and_filters(db):
    now = utcnow()
    pen = add_product(db, "PEN-001")
    rice = add_product(
        db,
        "RICE-5KG",
        name="Basmati rice 5 kg",
        category="GROCERY",
        unit="kg",
        unit_cost_paise=60_000,
        reorder_point=5,
    )
    add_product(db, "TAG-100", name="Price tags 100% cotton", category="OTHER", reorder_point=0)
    record_movement(db, pen.id, "IN", 160)
    record_movement(db, pen.id, "OUT", 20)
    record_movement(db, rice.id, "IN", 3)

    rows = {row.product.sku: row for row in list_stock(db, now=now)}
    assert list(rows) == ["PEN-001", "RICE-5KG", "TAG-100"]  # ordered by sku
    assert (rows["PEN-001"].on_hand, rows["PEN-001"].movements_count) == (140, 2)
    assert rows["PEN-001"].value_paise == 147_000
    assert rows["PEN-001"].days_of_cover == 210.0  # 140 / (20 / 30)
    assert rows["TAG-100"].days_of_cover is None
    assert rows["TAG-100"].needs_reorder  # 0 <= 0

    def skus(**filters) -> list[str]:
        return [row.product.sku for row in list_stock(db, now=now, **filters)]

    assert skus(category="GROCERY") == ["RICE-5KG"]
    assert skus(q="REYN") == ["PEN-001"]  # name, any case
    assert skus(q="rice-5") == ["RICE-5KG"]  # sku, any case
    assert skus(q="%") == ["TAG-100"]  # a literal %, not a wildcard
    assert skus(q="") == ["PEN-001", "RICE-5KG", "TAG-100"]
    assert skus(below_reorder=True) == ["RICE-5KG", "TAG-100"]
    assert skus(limit=1, offset=1) == ["RICE-5KG"]


def test_lookups_and_ledger_listing(db):
    pen = add_product(db, "PEN-001")
    ink = add_product(db, "INK-001", name="Camlin ink 60 ml")
    first, _ = record_movement(db, pen.id, "IN", 10)
    second, _ = record_movement(db, ink.id, "IN", 5)
    third, _ = record_movement(db, pen.id, "OUT", 4)

    assert sku_exists(db, "PEN-001")
    assert not sku_exists(db, "PEN-002")
    assert has_movements(db, pen.id)
    assert get_stock_row(db, pen.id, utcnow()).on_hand == 6
    with pytest.raises(ProductNotFound):
        get_stock_row(db, 999_999, utcnow())

    ledger = list_movements(db)
    assert [row.id for row in ledger] == [third.id, second.id, first.id]  # newest first
    assert (ledger[0].sku, ledger[0].product_name, ledger[0].unit) == (
        "PEN-001",
        "Reynolds pen (blue)",
        "pcs",
    )
    assert [row.id for row in list_movements(db, product_id=pen.id, kind="OUT")] == [third.id]
    assert [row.id for row in list_movements(db, limit=1, offset=1)] == [second.id]
    assert [row.id for row in recent_movements(db, pen.id, limit=1)] == [third.id]


def test_inventory_summary_windows(db):
    now = utcnow()
    pen = add_product(db, "PEN-001", reorder_point=80)
    glue = add_product(db, "GLUE-01", name="Fevicol 50 g", unit_cost_paise=2000, reorder_point=0)
    tape = add_product(db, "TAPE-01", name="Cello tape", unit_cost_paise=500, reorder_point=0)
    record_movement(db, pen.id, "IN", 100, at=now - timedelta(days=45))
    record_movement(db, pen.id, "ADJUST", -1, at=now - timedelta(days=40))
    record_movement(db, pen.id, "OUT", 11, at=now - timedelta(days=10))  # outside 7 days
    record_movement(db, pen.id, "OUT", 7, at=now - timedelta(days=3))  # in 7 days, not 24 h
    record_movement(db, pen.id, "OUT", 5, at=now - timedelta(hours=2))  # in both windows
    record_movement(db, glue.id, "IN", 30, at=now - timedelta(days=20))
    record_movement(db, glue.id, "OUT", 12, at=now - timedelta(days=1, hours=1))
    record_movement(db, tape.id, "IN", 40, at=now - timedelta(days=20))
    record_movement(db, tape.id, "OUT", 20, at=now - timedelta(days=6))

    summary = inventory_summary(db, now)
    assert summary["inventory_value_paise"] == 76 * 1050 + 18 * 2000 + 20 * 500
    assert summary["product_count"] == 3
    assert summary["items_below_reorder"] == 1  # the pen: 76 <= 80
    assert summary["movements_24h"] == 1
    assert summary["units_out_7d"] == 7 + 5 + 12 + 20
    assert [(m["sku"], m["units_out_7d"]) for m in summary["top_movers"]] == [
        ("TAPE-01", 20),
        ("GLUE-01", 12),  # ties on units are ordered by sku
        ("PEN-001", 12),
    ]
    assert set(summary["top_movers"][0]) == {"product_id", "sku", "name", "unit", "units_out_7d"}


def test_inventory_summary_of_empty_database(db):
    assert inventory_summary(db, utcnow()) == {
        "inventory_value_paise": 0,
        "product_count": 0,
        "items_below_reorder": 0,
        "movements_24h": 0,
        "units_out_7d": 0,
        "top_movers": [],
    }


def test_daily_out_series_window(db):
    now = utcnow()
    pen = add_product(db, "PEN-001")
    ink = add_product(db, "INK-001")
    record_movement(db, pen.id, "IN", 100, at=now - timedelta(days=40))
    record_movement(db, pen.id, "OUT", 9, at=now - timedelta(days=40))  # before the window
    record_movement(db, pen.id, "OUT", 4, at=now - timedelta(days=2))
    record_movement(db, pen.id, "OUT", 3, at=now)
    record_movement(db, pen.id, "ADJUST", -1, at=now)  # not demand

    series = daily_out_series(db, now, 30, [pen.id, ink.id])
    assert series[ink.id] == [0] * 30
    assert len(series[pen.id]) == 30
    assert (series[pen.id][27], series[pen.id][29], sum(series[pen.id])) == (4, 3, 7)
    # Without ids: only the products that had OUT movements in the window.
    assert daily_out_series(db, now, 30) == {pen.id: series[pen.id]}


def test_demand_snapshot_keeps_back_dated_history_and_zero_days(db):
    now = utcnow()
    pen = add_product(db, "PEN-001")
    ink = add_product(db, "INK-001")  # never moved
    record_movement(db, pen.id, "IN", 100, at=now - timedelta(days=50))
    # Older than the product row itself: the seed back-dates movements, never products.
    record_movement(db, pen.id, "OUT", 9, at=now - timedelta(days=40))
    record_movement(db, pen.id, "OUT", 4, at=now)

    pen_snap, ink_snap = demand_snapshot(db, now)  # ordered by product id
    assert (pen_snap.product_id, ink_snap.product_id) == (pen.id, ink.id)
    assert (pen_snap.on_hand, pen_snap.reorder_point, pen_snap.lead_time_days) == (87, 20, 7)
    assert len(pen_snap.daily_out) == 60
    assert (pen_snap.daily_out[19], pen_snap.daily_out[59], sum(pen_snap.daily_out)) == (9, 4, 13)
    assert (ink_snap.on_hand, ink_snap.daily_out) == (0, (0,) * 60)
