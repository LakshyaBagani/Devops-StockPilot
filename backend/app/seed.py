"""`python -m app.seed`: demo data for a neighbourhood kirana and stationery shop.

Forty products with 60 days of back-dated, lumpy demand, written through the stock service
(never raw SQL), so every row passes the same checks as a real movement. Idempotent by SKU, so
it is safe on every bring-up. Each product gets regular deliveries (IN) and daily sales (OUT)
with zero days and occasional bulk orders, clipped to the stock on the shelf. All histories are
inserted oldest first in one transaction: movement ids follow time, as in a real shop, so the
newest-first ledger reads in date order, and an interrupted seed leaves nothing behind.

Two stories end in a stock-count ADJUST, sized from the 30-day demand the API reports:
- short: fast movers left with half a lead time of cover, so the reorder plan opens with them;
- pen: the Reynolds pen (blue) left just above two lead times of cover, so one OUT of 20 turns
  its days-of-cover bar from green to amber in the live demo.
The 30-day window slides daily, so `--demo-reset` re-applies both targets before a demo.
"""

import argparse
import math
import random
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import Product
from app.services import stock

DEMO_SKU = "PEN-REY-BLU"


@dataclass(frozen=True)
class Item:
    sku: str
    name: str
    category: str
    unit: str
    unit_cost_paise: int
    lead_time_days: int
    reorder_point: int  # the shop's own guess
    daily_mean: float  # units sold on a day with sales
    zero_day: float  # chance of no sale at all that day
    bulk: float  # chance of an extra bulk order on a day with sales
    bulk_days: float  # size of a bulk order, in days of ordinary sales
    restock_every: int  # days between deliveries
    story: str = ""  # "short" or "pen": the final stock-count ADJUST


