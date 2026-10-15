from datetime import datetime, timedelta, timezone
from typing import get_args

import pytest
from pydantic import ValidationError

from app.models import CATEGORIES, KINDS, UNITS, Product
from app.schemas import (
    Category,
    Kind,
    MovementCreate,
    MovementOut,
    ProductCreate,
    ProductStock,
    ProductUpdate,
    Unit,
)
from app.services.stock import StockRow

VALID_PRODUCT = {
    "sku": "PEN-001",
    "name": "Reynolds pen (blue)",
    "category": "STATIONERY",
    "unit": "pcs",
    "unit_cost_paise": 1050,
    "reorder_point": 20,
    "lead_time_days": 7,
}
UPDATABLE = ["name", "category", "unit", "unit_cost_paise", "reorder_point", "lead_time_days"]
IST = timezone(timedelta(hours=5, minutes=30))


def test_sku_is_upper_cased_before_pattern():
    assert ProductCreate.model_validate({**VALID_PRODUCT, "sku": " abc-12 "}).sku == "ABC-12"


def test_product_create_strips_name_and_defaults_stock_policy():
    payload = {**VALID_PRODUCT, "name": "  Classmate notebook  "}
    for optional in ("reorder_point", "lead_time_days"):
        del payload[optional]
    product = ProductCreate.model_validate(payload)
    assert product.name == "Classmate notebook"
    assert (product.reorder_point, product.lead_time_days) == (0, 7)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("sku", "ab"),
        ("sku", "AB CD"),
        ("sku", "A" * 21),
        ("name", "   "),
        ("name", "x" * 121),
        ("category", "TOYS"),
        ("unit", "dozen"),
        ("unit_cost_paise", 0),
        ("unit_cost_paise", 10.5),
        ("reorder_point", -1),
        ("lead_time_days", 0),
        ("lead_time_days", 61),
        ("on_hand", 5),  # derived, never accepted
        ("created_at", "2026-10-15T00:00:00Z"),  # server-set only
    ],
)
def test_invalid_product_payloads_rejected(field, value):
    with pytest.raises(ValidationError):
        ProductCreate.model_validate({**VALID_PRODUCT, field: value})


@pytest.mark.parametrize("field", UPDATABLE)
def test_product_update_rejects_explicit_null(field):
    with pytest.raises(ValidationError, match=f"{field} may not be null"):
        ProductUpdate.model_validate({field: None})


def test_product_update_omitted_fields_dump_empty():
    assert ProductUpdate().model_dump(exclude_unset=True) == {}
    update = ProductUpdate.model_validate({"name": " Gel pen ", "reorder_point": 0})
    assert update.model_dump(exclude_unset=True) == {"name": "Gel pen", "reorder_point": 0}


@pytest.mark.parametrize("field", ["sku", "created_at", "on_hand"])
def test_product_update_forbids_sku(field):
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        ProductUpdate.model_validate({field: "PEN-002"})


@pytest.mark.parametrize(
    ("kind", "quantity", "accepted"),
    [
        ("IN", 5, True),
        ("OUT", 5, True),
        ("ADJUST", -3, True),
        ("ADJUST", 4, True),
        ("IN", 0, False),
        ("IN", -5, False),
        ("OUT", -5, False),
        ("ADJUST", 0, False),
        ("IN", 100_001, False),
    ],
)
def test_movement_quantity_rules(kind, quantity, accepted):
    payload = {"product_id": 1, "kind": kind, "quantity": quantity}
    if accepted:
        assert MovementCreate.model_validate(payload).quantity == quantity
    else:
        with pytest.raises(ValidationError, match="quantity"):
            MovementCreate.model_validate(payload)


@pytest.mark.parametrize(
    "payload",
    [
        {"product_id": 0, "kind": "IN", "quantity": 1},
        {"product_id": 1, "kind": "SALE", "quantity": 1},
        {"product_id": 1, "kind": "IN", "quantity": 1, "note": "x" * 121},
        {"product_id": 1, "kind": "IN", "quantity": 1, "created_at": "2026-10-15T00:00:00Z"},
    ],
)
def test_invalid_movement_payloads_rejected(payload):
    with pytest.raises(ValidationError):
        MovementCreate.model_validate(payload)


@pytest.mark.parametrize("note", ["", "   ", None])
def test_note_blank_becomes_none(note):
    assert MovementCreate(product_id=1, kind="IN", quantity=1, note=note).note is None
    assert MovementCreate(product_id=1, kind="IN", quantity=1, note=" restock ").note == "restock"


def test_literals_match_model_constants():
    assert get_args(Category) == CATEGORIES
    assert get_args(Unit) == UNITS
    assert get_args(Kind) == KINDS


@pytest.mark.parametrize(
    "created_at",
    [datetime(2026, 10, 15, 12, 30), datetime(2026, 10, 15, 18, 0, tzinfo=IST)],
    ids=["naive-sqlite", "aware-postgres"],
)
def test_utc_datetime_serialises_with_z(created_at):
    movement = MovementOut(
        id=1,
        product_id=1,
        sku="PEN-001",
        product_name="Reynolds pen (blue)",
        unit="pcs",
        kind="IN",
        delta=5,
        note=None,
        created_at=created_at,
    )
    assert movement.model_dump(mode="json")["created_at"] == "2026-10-15T12:30:00.000Z"


def test_product_stock_from_row_derives_fields():
    product = Product(id=1, created_at=datetime(2026, 10, 1, 9, 0), **VALID_PRODUCT)
    stock = ProductStock.from_row(StockRow(product, on_hand=140, movements_count=2, out_30d=20))
    assert stock.sku == "PEN-001"
    assert stock.value_paise == 147_000
    assert stock.days_of_cover == 210.0
    assert stock.needs_reorder is False
    assert ProductStock.from_row(StockRow(product, 20, 3, 0)).needs_reorder is True
