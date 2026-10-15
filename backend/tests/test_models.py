from datetime import datetime, timedelta

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.schema import CreateIndex, CreateTable

from app.db import Base
from app.models import Product, StockMovement
from app.services.stock import as_utc, utcnow

EXPECTED_NAMES = {
    "pk_products",
    "uq_products_sku",
    "ck_products_category_valid",
    "ck_products_unit_valid",
    "ck_products_unit_cost_positive",
    "ck_products_reorder_point_nonneg",
    "ck_products_lead_time_range",
    "pk_stock_movements",
    "fk_stock_movements_product_id_products",
    "ck_stock_movements_kind_valid",
    "ck_stock_movements_delta_sign",
    "ix_stock_movements_product_id_id",
    "ix_stock_movements_created_at",
}
PEN = {
    "sku": "PEN-001",
    "name": "Reynolds pen (blue)",
    "category": "STATIONERY",
    "unit": "pcs",
    "unit_cost_paise": 1050,
    "reorder_point": 20,
    "lead_time_days": 7,
}
INVALID_ROWS = {
    "unit_cost_zero": (Product, {"unit_cost_paise": 0}),
    "reorder_point_negative": (Product, {"reorder_point": -1}),
    "lead_time_0": (Product, {"lead_time_days": 0}),
    "lead_time_61": (Product, {"lead_time_days": 61}),
    "category_toys": (Product, {"category": "TOYS"}),
    "unit_dozen": (Product, {"unit": "dozen"}),
    "duplicate_sku": (Product, {"sku": "PEN-001"}),
    "kind_sale": (StockMovement, {"kind": "SALE"}),
    "in_with_negative_delta": (StockMovement, {"kind": "IN", "delta": -1}),
    "out_with_positive_delta": (StockMovement, {"kind": "OUT", "delta": 1}),
    "adjust_of_zero": (StockMovement, {"kind": "ADJUST", "delta": 0}),
    "orphan_product_id": (StockMovement, {"product_id": 999_999}),
}


def test_constraint_and_index_names_follow_convention():
    tables = Base.metadata.sorted_tables
    names = {c.name for t in tables for c in t.constraints}
    names |= {i.name for t in tables for i in t.indexes}
    assert names == EXPECTED_NAMES
    dialect = postgresql.dialect()
    ddl = "\n".join(
        [str(CreateTable(t).compile(dialect=dialect)) for t in tables]
        + [str(CreateIndex(i).compile(dialect=dialect)) for t in tables for i in t.indexes]
    )
    assert "ck_products_ck_" not in ddl
    assert "ck_stock_movements_ck_" not in ddl
    assert "CREATE TYPE" not in ddl  # no native ENUMs
    assert "ON DELETE RESTRICT" in ddl


@pytest.mark.parametrize(("model", "changes"), INVALID_ROWS.values(), ids=INVALID_ROWS.keys())
def test_db_rejects_invalid_rows(db, model, changes):
    product = Product(**PEN)
    db.add(product)
    db.flush()
    valid = {
        Product: {**PEN, "sku": "PEN-002"},
        StockMovement: {"product_id": product.id, "kind": "IN", "delta": 5},
    }[model]
    db.add(model(**{**valid, **changes}))
    with pytest.raises(IntegrityError):
        db.flush()


def test_fk_restrict_blocks_deleting_product_with_movements(db):
    product = Product(**PEN)
    db.add(product)
    db.flush()
    db.add(StockMovement(product_id=product.id, kind="IN", delta=5))
    db.flush()
    db.delete(product)
    with pytest.raises(IntegrityError):
        db.flush()


def test_created_at_is_server_set(db):
    product = Product(**PEN)
    db.add(product)
    db.commit()
    db.refresh(product)
    assert isinstance(product.created_at, datetime)
    assert abs(as_utc(product.created_at) - utcnow()) < timedelta(minutes=1)
