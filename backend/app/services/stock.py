"""Derived stock: pure helpers, the row-locked movement service and aggregate queries.

Stock is never stored: on_hand = SUM(stock_movements.delta), so the ledger is the audit trail.
Time windows are SQL filters with bound aware-UTC cutoffs, because SQLite loads datetimes naive
and Postgres aware; Python only compares or buckets them after as_utc(). No FastAPI and no
metrics here: routers own the HTTP mapping and the counters.
"""

from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import Row, Select, and_, case, exists, func, or_, select
from sqlalchemy.orm import Session

from app.models import Product, StockMovement
from app.services.planner import ProductSnapshot

ON_HAND = func.coalesce(func.sum(StockMovement.delta), 0)
UNITS_OUT = func.coalesce(func.sum(-StockMovement.delta), 0)  # only over kind = 'OUT' rows


class StockError(Exception):
    """A domain error that routers map to an HTTP response; str() is the API detail."""


class ProductNotFound(StockError):
    def __init__(self, product_id: int) -> None:
        super().__init__("Product not found")
        self.product_id = product_id


class MovementNotFound(StockError):
    def __init__(self, movement_id: int) -> None:
        super().__init__("Movement not found")
        self.movement_id = movement_id


class InsufficientStock(StockError):
    def __init__(self, on_hand: int, requested: int) -> None:
        super().__init__(f"Insufficient stock: on hand {on_hand}, requested {requested}")
        self.on_hand = on_hand
        self.requested = requested


class NegativeStockOnUndo(StockError):
    def __init__(self, on_hand: int, delta: int) -> None:
        super().__init__(f"Undo would make stock negative: on hand {on_hand}, movement {delta}")
        self.on_hand = on_hand
        self.delta = delta


# Pure helpers


def utcnow() -> datetime:
    """The single clock for windows and back-dating (tests monkeypatch it)."""
    return datetime.now(UTC)


def as_utc(dt: datetime) -> datetime:
    """Naive values are UTC (SQLite stores UTC wall time); aware values are converted to UTC."""
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


def movement_delta(kind: str, quantity: int) -> int:
    """Signed ledger delta: IN +q and OUT -q need q > 0; ADJUST is signed and never 0."""
    if kind == "IN" and quantity > 0:
        return quantity
    if kind == "OUT" and quantity > 0:
        return -quantity
    if kind == "ADJUST" and quantity != 0:
        return quantity
    raise ValueError(f"invalid movement: {kind} {quantity}")


def on_hand_from_deltas(deltas: Iterable[int]) -> int:
    return sum(deltas)


def value_paise(on_hand: int, unit_cost_paise: int) -> int:
    """Stock value in integer paise: exact, unlike float rupees (0.1 * 3 != 0.3)."""
    return on_hand * unit_cost_paise


def days_of_cover(on_hand: int, units_out: int, window_days: int = 30) -> float | None:
    """Days the stock lasts at the window's average OUT rate; None when there was no demand."""
    if units_out == 0:
        return None
    return round(on_hand / (units_out / window_days), 1)


def bucket_daily(rows: Iterable[tuple[datetime, int]], days: int, today: date) -> list[int]:
    """Units per UTC day, oldest to today. Zero days are kept; rows outside the window ignored."""
    buckets = [0] * days
    first_day = today - timedelta(days=days - 1)
    for created_at, units in rows:
        index = (as_utc(created_at).date() - first_day).days
        if 0 <= index < days:
            buckets[index] += units
    return buckets


# Movement service: lock the product row, then sum, then check, then write


def lock_stmt(product_id: int) -> Select[tuple[Product]]:
    """SELECT ... FOR UPDATE on Postgres. SQLite emits no lock clause (it has a single writer)."""
    return select(Product).where(Product.id == product_id).with_for_update()


def lock_product(db: Session, product_id: int) -> Product:
    product = db.scalars(lock_stmt(product_id)).one_or_none()
    if product is None:
        raise ProductNotFound(product_id)
    return product


def current_on_hand(db: Session, product_id: int) -> int:
    # A separate statement after the lock: a SUM subquery inside the locking statement would
    # take its snapshot before waiting for the lock, and could still oversell.
    return db.scalar(select(ON_HAND).where(StockMovement.product_id == product_id))