# One row per product, in Item field order: sku, name, category, unit, cost in paise, lead time,
# reorder point, daily mean, zero-day chance, bulk chance, bulk days, restock every[, story].
# fmt: off
CATALOGUE = (
    Item("NB-CLM-172", "Classmate notebook 172 pages", "STATIONERY", "pcs", 4_600, 7, 40, 6, 0.15, 0.06, 4, 7),
    Item(DEMO_SKU, "Reynolds pen (blue)", "STATIONERY", "pcs", 750, 7, 60, 9, 0.05, 0.05, 3, 7, "pen"),
    Item("PEN-REY-BLK", "Reynolds pen (black)", "STATIONERY", "pcs", 750, 7, 30, 4, 0.2, 0.04, 3, 7),
    Item("PCL-APS-10", "Apsara Platinum pencils (box of 10)", "STATIONERY", "box", 4_200, 10, 30, 2, 0.4, 0.05, 3, 14),
    Item("ERS-NAT-20", "Nataraj erasers (pack of 20)", "STATIONERY", "pack", 3_600, 10, 10, 1, 0.6, 0.0, 0, 14),
    Item("GLU-FEV-50", "Fevicol MR 50 g", "STATIONERY", "pcs", 2_100, 7, 15, 3, 0.3, 0.03, 4, 7),
    Item("PPR-A4-500", "JK Copier A4 paper (500 sheets)", "STATIONERY", "pack", 27_500, 7, 30, 2, 0.35, 0.08, 5, 7),
    Item("TAPE-CEL-24", "Cello tape 24 mm", "STATIONERY", "pcs", 1_200, 7, 30, 3, 0.35, 0.0, 0, 7),
    Item("CBL-USBC-1M", "USB-C cable 1 m", "ELECTRONICS", "pcs", 11_500, 14, 15, 1, 0.5, 0.03, 5, 14),
    Item("CHG-USBC-20W", "20 W USB-C charger", "ELECTRONICS", "pcs", 36_000, 14, 8, 1, 0.7, 0.0, 0, 14),
    Item("BAT-AA-4", "Eveready AA batteries (pack of 4)", "ELECTRONICS", "pack", 5_800, 10, 50, 3, 0.25, 0.04, 4, 7),
    Item("BLB-LED-9W", "Philips 9 W LED bulb", "ELECTRONICS", "pcs", 8_200, 10, 25, 2, 0.35, 0.05, 5, 7),
    Item("EAR-WIRED", "Wired earphones", "ELECTRONICS", "pcs", 14_000, 14, 10, 1, 0.6, 0.0, 0, 14),
    Item("BIS-PARLEG", "Parle-G biscuits 250 g", "GROCERY", "pack", 2_000, 5, 100, 22, 0.02, 0.08, 3, 3, "short"),
    Item("NOOD-MAGGI-70", "Maggi 2-minute noodles 70 g", "GROCERY", "pack", 1_150, 5, 90, 18, 0.03, 0.08, 4, 4, "short"),
    Item("SALT-TATA-1KG", "Tata Salt 1 kg", "GROCERY", "pack", 2_400, 7, 60, 9, 0.08, 0.05, 3, 7, "short"),
    Item("RICE-SONA", "Sona masoori rice (loose)", "GROCERY", "kg", 5_200, 5, 80, 18, 0.05, 0.1, 3, 4, "short"),
    Item("SUGAR-LOOSE", "Sugar (loose)", "GROCERY", "kg", 4_100, 5, 60, 12, 0.08, 0.06, 3, 4),
    Item("ATTA-ASH-5KG", "Aashirvaad atta 5 kg", "GROCERY", "pack", 24_500, 7, 30, 3, 0.25, 0.05, 3, 7),
    Item("DAL-TOOR", "Toor dal (loose)", "GROCERY", "kg", 13_000, 7, 65, 5, 0.15, 0.05, 3, 7),
    Item("OIL-FORT-1L", "Fortune sunflower oil 1 L", "GROCERY", "litre", 14_200, 7, 60, 5, 0.15, 0.06, 3, 7),
    Item("TEA-TATA-250", "Tata Tea Premium 250 g", "GROCERY", "pack", 13_000, 10, 40, 3, 0.25, 0.04, 3, 7),
    Item("GHEE-AMUL-1L", "Amul ghee 1 L", "GROCERY", "litre", 56_000, 10, 12, 1, 0.55, 0.05, 3, 14),
    Item("POHA-THICK", "Poha, thick (loose)", "GROCERY", "kg", 5_600, 7, 30, 3, 0.3, 0.05, 3, 7),
    Item("SOAP-LUX-100", "Lux soap 100 g", "PERSONAL_CARE", "pcs", 3_100, 7, 60, 6, 0.1, 0.05, 4, 7),
    Item("PASTE-COL-200", "Colgate toothpaste 200 g", "PERSONAL_CARE", "pcs", 9_800, 10, 40, 3, 0.25, 0.03, 4, 7),
    Item("SHMP-CLINIC-16", "Clinic Plus shampoo sachets (strip of 16)", "PERSONAL_CARE", "pack", 1_400, 7, 40, 4, 0.2, 0.05, 3, 7),
    Item("OIL-PARA-500", "Parachute coconut oil 500 ml", "PERSONAL_CARE", "pcs", 19_500, 10, 25, 2, 0.4, 0.04, 3, 7),
    Item("HWASH-DET-750", "Dettol handwash refill 750 ml", "PERSONAL_CARE", "pcs", 9_900, 10, 12, 1, 0.5, 0.05, 4, 14),
    Item("BRUSH-COL-MED", "Colgate toothbrush (medium)", "PERSONAL_CARE", "pcs", 2_600, 10, 25, 2, 0.35, 0.03, 5, 7),
    Item("DET-SURF-1KG", "Surf Excel 1 kg", "HOUSEHOLD", "pack", 12_500, 7, 30, 4, 0.15, 0.06, 3, 7),
    Item("DISH-VIM-500", "Vim dishwash gel 500 ml", "HOUSEHOLD", "pcs", 9_400, 7, 20, 2, 0.3, 0.04, 3, 7),
    Item("PHENYL-1L", "Phenyl floor cleaner 1 L", "HOUSEHOLD", "litre", 6_500, 7, 25, 2, 0.45, 0.05, 4, 7),
    Item("MATCH-SHIP-10", "Ship matchboxes (pack of 10)", "HOUSEHOLD", "pack", 900, 7, 65, 5, 0.1, 0.05, 3, 7),
    Item("AGARB-CYCLE-12", "Cycle agarbatti (box of 12)", "HOUSEHOLD", "box", 5_500, 10, 25, 2, 0.3, 0.06, 4, 7),
    Item("GBAG-MED-30", "Garbage bags, medium (roll of 30)", "HOUSEHOLD", "pack", 6_200, 10, 15, 1, 0.45, 0.04, 4, 14),
    Item("BAG-JUTE", "Jute shopping bag", "OTHER", "pcs", 4_500, 14, 15, 1, 0.6, 0.05, 6, 14),
    Item("CANDLE-WHT-6", "White candles (pack of 6)", "OTHER", "pack", 3_000, 7, 20, 2, 0.5, 0.06, 5, 7),
    Item("DIYA-CLAY-12", "Clay diyas (pack of 12)", "OTHER", "pack", 4_800, 14, 15, 1, 0.55, 0.08, 6, 14),
    Item("GIFT-WRAP", "Gift wrapping paper", "OTHER", "pcs", 1_500, 7, 20, 2, 0.45, 0.05, 5, 7),
)
# fmt: on


