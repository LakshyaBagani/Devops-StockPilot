"""The summary line for the owner and the accountant."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import SummaryOut
from app.services import stock

router = APIRouter(prefix="/summary", tags=["summary"])
DB = Annotated[Session, Depends(get_db)]


@router.get("")
def get_summary(db: DB) -> SummaryOut:
    """Stock value, products at or below their reorder point, the last 24 h and 7 days of
    activity, and the top 5 products by units out in 7 days."""
    return SummaryOut.model_validate(stock.inventory_summary(db, now=stock.utcnow()))
