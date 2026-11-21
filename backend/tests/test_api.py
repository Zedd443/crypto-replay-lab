from io import BytesIO

import pytest

from backend.app import create_app
from backend.engine import MINUTE_MS, TF_MS

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


def test_drawings_follow_replay_cursor(tmp_path):
    client = create_app(tmp_path / "drawings.sqlite3").test_client()
    session = client.post("/api/sessions", json={"cursor": 59}).get_json()
    url = f"/api/sessions/{session['id']}"
    earlier = client.post(f"{url}/drawings", json={"price": 100}).get_json()
    client.post(f"{url}/step", json={"amount": 1})
    later = client.post(f"{url}/drawings", json={"price": 200}).get_json()
    assert [d["id"] for d in client.get(f"{url}/drawings").get_json()] == [earlier["id"], later["id"]]

    rewind = client.post(f"{url}/step", json={"amount": -1}).get_json()
    assert rewind["cursor"] == 59 and rewind["contaminated"]
    assert [d["id"] for d in client.get(f"{url}/drawings").get_json()] == [earlier["id"]]

    client.post(f"{url}/step", json={"amount": 1})
    assert [d["id"] for d in client.get(f"{url}/drawings").get_json()] == [earlier["id"], later["id"]]


@pytest.mark.parametrize("units_per_ms", [1, 1000])
def test_import_rejects_five_minute_klines(tmp_path, units_per_ms):
    client = create_app(tmp_path / "import.sqlite3", seed=False, raw_dir=tmp_path).test_client()
    start = 1767571200000 * units_per_ms
    duration = 5 * MINUTE_MS * units_per_ms
    csv = "".join(f"{ts},100,900,90,800,10,{ts + duration - 1}\n"
                  for ts in (start, start + duration))
    response = client.post("/api/datasets/import", data={"file": (BytesIO(csv.encode()), "5m.csv")})
    assert response.status_code == 400
    assert client.get("/api/datasets").get_json() == []


@pytest.mark.parametrize("units_per_ms, include_close_time", [(1, False), (1, True), (1000, True)])
def test_imported_candles_obey_clock_at_every_timeframe(tmp_path, units_per_ms, include_close_time):
    client = create_app(tmp_path / "import.sqlite3", seed=False, raw_dir=tmp_path).test_client()
    start = 1767571200000  # Monday at midnight UTC
    rows = []
    for offset, high in ((0, 110), (2, 900)):
        ts = (start + offset * MINUTE_MS) * units_per_ms
        close_time = f",{ts + MINUTE_MS * units_per_ms - 1}" if include_close_time else ""
        rows.append(f"{ts},100,{high},90,105,10{close_time}\n")
    response = client.post("/api/datasets/import", data={"file": (BytesIO("".join(rows).encode()), "1m.csv")})
    assert response.status_code == 201
    dataset = response.get_json()
    assert dataset["gap_count"] == 1
    session = client.post("/api/sessions", json={"dataset_id": dataset["id"], "cursor": 0}).get_json()
    url = f"/api/sessions/{session['id']}"

    for tf in TF_MS:
        payload = client.get(f"{url}/candles?tf={tf}").get_json()
        assert payload["clock_ms"] == start + MINUTE_MS
        assert [(c["time"], c["high"], c["complete"]) for c in payload["candles"]] == [
            (start, 110, tf == "1m")
        ]

    stepped = client.post(f"{url}/step", json={"amount": 1}).get_json()
    assert stepped["clock_ms"] == start + 3 * MINUTE_MS
    for tf in TF_MS:
        payload = client.get(f"{url}/candles?tf={tf}").get_json()
        assert payload["clock_ms"] == stepped["clock_ms"]
        assert payload["candles"][-1]["high"] == 900