@dataclass(frozen=True)
class SeedReport:
    created: int
    skipped: int
    movements: int


@dataclass(frozen=True, slots=True)
class Entry:
    """One back-dated movement, generated before anything is written."""

    product_id: int
    at: datetime
    kind: str
    quantity: int
    note: str | None = None


def _round_up(units: int, step: int = 5) -> int:
    """Suppliers deliver whole cases."""
    return -(-units // step) * step


def story_target(item: Item, out_30d: int) -> int:
    """The stock-count on_hand of a story item, from the 30-day OUT units the API reports.

    Integer maths on out_30d keeps the floors exact (d30 = out_30d / 30).
    """
    if item.story == "short":
        return out_30d * item.lead_time_days // 60  # floor(0.5 x d30 x LT)
    return out_30d * item.lead_time_days // 15 + 10  # floor(2 x d30 x LT) + 10


def _history(
    item: Item, product_id: int, *, days: int, now: datetime, rng: random.Random
) -> list[Entry]:
    """One product's back-dated movements, oldest first, ending with its story's stock count."""
    expected_daily = item.daily_mean * (1 - item.zero_day) * (1 + item.bulk * item.bulk_days)
    order_up_to = _round_up(
        math.ceil(expected_daily * item.restock_every * 1.5) + item.reorder_point
    )
    entries: list[Entry] = []
    on_hand = 0

    def move(kind: str, quantity: int, at: datetime, note: str | None = None) -> None:
        nonlocal on_hand
        entries.append(Entry(product_id, at, kind, quantity, note))
        on_hand += stock.movement_delta(kind, quantity)

    # A shop day ends at the same clock time as `now`, so today's sales are always in the past.
    for day in range(days):
        day_end = now - timedelta(days=days - 1 - day)
        if day % item.restock_every == 0 and on_hand < order_up_to:
            delivered_at = day_end - timedelta(hours=9)
            delivery = "supplier delivery" if day else "opening stock"
            move("IN", _round_up(order_up_to - on_hand), delivered_at, delivery)
        if rng.random() < item.zero_day:
            continue
        sales = [(max(1, round(rng.gauss(item.daily_mean, item.daily_mean * 0.4))), None)]
        if rng.random() < item.bulk:
            sales.append((max(1, round(item.daily_mean * item.bulk_days)), "bulk order"))
        hours_ago = sorted((rng.uniform(0.5, 8.5) for _ in sales), reverse=True)
        for (units, note), hours in zip(sales, hours_ago, strict=True):
            units = min(units, on_hand)  # the shelf limits a sale; the rest is a lost sale
            if units:
                move("OUT", units, day_end - timedelta(hours=hours), note)

    if item.story:
        # The API's out_30d: OUT units since now - 30 days (no movement sits on that boundary).
        month_ago = now - timedelta(days=30)
        out_30d = sum(e.quantity for e in entries if e.kind == "OUT" and e.at >= month_ago)
        target = story_target(item, out_30d)
        if target != on_hand:
            move("ADJUST", target - on_hand, now - timedelta(minutes=15), "stock count")
    return entries


def run(
    db: Session, *, days: int = 60, rng_seed: int = 2026, now: datetime | None = None
) -> SeedReport:
    """Seed every catalogue product whose SKU is not in the database yet, in one transaction."""
    now = now or stock.utcnow()
    existing = set(db.scalars(select(Product.sku)))
    items = [item for item in CATALOGUE if item.sku not in existing]
    entries: list[Entry] = []
    for item in items:
        product = Product(
            sku=item.sku,
            name=item.name,
            category=item.category,
            unit=item.unit,
            unit_cost_paise=item.unit_cost_paise,
            reorder_point=item.reorder_point,
            lead_time_days=item.lead_time_days,
        )
        db.add(product)
        db.flush()
        # One RNG per product: its history does not depend on which other SKUs already exist.
        rng = random.Random(f"{rng_seed}:{item.sku}")
        entries += _history(item, product.id, days=days, now=now, rng=rng)
    # Oldest first, so ids follow time; the sort is stable, so ties keep catalogue order.
    for entry in sorted(entries, key=lambda entry: entry.at):
        stock.record_movement(
            db, entry.product_id, entry.kind, entry.quantity, entry.note, at=entry.at, commit=False
        )
    db.commit()
    return SeedReport(
        created=len(items), skipped=len(CATALOGUE) - len(items), movements=len(entries)
    )


def demo_reset(db: Session, now: datetime | None = None) -> list[tuple[str, int, int]]:
    """Re-apply the story targets on a seeded database; returns (sku, on_hand, target) rows."""
    now = now or stock.utcnow()
    applied = []
    for item in CATALOGUE:
        if not item.story:
            continue
        product_id = db.scalar(select(Product.id).where(Product.sku == item.sku))
        if product_id is None:
            continue
        row = stock.get_stock_row(db, product_id, now)
        target = story_target(item, row.out_30d)
        if target != row.on_hand:
            stock.record_movement(
                db, product_id, "ADJUST", target - row.on_hand, "stock count", at=now, commit=False
            )
        applied.append((item.sku, row.on_hand, target))
    db.commit()
    return applied


def main(argv: Sequence[str] | None = None) -> None:  # pragma: no cover
    parser = argparse.ArgumentParser(
        prog="python -m app.seed", description="Seed demo products and back-dated movements."
    )
    parser.add_argument("--days", type=int, default=60, help="days of history (default 60)")
    parser.add_argument(
        "--demo-reset",
        action="store_true",
        help="re-apply the stock counts of the demo story on a seeded database",
    )
    args = parser.parse_args(argv)
    with SessionLocal() as db:
        if args.demo_reset:
            applied = demo_reset(db)
            if not applied:
                sys.exit("nothing to reset: run python -m app.seed first")
            for sku, on_hand, target in applied:
                print(f"demo reset: {sku} on hand {on_hand} -> {target}")
            return
        report = run(db, days=args.days)
    print(
        f"seeded {report.created} products, {report.movements} movements "
        f"({report.skipped} existing skipped)"
    )


if __name__ == "__main__":
    main()
