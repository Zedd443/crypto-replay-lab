from backend.app import create_app

def test_session_resume_rewind_and_causal_candles(tmp_path):
    app=create_app(tmp_path/"test.sqlite3")
    client=app.test_client()
    assert client.get("/api/health").status_code==200
    sess=client.post("/api/sessions",json={"cursor":1500}).get_json()
    sid=sess["id"]
    candles=client.get(f"/api/sessions/{sid}/candles?tf=1d").get_json()
    assert candles["clock_ms"]==sess["clock_ms"]
    assert candles["candles"][-1]["time"]<=sess["clock_ms"]
    assert candles["candles"][-1]["complete"] is False
    forward=client.post(f"/api/sessions/{sid}/step",json={"amount":3}).get_json()
    assert forward["cursor"]==1503 and not forward["contaminated"]
    backward=client.post(f"/api/sessions/{sid}/step",json={"amount":-1}).get_json()
    assert backward["contaminated"]
    assert client.get(f"/api/sessions/{sid}").get_json()["cursor"]==1502

def test_drawing_persists(tmp_path):
    app=create_app(tmp_path/"drawing.sqlite3")
    client=app.test_client()
    session=client.post("/api/sessions",json={"cursor":200}).get_json()
    sid=session["id"]
    created=client.post(f"/api/sessions/{sid}/drawings",
                        json={"kind":"horizontal","timeframe":"1h","price":123.45})
    assert created.status_code==201
    drawings=client.get(f"/api/sessions/{sid}/drawings").get_json()
    assert len(drawings)==1 and drawings[0]["price"]==123.45

def test_invalid_timeframe_and_amount(tmp_path):
    app=create_app(tmp_path/"invalid.sqlite3")
    client=app.test_client()
    session=client.post("/api/sessions").get_json()
    sid=session["id"]
    assert client.get(f"/api/sessions/{sid}/candles?tf=2h").status_code==400
    assert client.post(f"/api/sessions/{sid}/step",json={"amount":2000}).status_code==400
