from backend.app import create_app

def test_fibonacci_draw_and_custom_color(tmp_path):
    client=create_app(tmp_path/"fib.sqlite3").test_client()
    state=client.post("/api/sessions",json={"cursor":300}).get_json()
    url=f'/api/sessions/{state["id"]}/drawings'
    payload={"kind":"fib","timeframe":"1m","price":105,"end_price":98,
        "anchor_start":state["clock_ms"]-180000,
        "anchor_end":state["clock_ms"]-60000,"color":"#ffab22"}
    created=client.post(url,json=payload)
    assert created.status_code==201, created.get_json()
    drawing_id=created.get_json()["id"]
    row=client.get(url).get_json()[0]
    assert row["color"]=="#ffab22" and row["kind"]=="fib"
    assert client.patch(url+'/'+drawing_id,json={"color":"#123abc"}).status_code==200
    assert client.get(url).get_json()[0]["color"]=="#123abc"
    assert client.patch(url+'/'+drawing_id,json={"color":"bad"}).status_code==400
    payload["price"]=107
    assert client.patch(url+'/'+drawing_id,json=payload).status_code==200
    assert client.get(url).get_json()[0]["price"]==107
    assert client.post(url,json={**payload,"color":"javascript:alert(1)"}).status_code==400
