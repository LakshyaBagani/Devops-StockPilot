"""Request and response contracts (Pydantic v2). The frontend follows these shapes exactly."""

from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    PlainSerializer,
    StringConstraints,
    ValidationInfo,
    field_validator,
    model_validator,
)
from pydantic_core import PydanticCustomError

from app.services.stock import StockRow, as_utc

Category = Literal["STATIONERY", "ELECTRONICS", "GROCERY", "PERSONAL_CARE", "HOUSEHOLD", "OTHER"]
Unit = Literal["pcs", "box", "pack", "kg", "litre"]
Kind = Literal["IN", "OUT", "ADJUST"]


def _strip_upper(value: object) -> object:
    return value.strip().upper() if isinstance(value, str) else value


def _blank_to_none(value: object) -> object:
    return (value.strip() or None) if isinstance(value, str) else value


def _utc_iso(value: datetime) -> str:
    return as_utc(value).isoformat(timespec="milliseconds").replace("+00:00", "Z")


# Upper-cased in a BeforeValidator because pydantic checks `pattern` before `to_upper`.
Sku = Annotated[str, BeforeValidator(_strip_upper), StringConstraints(pattern=r"^[A-Z0-9-]{3,20}$")]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
NoteText = Annotated[
    Annotated[str, StringConstraints(max_length=120)] | None, BeforeValidator(_blank_to_none)
]
UnitCostPaise = Annotated[int, Field(gt=0, le=100_000_000)]
ReorderPoint = Annotated[int, Field(ge=0, le=1_000_000)]
LeadTimeDays = Annotated[int, Field(ge=1, le=60)]
# SQLite loads naive and Postgres aware datetimes; both serialise as UTC ISO-8601 with a Z,
# so browsers never read a timestamp as local time.
UtcDatetime = Annotated[datetime, PlainSerializer(_utc_iso, return_type=str, when_used="json")]


# Products


class ProductCreate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {
                    "sku": "DEMO-001",
                    "name": "Demo item",
                    "category": "OTHER",
                    "unit": "pcs",
                    "unit_cost_paise": 1000,
                    "reorder_point": 5,
                    "lead_time_days": 7,
                }
            ]
        },
    )

    sku: Sku
    name: Name
    category: Category
    unit: Unit
    unit_cost_paise: UnitCostPaise
    reorder_point: ReorderPoint = 0
    lead_time_days: LeadTimeDays = 7


class ProductUpdate(BaseModel):
    """Partial update; the SKU and created_at are immutable (extra fields are rejected)."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    category: Category | None = None
    unit: Unit | None = None
    unit_cost_paise: UnitCostPaise | None = None
    reorder_point: ReorderPoint | None = None
    lead_time_days: LeadTimeDays | None = None

    # Omitted fields keep their value (routers dump with exclude_unset=True); an explicit null
    # would erase a NOT NULL column, so it is a 422.
    @field_validator("*")
    @classmethod
    def _reject_explicit_null(cls, value: object, info: ValidationInfo) -> object:
        if value is None:
            raise PydanticCustomError(
                "null_not_allowed", "{field} may not be null", {"field": info.field_name}
            )
        return value


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sku: str
    name: str
    category: Category
    unit: Unit
    unit_cost_paise: int
    reorder_point: int
    lead_time_days: int
    created_at: UtcDatetime


class ProductStock(ProductOut):
    on_hand: int = Field(description="SUM of the product's ledger deltas")
    value_paise: int = Field(description="on_hand x unit_cost_paise")
    days_of_cover: float | None = Field(
        description="Days the stock lasts at the average OUT rate of the last 30 days; "
        "null when there was no OUT demand in that window"
    )
    movements_count: int
    needs_reorder: bool = Field(description="on_hand <= reorder_point")

    @classmethod
    def from_row(cls, row: StockRow) -> Self:
        return cls(
            **ProductOut.model_validate(row.product).model_dump(),
            on_hand=row.on_hand,
            value_paise=row.value_paise,
            days_of_cover=row.days_of_cover,
            movements_count=row.movements_count,
            needs_reorder=row.needs_reorder,
        )


class DemandStats(BaseModel):
    total_out: int
    avg_daily_out: float
    daily_out: list[int] = Field(description="OUT units per UTC day, oldest to today (30 values)")


# Movements


class MovementCreate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={"examples": [{"product_id": 1, "kind": "OUT", "quantity": 20}]},
    )

    product_id: int = Field(gt=0)
    kind: Kind
    quantity: int = Field(
        ge=-100_000,
        le=100_000,
        description="Units: > 0 for IN and OUT; signed and non-zero for ADJUST",
    )
    note: NoteText = None

    @model_validator(mode="after")
    def _quantity_fits_kind(self) -> Self:
        if self.kind == "ADJUST" and self.quantity == 0:
            raise PydanticCustomError("quantity_zero", "quantity may not be 0 for ADJUST")
        if self.kind != "ADJUST" and self.quantity <= 0:
            raise PydanticCustomError(
                "quantity_not_positive", "quantity must be > 0 for {kind}", {"kind": self.kind}
            )
        return self


class MovementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    sku: str
    product_name: str
    unit: Unit
    kind: Kind
    delta: int = Field(description="Signed change to on_hand")
    note: str | None
    created_at: UtcDatetime


class MovementCreated(MovementOut):
    on_hand: int = Field(description="The product's on_hand after this movement")


class ProductDetail(ProductStock):
    recent_movements: list[MovementOut] = Field(description="Up to 20, newest first")
    demand_30d: DemandStats


# Summary


class TopMover(BaseModel):
    product_id: int
    sku: str
    name: str
    unit: Unit
    units_out_7d: int


class SummaryOut(BaseModel):
    inventory_value_paise: int
    product_count: int
    items_below_reorder: int = Field(description="Products with on_hand <= reorder_point")
    movements_24h: int
    units_out_7d: int
    top_movers: list[TopMover] = Field(description="Top 5 products by OUT units in 7 days")


# Reorder planner


class PlanItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    product_id: int
    sku: str
    name: str
    unit: Unit
    on_hand: int
    avg_daily_demand: float = Field(description="Mean daily OUT units, including the surge")
    current_reorder_point: int
    recommended_reorder_point: int = Field(
        description="Service-level quantile of simulated lead-time demand"
    )
    suggested_order_qty: int
    stockout_risk: float = Field(
        ge=0, le=1, description="Share of scenarios that ran out within the horizon (4 dp)"
    )
    risk_margin: float = Field(
        description="95% margin of stockout_risk: 1.96 * sqrt(p * (1 - p) / scenarios) (4 dp)"
    )
    median_days_to_stockout: int | None = Field(
        description="Median first stock-out day over all scenarios (median_low, a whole day); "
        "null when most scenarios never run out"
    )
    expected_units_short: float = Field(description="Mean lost sales per scenario (2 dp)")


class ReorderPlanOut(BaseModel):
    service_level: float
    horizon_days: int
    surge_pct: float
    scenarios: int
    seed: int = Field(description="Echoed; pass it back to reproduce this plan exactly")
    lead_time_spread: tuple[float, float, float]
    products_considered: int
    work: int = Field(
        description="scenarios x products x horizon_days simulated; capped by PLANNER_MAX_WORK"
    )
    items: list[PlanItem]


# Build identity


class VersionOut(BaseModel):
    version: str
    git_sha: str = Field(description="Full commit SHA of the running image ('dev' locally)")
    build_time: str
