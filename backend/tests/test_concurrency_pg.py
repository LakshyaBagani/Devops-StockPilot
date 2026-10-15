"""Postgres-only proof that the product row lock stops overselling across API replicas.

Each test runs real concurrent transactions on separate connections, as several API pods would.
SQLite has a single writer and emits no FOR UPDATE, so conftest skips these tests there;
`make test-pg` and CI (TEST_REQUIRE_POSTGRES=1) always run them. Every wait is bounded and every
session is closed, so a broken lock fails the test instead of hanging the run.
"""

import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import select, text

from app.models import Product, StockMovement
from app.services.stock import (
    InsufficientStock,
    MovementNotFound,
    lock_product,
    record_movement,
    undo_movement,
)

pytestmark = pytest.mark.postgres

# Other sessions of this database that are blocked on a lock, such as a product row lock.
LOCK_WAITERS = text(
    "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() "
    "AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()"
)


@pytest.fixture
def pg_engine(session_factory):
    with session_factory() as session:
        return session.get_bind()


def new_product(session_factory, opening: int) -> tuple[int, int]:
    """A committed product with one opening delivery; returns (product_id, movement_id)."""
    with session_factory() as session:
        product = Product(
            sku="PEN-REY-BLU",
            name="Reynolds pen (blue)",
            category="STATIONERY",
            unit="pcs",
            unit_cost_paise=750,
        )
        session.add(product)
        session.commit()
        delivery, _ = record_movement(session, product.id, "IN", opening)
        return product.id, delivery.id


def in_own_session(session_factory, operation, *args):
    """Run one stock operation on its own connection, as another API pod would."""
    with session_factory() as session:
        # Wait out the other pod's lock instead of failing at the suite's 5 s lock_timeout.
        session.execute(text("SET LOCAL lock_timeout = '20s'"))
        return operation(session, *args)


def wait_for_lock_waiter(engine, timeout: float = 5.0) -> bool:
    """Poll until a session is blocked on a lock. pg_stat_activity is a snapshot taken once
    per transaction, so every poll runs on a fresh one."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with engine.connect() as connection:
            if connection.scalar(LOCK_WAITERS):
                return True
        time.sleep(0.05)
    return False


def ledger(session_factory, product_id: int) -> list[tuple[str, int]]:
    """The product's movements in id (commit) order, read after the race is over."""
    with session_factory() as session:
        rows = session.execute(
            select(StockMovement.kind, StockMovement.delta)
            .where(StockMovement.product_id == product_id)
            .order_by(StockMovement.id)
        )
        return [(kind, delta) for kind, delta in rows]


def race(session_factory, product_id: int, *, pods: int, units: int) -> list[bool]:
    """`pods` sessions try to sell `units` at the same moment; True for each accepted sale."""
    barrier = threading.Barrier(pods, timeout=10)

    def sell(session) -> bool:
        barrier.wait()
        try:
            record_movement(session, product_id, "OUT", units)
        except InsufficientStock:
            return False
        return True

    with ThreadPoolExecutor(max_workers=pods) as pool:
        sales = [pool.submit(in_own_session, session_factory, sell) for _ in range(pods)]
        return [sale.result(timeout=30) for sale in sales]


# Below, `with pool, pod_a` exits in reverse order: pod A's session closes first, releasing its
# row lock even when a check failed early, so the pool's wait for pod B always ends.


def test_row_lock_blocks_second_out_until_first_commits(session_factory, pg_engine):
    product_id, _ = new_product(session_factory, opening=10)
    with ThreadPoolExecutor(max_workers=1) as pool, session_factory() as pod_a:
        lock_product(pod_a, product_id)
        pod_b = pool.submit(in_own_session, session_factory, record_movement, product_id, "OUT", 7)
        assert wait_for_lock_waiter(pg_engine), "no session waiting on a lock"
        with pytest.raises(TimeoutError):
            pod_b.result(timeout=0.5)  # still blocked, before reading on_hand
        record_movement(pod_a, product_id, "OUT", 7)  # commits, which releases the lock
        # Pod B sums the ledger only once it holds the lock, so it sees 3, never a stale 10.
        with pytest.raises(InsufficientStock, match="on hand 3, requested 7"):
            pod_b.result(timeout=10)
    assert ledger(session_factory, product_id) == [("IN", 10), ("OUT", -7)]


def test_two_concurrent_outs_cannot_oversell(session_factory):
    product_id, _ = new_product(session_factory, opening=10)
    assert sorted(race(session_factory, product_id, pods=2, units=7)) == [False, True]
    assert ledger(session_factory, product_id) == [("IN", 10), ("OUT", -7)]  # on hand 3


def test_parallel_outs_never_oversell(session_factory):
    product_id, _ = new_product(session_factory, opening=10)
    sales = race(session_factory, product_id, pods=8, units=3)
    assert (sales.count(True), sales.count(False)) == (3, 5)
    # In commit order the stock goes 10, 7, 4, 1: never below zero.
    assert ledger(session_factory, product_id) == [("IN", 10)] + [("OUT", -3)] * 3


def test_concurrent_undo_and_out_cannot_drive_stock_negative(session_factory, pg_engine):
    product_id, delivery_id = new_product(session_factory, opening=10)
    with ThreadPoolExecutor(max_workers=1) as pool, session_factory() as pod_a:
        assert undo_movement(pod_a, delivery_id, commit=False) == 0  # holds the lock
        pod_b = pool.submit(in_own_session, session_factory, record_movement, product_id, "OUT", 5)
        assert wait_for_lock_waiter(pg_engine), "no session waiting on a lock"
        pod_a.commit()
        with pytest.raises(InsufficientStock, match="on hand 0, requested 5"):
            pod_b.result(timeout=10)
    assert ledger(session_factory, product_id) == []


def test_concurrent_undos_of_one_movement_apply_once(session_factory, pg_engine):
    product_id, _ = new_product(session_factory, opening=10)
    with session_factory() as session:
        sale, _ = record_movement(session, product_id, "OUT", 4)
    with ThreadPoolExecutor(max_workers=1) as pool, session_factory() as pod_a:
        assert undo_movement(pod_a, sale.id, commit=False) == 10  # holds the lock
        pod_b = pool.submit(in_own_session, session_factory, undo_movement, sale.id)
        assert wait_for_lock_waiter(pg_engine), "no session waiting on a lock"
        pod_a.commit()
        # Pod B loaded the sale before it waited; the re-read under the lock finds it gone, so
        # the sale is not undone twice (on hand stays 10, not 14).
        with pytest.raises(MovementNotFound):
            pod_b.result(timeout=10)
    assert ledger(session_factory, product_id) == [("IN", 10)]