def test_local_parquet_replay(tmp_path):
    import pyarrow as pa
    import pyarrow.parquet as pq

    start = 1767571200000
    base = TF_MS["15m"]
    raw = tmp_path / "raw"
    raw.mkdir()
    pq.write_table(pa.table({
        "open_time": pa.array([start * 10**6, (start + base) * 10**6], type=pa.timestamp("ns", tz="UTC")),
        "open": [100, 105], "high": [110, 900], "low": [95, 95],
        "close": [105, 120], "volume": [10, 20],
    }), raw / "BTCUSDT_15m.parquet")
    database = tmp_path / "local.sqlite3"
    client = create_app(database, seed=False, raw_dir=raw).test_client()
    dataset = client.get("/api/datasets").get_json()[0]
    assert dataset["id"] == "raw:BTCUSDT" and dataset["base_ms"] == base
    response = client.post("/api/sessions", json={"dataset_id": dataset["id"], "cursor": 0})
    assert response.status_code == 201
    session = response.get_json()
    assert session["clock_ms"] == start + base
    url = f"/api/sessions/{session['id']}"
    for tf in ("1m", "5m"):
        assert client.get(f"{url}/candles?tf={tf}").status_code == 400

    def candle(client, tf):
        payload = client.get(f"{url}/candles?tf={tf}").get_json()
        return payload["candles"][-1]

    assert candle(client, "15m")["complete"]
    assert not candle(client, "1h")["complete"]
    assert candle(client, "1w")["high"] == 110
    assert client.post(f"{url}/step", json={"amount": 1}).get_json()["clock_ms"] == start + 2 * base
    assert candle(client, "1h")["high"] == 900
    client = create_app(database, seed=False, raw_dir=raw).test_client()
    assert client.post(f"{url}/step", json={"amount": -1}).get_json()["clock_ms"] == start + base
    assert candle(client, "1h")["high"] == 110


    # Synchronization appends closed bars without exposing them to the old cursor.
    from backend import binance_source
    def fetch(symbol, since, now):
        assert (symbol, since) == ("BTCUSDT", start + 2 * base)
        return [{"ts": since, "open": 120, "high": 1000, "low": 100, "close": 125, "volume": 5}]
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(binance_source, "fetch_closed", fetch)
        synced = client.post("/api/datasets/raw:BTCUSDT/sync")
    assert synced.status_code == 200 and synced.get_json()["added"] == 1
    assert candle(client, "1h")["high"] == 110
    latest = client.post("/api/sessions", json={"dataset_id": dataset["id"], "start": "latest"}).get_json()
    assert latest["clock_ms"] == start + 3 * base


def test_trendline_anchors_and_rewind(tmp_path):
    client = create_app(tmp_path / "trendline.sqlite3").test_client()
    state = client.post("/api/sessions", json={"cursor": 3}).get_json()
    url = f"/api/sessions/{state['id']}"
    clock = state["clock_ms"]
    drawing = {"kind":"trendline", "timeframe":"1m", "price":100, "end_price":110,
               "anchor_start":clock-2*MINUTE_MS, "anchor_end":clock}
    assert client.post(f"{url}/drawings", json=drawing).status_code == 400
    drawing["anchor_end"] -= MINUTE_MS
    assert client.post(f"{url}/drawings", json=drawing).status_code == 201
    saved = client.get(f"{url}/drawings").get_json()[0]
    assert saved["anchor_end"] == drawing["anchor_end"] and saved["end_price"] == 110
    client.post(f"{url}/step", json={"amount":-1})
    assert client.get(f"{url}/drawings").get_json() == []


def test_delete_drawings_respects_session_and_replay_cursor(tmp_path):
    client = create_app(tmp_path / "delete.sqlite3").test_client()
    def drawings_url():
        session = client.post("/api/sessions", json={"cursor":10}).get_json()
        return f"/api/sessions/{session['id']}/drawings"

    url, other_url = drawings_url(), drawings_url()
    first = client.post(url, json={"price":100}).get_json()["id"]
    client.post(url, json={"price":101})
    other = client.post(other_url, json={"price":102}).get_json()["id"]
    client.post(url.replace("/drawings","/step"), json={"amount":1})
    later = client.post(url, json={"price":103}).get_json()["id"]
    client.post(url.replace("/drawings","/step"), json={"amount":-1})

    assert client.delete(f"{url}/{later}").status_code == 404
    assert client.delete(f"{url}/{other}").status_code == 404
    assert client.delete(f"{url}/{first}").get_json() == {"deleted":1}
    assert client.delete(url).get_json() == {"deleted":1}
    assert client.get(url).get_json() == []
    client.post(url.replace("/drawings","/step"), json={"amount":1})
    assert [d["id"] for d in client.get(url).get_json()] == [later]
    assert [d["id"] for d in client.get(other_url).get_json()] == [other]


@pytest.mark.parametrize("kind",["horizontal_ray","vertical","rectangle"])
def test_new_shapes_save_and_hide_on_rewind(tmp_path,kind):
    client = create_app(tmp_path / "shapes.sqlite3").test_client()
    session = client.post("/api/sessions",json={"cursor":8}).get_json()
    path = f"/api/sessions/{session['id']}"
    clock = session["clock_ms"]
    drawing = {"kind":kind,"timeframe":"1m","price":100,
               "anchor_start":clock-3*MINUTE_MS,"anchor_end":clock-MINUTE_MS,"end_price":105}
    future = dict(drawing,anchor_start=clock)
    assert client.post(f"{path}/drawings",json=future).status_code==400
    response=client.post(f"{path}/drawings",json=drawing)
    assert response.status_code==201
    saved=client.get(f"{path}/drawings").get_json()[0]
    assert saved["kind"]==kind and saved["anchor_start"]==drawing["anchor_start"]
    if kind=="rectangle":
        assert saved["end_price"]==105 and saved["anchor_end"]==drawing["anchor_end"]
    client.post(f"{path}/step",json={"amount":-1})
    assert client.get(f"{path}/drawings").get_json()==[]
