"""Summary API: exact integer values and the server-side 24 h and 7 day windows.

The windows are SQL filters with bound cutoffs, so they must agree on SQLite (naive timestamps)
and Postgres (aware timestamps).
"""


def test_summary_values(client, make_product, move):
    pen = make_product(unit_cost_paise=1050, reorder_point=20)
    ink = make_product(name="Camlin ink 60 ml", unit_cost_paise=2500, reorder_point=5)
    move(pen["id"], "IN", 160)
    move(pen["id"], "OUT", 20)
    move(ink["id"], "IN", 10)
    move(ink["id"], "OUT", 7)

    summary = client.get("/api/summary").json()
    assert summary["inventory_value_paise"] == 154_500  # 140 x 1050 + 3 x 2500, exact paise
    assert summary["product_count"] == 2
    assert summary["items_below_reorder"] == 1  # the ink: 3 <= 5
    below = client.get("/api/products", params={"below_reorder": "true"}).json()
    assert summary["items_below_reorder"] == len(below)
    assert (summary["movements_24h"], summary["units_out_7d"]) == (4, 27)


def test_summary_24h_vs_7d_windows_with_backdated_fixture(client, backdated_ledger):
    summary = client.get("/api/summary").json()
    assert summary["movements_24h"] == backdated_ledger["movements_24h"]  # OUT 5 @ -2 h only
    assert summary["units_out_7d"] == backdated_ledger["units_out_7d"]  # 7 @ -3 d + 5 @ -2 h
    assert summary["inventory_value_paise"] == backdated_ledger["on_hand"] * 1050
    [mover] = summary["top_movers"]
    assert (mover["product_id"], mover["units_out_7d"]) == (backdated_ledger["product_id"], 12)


def test_summary_top_movers_top5_order(client, make_product, move):
    for units in range(1, 7):
        product = make_product(sku=f"MOVER-{units}", name=f"Mover {units}", unit="box")
        move(product["id"], "IN", 10)
        move(product["id"], "OUT", units)

    top = client.get("/api/summary").json()["top_movers"]
    assert [mover["units_out_7d"] for mover in top] == [6, 5, 4, 3, 2]
    assert top[0] == {
        "product_id": top[0]["product_id"],
        "sku": "MOVER-6",
        "name": "Mover 6",
        "unit": "box",
        "units_out_7d": 6,
    }


def test_summary_empty_database_zeroes(client):
    assert client.get("/api/summary").json() == {
        "inventory_value_paise": 0,
        "product_count": 0,
        "items_below_reorder": 0,
        "movements_24h": 0,
        "units_out_7d": 0,
        "top_movers": [],
    }
