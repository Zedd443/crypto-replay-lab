from io import BytesIO

import pytest

from backend.app import create_app
from backend.engine import MINUTE_MS


def replay(tmp_path, prices):
    client = create_app(tmp_path / "brackets.sqlite3", seed=False, raw_dir=tmp_path).test_client()
    start = 1767571200000
    csv = "".join(f"{start+i*MINUTE_MS},{o},{h},{l},{c},100\n"
                  for i,(o,h,l,c) in enumerate(prices))
    dataset = client.post("/api/datasets/import",data={"file":(BytesIO(csv.encode()),"1m.csv")}).get_json()
    state = client.post("/api/sessions",json={"dataset_id":dataset["id"],"cursor":0}).get_json()
    return client,f"/api/sessions/{state['id']}"


def place(client,url,side="long"):
    outcome = client.post(f"{url}/orders",json={"mode":"bracket","cursor":0,"side":side,
                         "quantity":2,"tp_percent":10,"sl_percent":5})
    assert outcome.status_code == 201
    return outcome.get_json()["id"]


@pytest.mark.parametrize("side,open_price,high,low,reason,exit_price",[
    ("long",100,115,94,"sl",95),
    ("short",100,106,85,"sl",105),
    ("long",93,110,91,"sl",93),
    ("short",88,103,86,"tp",88),
    ("long",101,115,98,"tp",110),
    ("short",101,103,88,"tp",90),
])
def test_bracket_can_only_trigger_on_following_bars(tmp_path,side,open_price,high,low,reason,exit_price):
    client,url = replay(tmp_path,[(100,130,70,100),(open_price,high,low,100)])
    place(client,url,side)
    current = client.get(f"{url}/orders").get_json()[0]
    assert (current["status"],current["entry_price"],current["exit_price"]) == ("open",100,None)
    client.post(f"{url}/step",json={"amount":1})
    current = client.get(f"{url}/orders").get_json()[0]
    assert current["exit_reason"] == reason
    assert current["exit_price"] == pytest.approx(exit_price)
    client.post(f"{url}/step",json={"amount":-1})
    assert client.get(f"{url}/orders").get_json()[0]["exit_price"] is None


def test_bracket_drag_is_cursor_scoped(tmp_path):
    client,url = replay(tmp_path,[(100,103,98,100),(100,106,97,100),(100,106,97,100)])
    order_id = place(client,url)
    path = f"{url}/paper-positions/{order_id}"
    client.post(f"{url}/step",json={"amount":1})
    assert client.patch(path,json={"cursor":1,"take_profit":104}).status_code == 200
    # Candle 1 already touched 104; the new level cannot retroactively fill there.
    assert client.get(f"{url}/orders").get_json()[0]["status"] == "open"
    client.post(f"{url}/step",json={"amount":-1})
    before = client.get(f"{url}/orders").get_json()[0]
    assert before["take_profit"] == pytest.approx(110)
    assert client.patch(path,json={"cursor":0,"take_profit":105}).status_code == 409
    client.post(f"{url}/step",json={"amount":2})
    assert client.get(f"{url}/orders").get_json()[0]["exit_price"] == 104


def test_manual_close_uses_current_replay_price(tmp_path):
    client,url = replay(tmp_path,[(100,103,98,100),(101,103,98,102)])
    order_id = place(client,url)
    client.post(f"{url}/step",json={"amount":1})
    outcome = client.post(f"{url}/paper-positions/{order_id}/close",json={"cursor":1})
    assert outcome.status_code == 200
    order = client.get(f"{url}/orders").get_json()[0]
    assert (order["exit_reason"],order["exit_price"],order["pnl"]) == ("manual",102,4)
