"""Movements API: the ledger, the oversell guard, undo and the business counters.

Counters are process-wide, so every check compares a delta taken around the call.
"""

import pytest


def on_hand(client, product_id: int) -> int:
    return client.get(f"/api/products/{product_id}").json()["on_hand"]


def ledger_size(client) -> int:
    return len(client.get("/api/movements", params={"limit": 200}).json())


def test_record_in_returns_201_with_on_hand(client, make_product):
    product = make_product()
    response = client.post(
        "/api/movements",
        json={"product_id": product["id"], "kind": "IN", "quantity": 160, "note": " delivery "},
    )
    assert response.status_code == 201
    created = response.json()
    assert (created["kind"], created["delta"], created["on_hand"]) == ("IN", 160, 160)
    assert (created["sku"], created["product_name"], created["unit"]) == (
        product["sku"],
        product["name"],
        "pcs",
    )
    assert created["note"] == "delivery"
    assert created["created_at"].endswith("Z")

    fetched = client.get(f"/api/movements/{created['id']}")
    assert fetched.status_code == 200
    assert fetched.json() == {k: v for k, v in created.items() if k != "on_hand"}


def test_out_beyond_stock_is_422_and_increments_insufficient_counter(
    client, make_product, move, metric
):
    product = make_product()
    move(product["id"], "IN", 10)
    rejected = metric("stockpilot_insufficient_stock_total")
    outs = metric("stockpilot_movements_total", kind="OUT")

    response = client.post(
        "/api/movements", json={"product_id": product["id"], "kind": "OUT", "quantity": 11}
    )
    assert response.status_code == 422
    assert response.json() == {"detail": "Insufficient stock: on hand 10, requested 11"}
    assert metric("stockpilot_insufficient_stock_total") == rejected + 1
    assert metric("stockpilot_movements_total", kind="OUT") == outs
    assert on_hand(client, product["id"]) == 10
    assert ledger_size(client) == 1


def test_negative_adjust_beyond_stock_is_422(client, make_product, move, metric):
    product = make_product()
    move(product["id"], "IN", 12)
    rejected = metric("stockpilot_insufficient_stock_total")
    response = client.post(
        "/api/movements", json={"product_id": product["id"], "kind": "ADJUST", "quantity": -13}
    )
    assert response.status_code == 422
    assert response.json() == {"detail": "Insufficient stock: on hand 12, requested 13"}
    assert metric("stockpilot_insufficient_stock_total") == rejected + 1
    assert on_hand(client, product["id"]) == 12


def test_adjust_positive_and_negative(client, make_product, move):
    product = make_product()
    move(product["id"], "IN", 10)
    assert move(product["id"], "ADJUST", -3, "damaged")["on_hand"] == 7
    assert move(product["id"], "ADJUST", 5, "found in store room")["on_hand"] == 12
    assert move(product["id"], "ADJUST", -12)["on_hand"] == 0  # exactly zero is allowed
    assert on_hand(client, product["id"]) == 0


def test_movement_for_unknown_product_404(client, metric):
    rejected = metric("stockpilot_insufficient_stock_total")
    response = client.post(
        "/api/movements", json={"product_id": 999_999, "kind": "IN", "quantity": 5}
    )
    assert response.status_code == 404
    assert response.json() == {"detail": "Product not found"}
    assert metric("stockpilot_insufficient_stock_total") == rejected


@pytest.mark.parametrize(
    "changes",
    [
        {"kind": "SALE"},
        {"kind": "IN", "quantity": 0},
        {"kind": "IN", "quantity": -5},
        {"kind": "OUT", "quantity": 0},
        {"kind": "OUT", "quantity": -5},
        {"kind": "ADJUST", "quantity": 0},
        {"quantity": 2.5},
        {"quantity": 100_001},
        {"note": "x" * 121},
        {"product_id": 0},
        {"product_id": None},
        {"created_at": "2026-10-15T00:00:00Z"},  # server-set only
    ],
)
def test_invalid_movement_is_422(client, make_product, changes):
    product = make_product()
    body = {"product_id": product["id"], "kind": "IN", "quantity": 5, **changes}
    assert client.post("/api/movements", json=body).status_code == 422
    assert ledger_size(client) == 0


