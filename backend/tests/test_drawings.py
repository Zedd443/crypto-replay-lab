from backend.app import create_app

def test_rectangle_edit_is_causal_and_persistent(tmp_path):
    app=create_app(tmp_path/"draw.sqlite3")
    client=app.test_client()
    state=client.post("/api/sessions",json={"cursor":200}).get_json()
    sid=state["id"]
    start=state["clock_ms"]-10*60_000
    end=state["clock_ms"]-60_000
    url=f"/api/sessions/{sid}/drawings"
    created=client.post(url,json={"kind":"rectangle","timeframe":"1m",
        "price":102,"end_price":99,"anchor_start":start,"anchor_end":end})
    assert created.status_code==201,created.get_json()
    did=created.get_json()["id"]
    client.post(f"/api/sessions/{sid}/step",json={"amount":1})
    changed={"price":104,"end_price":101,"anchor_start":start,"anchor_end":end}
    patch=client.patch(f"{url}/{did}",json=changed)
    assert patch.status_code==200,patch.get_json()
    assert client.get(url).get_json()[0]["price"]==104
    client.post(f"/api/sessions/{sid}/step",json={"amount":-1})
    assert client.get(url).get_json()[0]["price"]==102
    assert client.patch(f"{url}/{did}",json=changed).status_code==409

def test_chart_long_position_is_drawing_only(tmp_path):
    app=create_app(tmp_path/"position.sqlite3")
    client=app.test_client()
    state=client.post("/api/sessions",json={"cursor":200}).get_json()
    sid=state["id"]
    url=f"/api/sessions/{sid}/drawings"
    created=client.post(url,json={"kind":"long_position","timeframe":"1m",
        "price":100,"end_price":99,"take_profit":102,
        "anchor_start":state["clock_ms"]-120000,"anchor_end":state["clock_ms"]-60000})
    assert created.status_code==201,created.get_json()
    assert client.get(url).get_json()[0]["take_profit"]==102
    assert client.get(f"/api/sessions/{sid}/orders?cursor=200").get_json()==[]
    bad=client.post(url,json={"kind":"long_position","timeframe":"1m",
        "price":100,"end_price":102,"take_profit":99,
        "anchor_start":state["clock_ms"]-120000,"anchor_end":state["clock_ms"]-60000})
    assert bad.status_code==400
