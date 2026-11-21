import pytest

from backend.app import create_app
from backend.engine import synthetic_candles


@pytest.mark.parametrize("side,sign",[("long",1),("short",-1)])
def test_market_fill_and_exit_follow_cursor(tmp_path, side, sign):
    client=create_app(tmp_path/"orders.sqlite3").test_client()
    state=client.post("/api/sessions",json={"cursor":2}).get_json()
    url=f"/api/sessions/{state['id']}"
    order_url=f"{url}/orders"

    stale=client.post(order_url,json={"side":side,"quantity":2,"cursor":1})
    assert stale.status_code==409
    placed=client.post(order_url,json={"side":side,"quantity":2,"cursor":2})
    assert placed.status_code==201
    order_id=placed.get_json()["id"]

    def order():
        return client.get(order_url).get_json()[0]

    assert (order()["status"],order()["entry_price"],order()["pnl"])==("pending",None,None)
    client.post(f"{url}/step",json={"amount":2})
    assert client.get(order_url+"?cursor=2").status_code==409
    candles=synthetic_candles(6)
    assert order()["status"]=="open"
    assert order()["entry_price"]==candles[3]["open"]
    assert order()["pnl"]==pytest.approx(sign*2*(candles[4]["close"]-candles[3]["open"]))

    assert client.post(f"{order_url}/{order_id}/close",json={"cursor":4}).status_code==200
    assert order()["status"]=="closing" and order()["exit_price"] is None
    client.post(f"{url}/step",json={"amount":1})
    assert order()["status"]=="closed"
    assert order()["exit_price"]==candles[5]["open"]
    assert order()["pnl"]==pytest.approx(sign*2*(candles[5]["open"]-candles[3]["open"]))

    client.post(f"{url}/step",json={"amount":-3})
    assert order()["status"]=="pending" and order()["entry_ms"] is None and order()["exit_ms"] is None
    client.post(f"{url}/step",json={"amount":-1})
    assert client.get(order_url).get_json()==[]


def test_cancel_and_validate_market_orders(tmp_path):
    client=create_app(tmp_path/"cancel.sqlite3").test_client()
    state=client.post("/api/sessions",json={"cursor":0}).get_json()
    url=f"/api/sessions/{state['id']}/orders"
    bad=client.post(url,json={"side":"long","quantity":"NaN","cursor":0})
    assert bad.status_code==400
    placed=client.post(url,json={"side":"long","quantity":1,"cursor":0}).get_json()
    assert client.delete(f"{url}/{placed['id']}").status_code==200
    assert client.get(url).get_json()==[]

    latest=client.post("/api/sessions",json={"start":"latest"}).get_json()
    assert client.post(f"/api/sessions/{latest['id']}/orders",
        json={"side":"short","quantity":1,"cursor":latest["cursor"]}).status_code==409
