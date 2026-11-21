from backend.app import create_app

def test_drawn_position_executes_at_market_and_links_to_drawing(tmp_path):
    app=create_app(tmp_path/"sync.sqlite3")
    client=app.test_client()
    state=client.post("/api/sessions",json={"cursor":300}).get_json()
    base=f'/api/sessions/{state["id"]}'
    candles=client.get(base+'/candles?tf=1m').get_json()['candles']
    price=candles[-1]['close']
    clock=state['clock_ms']
    plan={"kind":"long_position","timeframe":"1m","price":price,
          "end_price":price*.99,"take_profit":price*1.02,
          "anchor_start":clock-180000,"anchor_end":clock-60000}
    created=client.post(base+'/drawings',json=plan)
    assert created.status_code==201,created.get_json()
    drawing_id=created.get_json()['id']
    order=client.post(base+'/orders',json={"mode":"bracket","side":"long","quantity":2,
                                            "cursor":state["cursor"],"drawing_id":drawing_id})
    assert order.status_code==201,order.get_json()
    row=next(o for o in client.get(base+'/orders').get_json() if o['id']==order.get_json()['id'])
    assert row['drawing_id']==drawing_id
    assert row['take_profit']==plan['take_profit']
    assert row['stop_loss']==plan['end_price']

def test_drawing_must_be_at_market_and_same_session(tmp_path):
    client=create_app(tmp_path/"strict.sqlite3").test_client()
    state=client.post("/api/sessions",json={"cursor":300}).get_json()
    base=f'/api/sessions/{state["id"]}'
    price=client.get(base+'/candles?tf=1m').get_json()['candles'][-1]['close']
    plan={"kind":"short_position","timeframe":"1m","price":price*1.03,
          "end_price":price*1.05,"take_profit":price*.98,
          "anchor_start":state["clock_ms"]-180000,"anchor_end":state["clock_ms"]-60000}
    drawing_id=client.post(base+'/drawings',json=plan).get_json()['id']
    order=client.post(base+'/orders',json={"mode":"bracket","side":"short","quantity":1,
                                           "cursor":state["cursor"],"drawing_id":drawing_id})
    assert order.status_code==400
    assert 'not at replay market price' in order.get_json()['error']
