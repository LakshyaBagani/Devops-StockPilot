"""Products API: CRUD, SKU rules, validation and the stock fields derived from the ledger."""

import pytest

from app.services import stock

PEN = {
    "sku": "RP-BLUE",
    "name": "Reynolds pen (blue)",
    "category": "STATIONERY",
    "unit": "pcs",
    "unit_cost_paise": 1050,
    "reorder_point": 20,
    "lead_time_days": 7,
}
UPDATES = {
    "name": "Reynolds gel pen (blue)",
    "category": "OTHER",
    "unit": "box",
    "unit_cost_paise": 1200,
    "reorder_point": 5,
    "lead_time_days": 3,
}
MISSING = object()


def test_create_product_201_returns_stock_fields(client):
    response = client.post("/api/products", json={**PEN, "sku": " rp-blue "})
    assert response.status_code == 201
    product = response.json()
    assert product["id"] > 0
    assert product["sku"] == "RP-BLUE"  # stored upper-case
    assert product["created_at"].endswith("Z")
    derived = ("on_hand", "value_paise", "days_of_cover", "movements_count", "needs_reorder")
    assert {field: product[field] for field in derived} == {
        "on_hand": 0,
        "value_paise": 0,
        "days_of_cover": None,
        "movements_count": 0,
        "needs_reorder": True,
    }


def test_duplicate_sku_in_any_case_is_409(client, make_product):
    make_product(sku="pen-001")
    response = client.post("/api/products", json={**PEN, "sku": "PEN-001"})
    assert response.status_code == 409
    assert response.json() == {"detail": "SKU already exists"}
    assert len(client.get("/api/products").json()) == 1


def test_duplicate_sku_race_integrity_error_maps_to_409(client, make_product, monkeypatch):
    make_product(sku="PEN-001")
    # Another request inserted the SKU after this one's pre-check: the unique constraint decides.
    monkeypatch.setattr(stock, "sku_exists", lambda db, sku: False)
    response = client.post("/api/products", json={**PEN, "sku": "PEN-001"})
    assert response.status_code == 409
    assert response.json() == {"detail": "SKU already exists"}
    assert len(client.get("/api/products").json()) == 1


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("sku", "ab"),
        ("sku", "RP BLUE"),
        ("sku", "RP_BLUE"),
        ("sku", "A" * 21),
        ("sku", MISSING),
        ("name", ""),
        ("name", "   "),
        ("name", "x" * 121),
        ("category", "TOYS"),
        ("unit", "dozen"),
        ("unit_cost_paise", 0),
        ("unit_cost_paise", -5),
        ("unit_cost_paise", 10.5),  # 10.0 would be coerced to 10
        ("unit_cost_paise", 100_000_001),
        ("reorder_point", -1),
        ("lead_time_days", 0),
        ("lead_time_days", 61),
        ("on_hand", 5),  # derived from the ledger, never accepted
        ("created_at", "2026-10-15T00:00:00Z"),  # server-set only
    ],
)
def test_invalid_product_is_422(client, field, value):
    body = {**PEN, field: value}
    if value is MISSING:
        del body[field]
    assert client.post("/api/products", json=body).status_code == 422
    assert client.get("/api/products").json() == []


def test_get_product_detail_has_recent_movements_and_demand(client, make_product, move):
    product = make_product()
    move(product["id"], "IN", 100)
    sales = [move(product["id"], "OUT", 1)["id"] for _ in range(24)]

    detail = client.get(f"/api/products/{product['id']}").json()
    assert (detail["on_hand"], detail["movements_count"]) == (76, 25)
    assert [m["id"] for m in detail["recent_movements"]] == sorted(sales, reverse=True)[:20]
    assert detail["recent_movements"][0]["sku"] == product["sku"]
    demand = detail["demand_30d"]
    assert len(demand["daily_out"]) == 30
    assert all(isinstance(units, int) for units in demand["daily_out"])
    assert demand["daily_out"][-1] == 24  # today is the last bucket
    assert (demand["total_out"], demand["avg_daily_out"]) == (24, 0.8)


def test_get_missing_product_404(client):
    response = client.get("/api/products/999999")
    assert response.status_code == 404
    assert response.json() == {"detail": "Product not found"}


