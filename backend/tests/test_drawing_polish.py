"""Multi-point and extendable trendlines preserve replay-scoped geometry."""
from backend.app import create_app

def test_polyline_persists_ordered_anchor_points(tmp_path):
    app=create_app(tmp_path/"path.sqlite3")
    client=app.test_client()
    state=client.post("/api/sessions",json={"cursor":300}).get_json()
    base=f"/api/sessions/{state['id']}"
    clock=state["clock_ms"]
    points=[{"time":clock-240000,"price":100},
            {"time":clock-180000,"price":102},
            {"time":clock-60000,"price":101}]
    payload={"kind":"polyline","timeframe":"1m","price":100,"end_price":101,
      "anchor_start":points[0]["time"],"anchor_end":points[-1]["time"],"points":points}
    created=client.post(base+"/drawings",json=payload)
    assert created.status_code==201,created.get_json()
    rows=client.get(base+"/drawings").get_json()
    drawing=next(x for x in rows if x["id"]==created.get_json()["id"])
    assert drawing["points"]==points
    assert drawing["extend_mode"]=="none"
    assert client.post(base+"/drawings",json={**payload,"points":points[::-1]}).status_code==400
    assert client.post(base+"/drawings",json={**payload,"points":points[:2]}).status_code==400
    assert client.post(base+"/drawings",json={**payload,"points":[*points[:2],{
        "time":clock+81*60000,"price":101}]}).status_code==400

def test_trendline_can_extend_without_changing_anchor_coordinates(tmp_path):
    app=create_app(tmp_path/"extend.sqlite3")
    client=app.test_client()
    state=client.post("/api/sessions",json={"cursor":300}).get_json()
    base=f"/api/sessions/{state['id']}"
    clock=state["clock_ms"]
    creation={"kind":"trendline","timeframe":"1m","price":100,"end_price":103,
      "anchor_start":clock-180000,"anchor_end":clock-60000}
    response=client.post(base+"/drawings",json=creation)
    assert response.status_code==201,response.get_json()
    id=response.get_json()["id"]
    assert client.patch(base+"/drawings/"+id,json={"extend_mode":"both"}).status_code==200
    latest=client.get(base+"/drawings").get_json()[0]
    assert latest["extend_mode"]=="both"
    assert latest["price"]==100 and latest["end_price"]==103
    assert client.patch(base+"/drawings/"+id,json={"extend_mode":"all"}).status_code==400
    assert client.post(base+"/drawings",json={**creation,"extend_mode":"up"}).status_code==400
