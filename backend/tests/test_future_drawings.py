from backend.app import create_app

def test_future_drawing_plans_allow_blank_time_but_enforce_horizon(tmp_path):
    c=create_app(tmp_path/"future.sqlite3").test_client()
    state=c.post('/api/sessions',json={'cursor':300}).get_json()
    base=f'/api/sessions/{state["id"]}/drawings'
    clock=state['clock_ms']
    payload={'kind':'rectangle','timeframe':'1h','price':100,'end_price':110,
      'anchor_start':clock+3600000,'anchor_end':clock+3600000*12}
    created=c.post(base,json=payload)
    assert created.status_code==201,created.get_json()
    drawing_id=created.get_json()['id']
    assert c.get(base).get_json()[0]['anchor_end']==payload['anchor_end']
    edited={**payload,'anchor_end':clock+3600000*24}
    assert c.patch(base+'/'+drawing_id,json=edited).status_code==200
    assert c.get(base).get_json()[0]['anchor_end']==edited['anchor_end']
    assert c.post(base,json={**payload,'anchor_end':clock+3600000*100}).status_code==400
    assert c.patch(base+'/'+drawing_id,json={**edited,'anchor_end':clock+3600000*100}).status_code==400