def test_successful_out_increments_movement_and_unit_counters(client, make_product, move, metric):
    product = make_product()
    move(product["id"], "IN", 160)
    outs = metric("stockpilot_movements_total", kind="OUT")
    units = metric("stockpilot_units_moved_total", kind="OUT")
    assert move(product["id"], "OUT", 20)["on_hand"] == 140
    assert metric("stockpilot_movements_total", kind="OUT") == outs + 1
    assert metric("stockpilot_units_moved_total", kind="OUT") == units + 20


def test_undo_rederives_on_hand_and_increments_undo_counter(client, make_product, move, metric):
    product = make_product()
    move(product["id"], "IN", 100)
    sale = move(product["id"], "OUT", 30)
    assert sale["on_hand"] == 70
    undone = metric("stockpilot_undo_total")

    response = client.delete(f"/api/movements/{sale['id']}")
    assert response.status_code == 204
    assert response.content == b""
    assert on_hand(client, product["id"]) == 100
    assert metric("stockpilot_undo_total") == undone + 1
    assert client.get(f"/api/movements/{sale['id']}").status_code == 404


def test_undo_in_that_would_go_negative_is_422(client, make_product, move, metric):
    product = make_product()
    delivery = move(product["id"], "IN", 50)
    move(product["id"], "OUT", 40)
    rejected = metric("stockpilot_insufficient_stock_total")
    undone = metric("stockpilot_undo_total")

    response = client.delete(f"/api/movements/{delivery['id']}")
    assert response.status_code == 422
    assert response.json() == {"detail": "Undo would make stock negative: on hand 10, movement 50"}
    assert client.get(f"/api/movements/{delivery['id']}").status_code == 200
    assert on_hand(client, product["id"]) == 10
    # Only refused POSTs count as insufficient stock; a refused undo counts nowhere.
    assert metric("stockpilot_insufficient_stock_total") == rejected
    assert metric("stockpilot_undo_total") == undone


def test_undo_missing_movement_404(client):
    response = client.delete("/api/movements/999999")
    assert response.status_code == 404
    assert response.json() == {"detail": "Movement not found"}


def test_get_movement_404(client):
    response = client.get("/api/movements/999999")
    assert response.status_code == 404
    assert response.json() == {"detail": "Movement not found"}


def test_list_movements_newest_first_with_filters(client, make_product, move):
    pen = make_product()
    rice = make_product(name="Basmati rice", category="GROCERY", unit="kg")
    ids = [
        move(pen["id"], "IN", 50)["id"],
        move(rice["id"], "IN", 20)["id"],
        move(pen["id"], "OUT", 5)["id"],
        move(rice["id"], "OUT", 2)["id"],
        move(pen["id"], "ADJUST", -1)["id"],
    ]

    def listed(**params) -> list[dict]:
        response = client.get("/api/movements", params=params)
        assert response.status_code == 200
        return response.json()

    rows = listed()
    assert [row["id"] for row in rows] == ids[::-1]  # strictly newest first
    assert (rows[1]["sku"], rows[1]["product_name"], rows[1]["unit"]) == (
        rice["sku"],
        "Basmati rice",
        "kg",
    )
    assert [row["id"] for row in listed(product_id=pen["id"])] == [ids[4], ids[2], ids[0]]
    assert [row["id"] for row in listed(kind="OUT")] == [ids[3], ids[2]]
    assert [row["id"] for row in listed(product_id=rice["id"], kind="IN")] == [ids[1]]
    assert [row["id"] for row in listed(limit=2, offset=1)] == [ids[3], ids[2]]


@pytest.mark.parametrize(
    "params",
    [{"kind": "MOVE"}, {"limit": 0}, {"limit": 201}, {"offset": -1}, {"product_id": 0}],
)
def test_list_movements_bounds_are_422(client, params):
    assert client.get("/api/movements", params=params).status_code == 422