def record_movement(
    db: Session,
    product_id: int,
    kind: str,
    quantity: int,
    note: str | None = None,
    *,
    at: datetime | None = None,
    commit: bool = True,
) -> tuple[StockMovement, int]:
    """Append one ledger row and return it with the new on-hand.

    `at` back-dates the row (the seed only); it must be aware and not in the future. With
    commit=False the caller owns the transaction, but the row is flushed so later sums see it.
    """
    delta = movement_delta(kind, quantity)
    if at is not None and (at.tzinfo is None or at > utcnow()):
        raise ValueError("at must be an aware datetime that is not in the future")
    lock_product(db, product_id)
    on_hand = current_on_hand(db, product_id)
    if on_hand + delta < 0:
        db.rollback()  # releases the row lock before the caller sees the error
        raise InsufficientStock(on_hand, -delta)
    movement = StockMovement(product_id=product_id, kind=kind, delta=delta, note=note)
    if at is not None:
        movement.created_at = as_utc(at)
    db.add(movement)
    db.flush()
    if commit:
        db.commit()
        db.refresh(movement)  # loads the server-set created_at on both dialects
    return movement, on_hand + delta


def undo_movement(db: Session, movement_id: int, *, commit: bool = True) -> int:
    """Delete a mistaken ledger row and return the new on-hand; refuses to go below zero."""
    movement = db.get(StockMovement, movement_id)
    if movement is None:
        raise MovementNotFound(movement_id)
    delta = movement.delta  # ledger rows are never edited, so this cannot change
    lock_product(db, movement.product_id)
    # Re-check under the lock: a concurrent undo may have deleted the row while this one waited.
    if db.scalar(select(StockMovement.id).where(StockMovement.id == movement_id)) is None:
        db.rollback()
        raise MovementNotFound(movement_id)
    on_hand = current_on_hand(db, movement.product_id)
    if on_hand - delta < 0:
        db.rollback()
        raise NegativeStockOnUndo(on_hand, delta)
    db.delete(movement)
    db.flush()
    if commit:
        db.commit()
    return on_hand - delta


# Read side: aggregates with portable SQL


@dataclass(frozen=True, slots=True)
class StockRow:
    product: Product
    on_hand: int
    movements_count: int
    out_30d: int

    @property
    def value_paise(self) -> int:
        return value_paise(self.on_hand, self.product.unit_cost_paise)

    @property
    def days_of_cover(self) -> float | None:
        return days_of_cover(self.on_hand, self.out_30d)

    @property
    def needs_reorder(self) -> bool:
        return self.on_hand <= self.product.reorder_point


def stock_select(cutoff: datetime) -> Select[tuple[Product, int, int, int]]:
    """Every product with on_hand, movements_count and OUT units since `cutoff` (aware UTC)."""
    out_since_cutoff = case(
        (
            and_(StockMovement.kind == "OUT", StockMovement.created_at >= cutoff),
            -StockMovement.delta,
        ),
        else_=0,
    )
    return (
        select(
            Product,
            ON_HAND.label("on_hand"),
            func.count(StockMovement.id).label("movements_count"),
            func.coalesce(func.sum(out_since_cutoff), 0).label("out_30d"),
        )
        .outerjoin(StockMovement, StockMovement.product_id == Product.id)
        .group_by(Product.id)
    )


def list_stock(
    db: Session,
    *,
    category: str | None = None,
    q: str | None = None,
    below_reorder: bool = False,
    limit: int = 50,
    offset: int = 0,
    now: datetime,
) -> list[StockRow]:
    stmt = stock_select(now - timedelta(days=30))
    if category:
        stmt = stmt.where(Product.category == category)
    if q:
        stmt = stmt.where(
            or_(
                Product.sku.icontains(q, autoescape=True),
                Product.name.icontains(q, autoescape=True),
            )
        )
    if below_reorder:
        stmt = stmt.having(Product.reorder_point >= ON_HAND)
    stmt = stmt.order_by(Product.sku, Product.id).limit(limit).offset(offset)
    return [StockRow(*row) for row in db.execute(stmt)]


def get_stock_row(db: Session, product_id: int, now: datetime) -> StockRow:
    stmt = stock_select(now - timedelta(days=30)).where(Product.id == product_id)
    row = db.execute(stmt).one_or_none()
    if row is None:
        raise ProductNotFound(product_id)
    return StockRow(*row)


def has_movements(db: Session, product_id: int) -> bool:
    return db.scalar(select(exists().where(StockMovement.product_id == product_id)))


def sku_exists(db: Session, sku: str) -> bool:
    return db.scalar(select(exists().where(Product.sku == sku)))


