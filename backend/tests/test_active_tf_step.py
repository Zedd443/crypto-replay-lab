from backend.app import create_app

def test_active_tf_step_and_rewind(tmp_path):
    client=create_app(tmp_path/"step.sqlite3").test_client()
    state=client.post("/api/sessions",json={"cursor":1600}).get_json()
    url=f'/api/sessions/{state["id"]}/step'
    first=client.post(url,json={"amount":1,"timeframe":"1d"})
    assert first.status_code==200,first.get_json()
    assert first.get_json()["cursor"]>state["cursor"]+1000
    assert first.get_json()["clock_ms"]%86400000==0
    back=client.post(url,json={"amount":-1,"timeframe":"1d"})
    assert back.status_code==200,back.get_json()
    assert back.get_json()["clock_ms"]==state["clock_ms"]//86400000*86400000
    assert back.get_json()["contaminated"] is True
    assert client.post(url,json={"amount":1,"timeframe":"7h"}).status_code==400
