"""The two Alembic-managed tables. Stock is never stored: on_hand = SUM(stock_movements.delta)."""

from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

CATEGORIES = ("STATIONERY", "ELECTRONICS", "GROCERY", "PERSONAL_CARE", "HOUSEHOLD", "OTHER")
UNITS = ("pcs", "box", "pack", "kg", "litre")
KINDS = ("IN", "OUT", "ADJUST")


def _one_of(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


# CHECK constraints take short names; the naming convention renders ck_<table>_<name>.
# No native ENUM types and no ORM relationships: joins are explicit.
class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint(_one_of("category", CATEGORIES), name="category_valid"),
        CheckConstraint(_one_of("unit", UNITS), name="unit_valid"),
        CheckConstraint("unit_cost_paise > 0", name="unit_cost_positive"),
        CheckConstraint("reorder_point >= 0", name="reorder_point_nonneg"),
        CheckConstraint("lead_time_days BETWEEN 1 AND 60", name="lead_time_range"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sku: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(16))
    unit: Mapped[str] = mapped_column(String(8))
    unit_cost_paise: Mapped[int] = mapped_column(Integer)
    reorder_point: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    lead_time_days: Mapped[int] = mapped_column(SmallInteger, server_default=text("7"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StockMovement(Base):
    __tablename__ = "stock_movements"
    __table_args__ = (
        CheckConstraint(_one_of("kind", KINDS), name="kind_valid"),
        CheckConstraint(
            "(kind = 'IN' AND delta > 0) OR (kind = 'OUT' AND delta < 0) "
            "OR (kind = 'ADJUST' AND delta <> 0)",
            name="delta_sign",
        ),
        Index("ix_stock_movements_product_id_id", "product_id", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"))
    kind: Mapped[str] = mapped_column(String(8))
    delta: Mapped[int] = mapped_column(Integer)
    note: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