def test_update_product_200(client, stocked_product):
    product_id = stocked_product["id"]
    response = client.put(f"/api/products/{product_id}", json=UPDATES)
    assert response.status_code == 200
    updated = response.json()
    assert {field: updated[field] for field in UPDATES} == UPDATES
    assert (updated["sku"], updated["on_hand"]) == (stocked_product["sku"], 140)
    assert updated["value_paise"] == 140 * 1200
    # Persisted, and a partial update keeps every omitted field.
    client.put(f"/api/products/{product_id}", json={"reorder_point": 9})
    stored = client.get(f"/api/products/{product_id}").json()
    assert {field: stored[field] for field in UPDATES} == {**UPDATES, "reorder_point": 9}


@pytest.mark.parametrize("field", list(UPDATES))
def test_update_explicit_null_is_422(client, make_product, field):
    product = make_product()
    response = client.put(f"/api/products/{product['id']}", json={field: None})
    assert response.status_code == 422
    assert f"{field} may not be null" in response.text
    stored = client.get(f"/api/products/{product['id']}").json()
    assert stored[field] == product[field]


def test_update_sku_is_422(client, make_product):
    product = make_product()
    response = client.put(f"/api/products/{product['id']}", json={"sku": "NEW-1"})
    assert response.status_code == 422
    assert client.get(f"/api/products/{product['id']}").json()["sku"] == product["sku"]


def test_update_missing_product_404(client):
    response = client.put("/api/products/999999", json={"name": "Ghost"})
    assert response.status_code == 404
    assert response.json() == {"detail": "Product not found"}


def test_delete_product_without_history_204_then_404(client, make_product):
    product = make_product()
    response = client.delete(f"/api/products/{product['id']}")
    assert response.status_code == 204
    assert response.content == b""
    assert client.get(f"/api/products/{product['id']}").status_code == 404
    assert client.delete(f"/api/products/{product['id']}").status_code == 404


def test_delete_product_with_movements_is_409(client, make_product, move):
    # Passing on SQLite proves the explicit EXISTS check: no FK error is involved.
    product = make_product()
    move(product["id"], "IN", 5)
    response = client.delete(f"/api/products/{product['id']}")
    assert response.status_code == 409
    assert response.json() == {"detail": "Product has stock movements and cannot be deleted"}
    assert client.get(f"/api/products/{product['id']}").status_code == 200


def test_list_products_derives_on_hand_value_cover_and_count(client, stocked_product):
    [row] = client.get("/api/products").json()
    assert row["id"] == stocked_product["id"]
    assert (row["on_hand"], row["value_paise"], row["movements_count"]) == (140, 147_000, 2)
    assert row["days_of_cover"] == 210.0  # 140 / (20 / 30)
    assert row["needs_reorder"] is False


def test_list_filters_search_and_pagination(client, make_product, move):
    pen = make_product(sku="RP-BLUE")
    rice = make_product(
        sku="RICE-5KG", name="Basmati rice", category="GROCERY", unit="kg", reorder_point=5
    )
    tags = make_product(sku="TAG-100", name="Price tags 100%", category="OTHER", reorder_point=0)
    move(pen["id"], "IN", 160)
    move(rice["id"], "IN", 3)

    def skus(**params) -> list[str]:
        response = client.get("/api/products", params=params)
        assert response.status_code == 200
        return [row["sku"] for row in response.json()]

    assert skus() == ["RICE-5KG", "RP-BLUE", "TAG-100"]  # ordered by SKU
    assert skus(category="GROCERY") == [rice["sku"]]
    assert skus(q="reyn") == [pen["sku"]]  # name, any case
    assert skus(q="rp-") == [pen["sku"]]  # SKU, any case
    assert skus(q="%") == [tags["sku"]]  # a literal %, not a wildcard
    assert skus(q="") == ["RICE-5KG", "RP-BLUE", "TAG-100"]
    assert skus(below_reorder="true") == ["RICE-5KG", "TAG-100"]  # on_hand <= reorder_point
    assert skus(limit=2) == ["RICE-5KG", "RP-BLUE"]
    assert skus(limit=2, offset=2) == ["TAG-100"]


@pytest.mark.parametrize(
    "params",
    [
        {"limit": 0},
        {"limit": 201},
        {"offset": -1},
        {"limit": "ten"},
        {"category": "TOYS"},
        {"below_reorder": "maybe"},
        {"q": "x" * 51},
    ],
)
def test_list_numeric_bounds_are_422(client, params):
    assert client.get("/api/products", params=params).status_code == 422
