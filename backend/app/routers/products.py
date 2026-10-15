"""Products CRUD. Stock fields (on_hand, value, days of cover) are derived from the ledger."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Product
from app.schemas import (
    Category,
    DemandStats,
    MovementOut,
    ProductCreate,
    ProductDetail,
    ProductStock,
    ProductUpdate,
)
from app.services import stock

router = APIRouter(prefix="/products", tags=["products"])
DB = Annotated[Session, Depends(get_db)]

NOT_FOUND = {404: {"description": "Product not found"}}
DEMAND_DAYS = 30


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Product not found")


def _stock_row(db: Session, product_id: int, now: datetime) -> stock.StockRow:
    try:
        return stock.get_stock_row(db, product_id, now)
    except stock.ProductNotFound:
        raise _not_found() from None


@router.get("")
def list_products(
    db: DB,
    category: Category | None = None,
    q: Annotated[
        str | None, Query(max_length=50, description="Case-insensitive match on SKU or name")
    ] = None,
    below_reorder: Annotated[bool, Query(description="Only on_hand <= reorder_point")] = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[ProductStock]:
    """Products ordered by SKU, each with its live stock figures."""
    rows = stock.list_stock(
        db,
        category=category,
        q=q,
        below_reorder=below_reorder,
        limit=limit,
        offset=offset,
        now=stock.utcnow(),
    )
    return [ProductStock.from_row(row) for row in rows]


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    responses={409: {"description": "SKU already exists"}},
)
def create_product(body: ProductCreate, db: DB) -> ProductStock:
    """Create a product. The SKU is stored upper-case, so it is unique in any case."""
    if stock.sku_exists(db, body.sku):
        raise HTTPException(status.HTTP_409_CONFLICT, "SKU already exists")
    product = Product(**body.model_dump())
    db.add(product)
    try:
        db.commit()
    except IntegrityError:
        # Only a concurrent insert of the same SKU gets past the pre-check, so the exception
        # is never inspected: SQLite raises the same class for every constraint.
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "SKU already exists") from None
    return ProductStock.from_row(_stock_row(db, product.id, stock.utcnow()))


@router.get("/{product_id}", responses=NOT_FOUND)
def get_product(product_id: int, db: DB) -> ProductDetail:
    """One product with its last 20 movements and its OUT demand over the last 30 days."""
    now = stock.utcnow()
    row = _stock_row(db, product_id, now)
    daily_out = stock.daily_out_series(db, now, DEMAND_DAYS, [product_id])[product_id]
    total_out = sum(daily_out)
    return ProductDetail(
        **ProductStock.from_row(row).model_dump(),
        recent_movements=[
            MovementOut.model_validate(movement)
            for movement in stock.recent_movements(db, product_id)
        ],
        demand_30d=DemandStats(
            total_out=total_out,
            avg_daily_out=round(total_out / DEMAND_DAYS, 2),
            daily_out=daily_out,
        ),
    )


@router.put("/{product_id}", responses=NOT_FOUND)
def update_product(product_id: int, body: ProductUpdate, db: DB) -> ProductStock:
    """Change any field except the SKU. Omitted fields keep their value."""
    product = db.get(Product, product_id)
    if product is None:
        raise _not_found()
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(product, field, value)
    db.commit()
    return ProductStock.from_row(_stock_row(db, product_id, stock.utcnow()))


@router.delete(
    "/{product_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={**NOT_FOUND, 409: {"description": "The product has stock movements"}},
)
def delete_product(product_id: int, db: DB) -> None:
    """Delete a product with no stock movements. A product with history is kept (409)."""
    try:
        # The same row lock a movement takes first, so no movement can land between the
        # check and the delete.
        product = stock.lock_product(db, product_id)
    except stock.ProductNotFound:
        raise _not_found() from None
    # An explicit check, never the FK error: SQLite gives no distinguishable IntegrityError.
    if stock.has_movements(db, product_id):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Product has stock movements and cannot be deleted"
        )
    db.delete(product)
    db.commit()