def _movement_select() -> Select[Any]:
    """Ledger rows with the product's sku, name and unit (the MovementOut fields)."""
    return select(
        StockMovement.id,
        StockMovement.product_id,
        Product.sku,
        Product.name.label("product_name"),
        Product.unit,
        StockMovement.kind,
        StockMovement.delta,
        StockMovement.note,
        StockMovement.created_at,
    ).join(Product, Product.id == StockMovement.product_id)


def list_movements(
    db: Session,
    *,
    product_id: int | None = None,
    kind: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[Row[Any]]:
    """Newest first by id: SQLite timestamps have 1-second resolution, ids never tie."""
    stmt = _movement_select()
    if product_id is not None:
        stmt = stmt.where(StockMovement.product_id == product_id)
    if kind is not None:
        stmt = stmt.where(StockMovement.kind == kind)
    return list(db.execute(stmt.order_by(StockMovement.id.desc()).limit(limit).offset(offset)))


def get_movement(db: Session, movement_id: int) -> Row[Any]:
    row = db.execute(_movement_select().where(StockMovement.id == movement_id)).one_or_none()
    if row is None:
        raise MovementNotFound(movement_id)
    return row


def recent_movements(db: Session, product_id: int, limit: int = 20) -> list[Row[Any]]:
    return list_movements(db, product_id=product_id, limit=limit)


def daily_out_series(
    db: Session, now: datetime, days: int, product_ids: Sequence[int] | None = None
) -> dict[int, list[int]]:
    """OUT units per UTC day (oldest to today) per product: every requested id, else every
    product with OUT rows in the window."""
    today = as_utc(now).date()
    window_start = datetime.combine(today - timedelta(days=days - 1), time.min, tzinfo=UTC)
    stmt = select(StockMovement.product_id, StockMovement.created_at, -StockMovement.delta).where(
        StockMovement.kind == "OUT", StockMovement.created_at >= window_start
    )
    if product_ids is not None:
        stmt = stmt.where(StockMovement.product_id.in_(product_ids))
    rows: defaultdict[int, list[tuple[datetime, int]]] = defaultdict(list)
    for product_id, created_at, units in db.execute(stmt):
        rows[product_id].append((created_at, units))
    ids = rows.keys() if product_ids is None else product_ids
    return {product_id: bucket_daily(rows[product_id], days, today) for product_id in ids}


def inventory_summary(db: Session, now: datetime) -> dict[str, Any]:
    """The SummaryOut fields: value, counts, the 24 h and 7 d windows and the top 5 movers."""
    stock = [StockRow(*row) for row in db.execute(stock_select(now - timedelta(days=30)))]
    week_ago = now - timedelta(days=7)
    top_movers = db.execute(
        select(
            Product.id.label("product_id"),
            Product.sku,
            Product.name,
            Product.unit,
            UNITS_OUT.label("units_out_7d"),
        )
        .join(StockMovement, StockMovement.product_id == Product.id)
        .where(StockMovement.kind == "OUT", StockMovement.created_at >= week_ago)
        .group_by(Product.id)
        .order_by(UNITS_OUT.desc(), Product.sku)
        .limit(5)
    ).all()
    return {
        "inventory_value_paise": sum(row.value_paise for row in stock),
        "product_count": len(stock),
        "items_below_reorder": sum(row.needs_reorder for row in stock),
        "movements_24h": db.scalar(
            select(func.count(StockMovement.id)).where(
                StockMovement.created_at >= now - timedelta(hours=24)
            )
        ),
        "units_out_7d": db.scalar(
            select(UNITS_OUT).where(
                StockMovement.kind == "OUT", StockMovement.created_at >= week_ago
            )
        ),
        "top_movers": [dict(row._mapping) for row in top_movers],
    }


def demand_snapshot(db: Session, now: datetime, days: int = 60) -> list[ProductSnapshot]:
    """Every product as the planner sees it, ordered by id: on-hand plus `days` daily OUT totals.

    History is not trimmed by products.created_at: the seed back-dates movements, not products.
    """
    stock = db.execute(
        select(Product, ON_HAND)
        .outerjoin(StockMovement, StockMovement.product_id == Product.id)
        .group_by(Product.id)
        .order_by(Product.id)
    ).all()
    series = daily_out_series(db, now, days)
    return [
        ProductSnapshot(
            product_id=product.id,
            sku=product.sku,
            name=product.name,
            unit=product.unit,
            on_hand=on_hand,
            reorder_point=product.reorder_point,
            lead_time_days=product.lead_time_days,
            daily_out=tuple(series.get(product.id, [0] * days)),
        )
        for product, on_hand in stock
    ]
