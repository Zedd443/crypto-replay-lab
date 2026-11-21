from backend.app import create_app

def test_ghost_feed_is_drawable_in_future_without_market_leakage(tmp_path):
    c=create_app(tmp_path/"ghost.sqlite3").test_client()
    state=c.post("/api/sessions",json={"cursor":300}).get_json()
    base=f'/api/sessions/{state["id"]}'
    candles_before=c.get(base+'/candles?tf=1h').get_json()['candles']
    clock=state["clock_ms"]
    drawing={"kind":"ghost_feed","timeframe":"1h","price":100,
      "end_price":112,"anchor_start":clock-3600000,
      "anchor_end":clock+3600000*10,"ghost_range":.65,"ghost_variance":.25}
    created=c.post(base+'/drawings',json=drawing)
    assert created.status_code==201,created.get_json()
    saved=c.get(base+'/drawings').get_json()[0]
    assert saved["kind"]=="ghost_feed" and saved["ghost_range"]==.65
    assert saved["ghost_variance"]==.25
    assert c.get(base+'/candles?tf=1h').get_json()['candles']==candles_before
    assert c.patch(base+'/drawings/'+saved["id"],json={**drawing,"ghost_range":1.2}).status_code==200
    assert c.get(base+'/drawings').get_json()[0]["ghost_range"]==1.2
    assert c.post(base+'/drawings',json={**drawing,"ghost_variance":100}).status_code==400
