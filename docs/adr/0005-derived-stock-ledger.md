# ADR-0005: Stock is derived from a movement ledger, never stored

- **Status:** Accepted
- **Date:** 2026-10-15
- **Deciders:** Lakshya Bagani
- **Related:** `backend/app/services/stock.py`, `backend/app/models.py`,
  `backend/tests/test_concurrency_pg.py`, [ADR-0004](0004-in-cluster-postgres.md)

## Context

A shop's stock level changes with every delivery, sale and stock-count correction. StockPilot must:

- never let two staff members sell the same last units, even with up to 5 backend replicas behind the
  load balancer;
- let staff undo a mistaken entry safely;
- keep an audit trail an owner or accountant can trust;
- show stock value exactly, in rupees and paise.

The usual shortcut, a `quantity` column updated in place, loses the history, makes undo guesswork,
and can drift from reality when two updates race.

## Decision

- **Only movements are stored.** Table `stock_movements` holds `kind` (`IN`, `OUT`, `ADJUST`) and a
  signed `delta`: IN is `+q`, OUT is `-q`, ADJUST is any non-zero signed value. A CHECK constraint ties
  the sign to the kind.
- **Stock is computed:** `on_hand = SUM(delta)` per product, in SQL. Stock value is
  `on_hand × unit_cost_paise` in integer paise; days of cover is `on_hand` divided by the average OUT
  units per day of the last 30 days (null when there was no demand).
- **Writes lock the product row first.** Recording or undoing a movement runs one transaction:
  `SELECT … FROM products WHERE id = :id FOR UPDATE`, then the SUM in a separate statement (a subquery
  inside the locking statement would read a snapshot taken before the lock was granted), then the
  check, then the write. A movement that would take stock below zero is refused with 422
  `Insufficient stock: on hand N, requested M`.
- **Undo is a delete, never an edit.** `DELETE /api/movements/{id}` re-checks under the same lock that
  the row still exists and that stock stays at or above zero (422 `Undo would make stock negative`).
  Ledger rows are never edited: a wrong entry is undone and recorded again.
- **History is protected.** The foreign key is `ON DELETE RESTRICT`, and deleting a product with
  movements is refused with an explicit `EXISTS` check (409), because SQLite reports every constraint
  failure with the same exception class.
- **Timestamps are server-set.** `created_at` is in no request schema; only the seed back-dates rows.

## Alternatives considered

- **A stored `on_hand` column with optimistic locking:** cheaper reads, but undo becomes a second
  write that can fail half-way, and the audit trail would need its own table anyway.
- **Event sourcing with snapshots:** the same idea at a larger scale; unnecessary for about 40
  products and a few thousand movements. A snapshot table is the upgrade path if reads ever get slow.
- **`SERIALIZABLE` isolation instead of a row lock:** correct, but conflicting transactions fail and
  must be retried by the client; a row lock simply makes the second OUT wait.

## Consequences

- The ledger is the audit trail, undo is safe, and there is no counter to drift.
- The no-oversell guarantee is proven on PostgreSQL by five tests in `tests/test_concurrency_pg.py`:
  the lock blocks a second OUT until the first commits, two simultaneous OUTs cannot oversell, parallel
  OUTs never oversell, an undo racing an OUT cannot drive stock negative, and two undos of one
  movement apply once. They run in CI and in `make test-pg`; on SQLite, which has a single writer and
  no row locks, they are skipped.
- Every stock read aggregates movements. The composite index `(product_id, id)` and the `created_at`
  index keep that cheap at shop scale.
- The reorder planner reads the same ledger, so its demand history is exactly what staff recorded.
