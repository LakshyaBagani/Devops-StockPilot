"""The stock ledger: record, list, get and undo movements. Rows are never edited, only undone."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.metrics import INSUFFICIENT_STOCK, MOVEMENTS, UNDO, UNITS_MOVED
from app.schemas import Kind, MovementCreate, MovementCreated, MovementOut
from app.services import stock

router = APIRouter(prefix="/movements", tags=["movements"])
DB = Annotated[Session, Depends(get_db)]


@router.get("")
def list_movements(
    db: DB,
    product_id: Annotated[int | None, Query(gt=0)] = None,
    kind: Kind | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[MovementOut]:
    """The ledger, newest first."""
    rows = stock.list_movements(db, product_id=product_id, kind=kind, limit=limit, offset=offset)
    return [MovementOut.model_validate(row) for row in rows]


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    responses={404: {"description": "Product not found"}},
)
def record_movement(body: MovementCreate, db: DB) -> MovementCreated:
    """Record a delivery (IN), a sale (OUT) or a correction (ADJUST) and return the new on_hand.

    A movement that would take stock below zero is refused with 422.
    """
    try:
        movement, on_hand = stock.record_movement(
            db, body.product_id, body.kind, body.quantity, body.note
        )
    except stock.ProductNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from None
    except stock.InsufficientStock as exc:
        INSUFFICIENT_STOCK.inc()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from None
    # Counted only now that the row is committed, so a refused movement never counts.
    MOVEMENTS.labels(body.kind).inc()
    UNITS_MOVED.labels(body.kind).inc(abs(movement.delta))
    row = stock.get_movement(db, movement.id)
    return MovementCreated(**row._mapping, on_hand=on_hand)


@router.get("/{movement_id}", responses={404: {"description": "Movement not found"}})
def get_movement(movement_id: int, db: DB) -> MovementOut:
    """One ledger row."""
    try:
        return MovementOut.model_validate(stock.get_movement(db, movement_id))
    except stock.MovementNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from None


@router.delete(
    "/{movement_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"description": "Movement not found"}},
)
def undo_movement(movement_id: int, db: DB) -> None:
    """Undo a mistaken entry by deleting it. Refused with 422 if stock would go below zero."""
    try:
        stock.undo_movement(db, movement_id)
    except stock.MovementNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from None
    except stock.NegativeStockOnUndo as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from None
    UNDO.inc()
