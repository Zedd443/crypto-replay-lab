"""Flask API for a local-first manual crypto replay prototype."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import csv
import io
import os
import sqlite3
import uuid
import zipfile

from flask import Flask, jsonify, request, g
from .engine import MINUTE_MS, TF_MS, aggregate, synthetic_candles, validate_and_normalize

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "replay.sqlite3"
MAX_UPLOAD = 30 * 1024 * 1024
MAX_UNCOMPRESSED = 70 * 1024 * 1024


def create_app(database_path: str | Path | None = None, seed: bool = True) -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD
    app.config["DB_PATH"] = str(database_path or os.environ.get("CRL_DB_PATH") or DEFAULT_DB)

    def db():
        if "db" not in g:
            g.db = sqlite3.connect(app.config["DB_PATH"])
            g.db.row_factory = sqlite3.Row
        return g.db

    @app.teardown_appcontext
    def close_db(exc):
        conn = g.pop("db", None)
        if conn is not None:
            conn.close()

    def session_row(session_id):
        row = db().execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if row is None:
            return None
        return row

    def snapshot(row):
        time_row = db().execute(
            "SELECT ts FROM candles WHERE dataset_id=? AND seq=?",
            (row["dataset_id"],row["cursor"])
        ).fetchone()
        total = db().execute(
            "SELECT COUNT(*) AS n FROM candles WHERE dataset_id=?",(row["dataset_id"],)
        ).fetchone()["n"]
        return {"id":row["id"],"dataset_id":row["dataset_id"],"cursor":row["cursor"],
                "max_seen_cursor":row["max_seen_cursor"],"contaminated":bool(row["contaminated"]),
                "timeframe":row["timeframe"],"clock_ms":time_row["ts"]+MINUTE_MS,"total":total}

    with app.app_context():
        path = Path(app.config["DB_PATH"])
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = db()
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS datasets (
            id TEXT PRIMARY KEY, symbol TEXT NOT NULL, is_demo INTEGER NOT NULL,
            gap_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS candles (
            dataset_id TEXT NOT NULL, seq INTEGER NOT NULL, ts INTEGER NOT NULL,
            open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL,
            close REAL NOT NULL, volume REAL NOT NULL,
            PRIMARY KEY (dataset_id, seq),
            UNIQUE (dataset_id, ts)
        );
        CREATE INDEX IF NOT EXISTS ix_candles_time ON candles(dataset_id, ts);
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY, dataset_id TEXT NOT NULL, cursor INTEGER NOT NULL,
            max_seen_cursor INTEGER NOT NULL, contaminated INTEGER NOT NULL DEFAULT 0,
            timeframe TEXT NOT NULL DEFAULT '1h', created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS drawings (
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL, kind TEXT NOT NULL,
            timeframe TEXT NOT NULL, price REAL NOT NULL, created_at_cursor INTEGER NOT NULL,
            created_at_ts INTEGER NOT NULL
        );
        """)
        exists = conn.execute("SELECT id FROM datasets WHERE id='synthetic-demo'").fetchone()
        if seed and not exists:
            now = datetime.now(timezone.utc).isoformat()
            conn.execute("INSERT INTO datasets(id,symbol,is_demo,created_at) VALUES (?,?,?,?)",
                         ("synthetic-demo", "SYNTHETIC/DEMO", 1, now))
            demo = synthetic_candles()
            conn.executemany("INSERT INTO candles VALUES (?,?,?,?,?,?,?,?)",
                [("synthetic-demo",i,c["ts"],c["open"],c["high"],c["low"],c["close"],c["volume"])
                 for i,c in enumerate(demo)])
        conn.commit()

    @app.get("/api/health")
    def health():
        return jsonify({"status":"ok","version":"0.1.0","warning":"research prototype, no live trading"})

    @app.get("/api/datasets")
    def datasets():
        rows = db().execute("""
            SELECT d.id,d.symbol,d.is_demo,d.gap_count,COUNT(c.seq) AS candles,
                   MIN(c.ts) AS first_ms,MAX(c.ts) AS last_ms
            FROM datasets d LEFT JOIN candles c ON c.dataset_id=d.id
            GROUP BY d.id ORDER BY d.is_demo ASC,d.created_at DESC
        """).fetchall()
        return jsonify([dict(r) for r in rows])

    @app.post("/api/datasets/import")
    def import_dataset():
        file = request.files.get("file")
        symbol = request.form.get("symbol","BTCUSDT").strip().upper()[:32]
        if not file or not symbol or not (file.filename or "").lower().endswith((".csv",".zip")):
            return jsonify({"error":"supply a Binance 1m CSV/ZIP and symbol"}),400
        raw = file.read()
        if len(raw) > MAX_UPLOAD:
            return jsonify({"error":"file exceeds 30MB"}),413
        if (file.filename or "").lower().endswith(".zip"):
            try:
                zf = zipfile.ZipFile(io.BytesIO(raw))
                members = [i for i in zf.infolist() if not i.is_dir() and i.filename.lower().endswith(".csv")]
                if len(members) != 1 or members[0].file_size > MAX_UNCOMPRESSED:
                    return jsonify({"error":"ZIP must contain one CSV under 70MB"}),400
                raw = zf.read(members[0])
            except (zipfile.BadZipFile,RuntimeError):
                return jsonify({"error":"bad ZIP archive"}),400
        if len(raw) > MAX_UNCOMPRESSED:
            return jsonify({"error":"uncompressed CSV too large"}),413
        try:
            reader = csv.reader(io.StringIO(raw.decode("utf-8-sig")))
            parsed = []
            for row in reader:
                if not row: continue
                if row[0].lower() in ("open_time","timestamp"): continue
                if len(row)<6: raise ValueError("expected Binance kline columns")
                ts = int(row[0])
                if ts >= 10**14: ts //= 1000
                parsed.append(dict(ts=ts,open=row[1],high=row[2],low=row[3],
                                   close=row[4],volume=row[5]))
            rows,gaps = validate_and_normalize(parsed)
        except (UnicodeError,ValueError,IndexError) as err:
            return jsonify({"error":str(err)}),400
        dataset_id = str(uuid.uuid4())
        conn = db()
        try:
            conn.execute("INSERT INTO datasets VALUES (?,?,?,?,?)",
                        (dataset_id,symbol,0,gaps,datetime.now(timezone.utc).isoformat()))
            conn.executemany("INSERT INTO candles VALUES (?,?,?,?,?,?,?,?)",
                [(dataset_id,i,r["ts"],r["open"],r["high"],r["low"],r["close"],r["volume"])
                 for i,r in enumerate(rows)])
            conn.commit()
        except sqlite3.Error:
            conn.rollback()
            return jsonify({"error":"failed to store dataset"}),500
        return jsonify({"id":dataset_id,"symbol":symbol,"candles":len(rows),"gap_count":gaps}),201

    @app.post("/api/sessions")
    def create_session():
        payload = request.get_json(silent=True) or {}
        dataset_id = payload.get("dataset_id","synthetic-demo")
        row = db().execute("SELECT COUNT(*) AS n FROM candles WHERE dataset_id=?",(dataset_id,)).fetchone()
        count = row["n"]
        if count < 2: return jsonify({"error":"dataset not found"}),404
        try:
            cursor = int(payload.get("cursor",min(count-1,14*1440)))
        except (ValueError,TypeError):
            return jsonify({"error":"bad cursor"}),400
        if not 0 <= cursor < count: return jsonify({"error":"cursor out of range"}),400
        session_id = str(uuid.uuid4())
        db().execute("INSERT INTO sessions VALUES (?,?,?,?,?,?,?)",
                     (session_id,dataset_id,cursor,cursor,0,"1h",datetime.now(timezone.utc).isoformat()))
        db().commit()
        return jsonify(snapshot(session_row(session_id))),201

    @app.get("/api/sessions/<session_id>")
    def get_session(session_id):
        row = session_row(session_id)
        if row is None:return jsonify({"error":"session not found"}),404
        return jsonify(snapshot(row))

    @app.post("/api/sessions/<session_id>/step")
    def step(session_id):
        row = session_row(session_id)
        if row is None:return jsonify({"error":"session not found"}),404
        payload = request.get_json(silent=True) or {}
        try: amount = int(payload.get("amount",1))
        except (TypeError,ValueError):return jsonify({"error":"invalid amount"}),400
        if abs(amount)>1440 or amount==0:return jsonify({"error":"amount must be between -1440 and 1440, excluding 0"}),400
        count = db().execute("SELECT COUNT(*) AS n FROM candles WHERE dataset_id=?",(row["dataset_id"],)).fetchone()["n"]
        cursor = max(0,min(count-1,row["cursor"]+amount))
        max_seen = max(row["max_seen_cursor"],cursor)
        contaminated = int(bool(row["contaminated"]) or cursor < row["max_seen_cursor"])
        db().execute("UPDATE sessions SET cursor=?,max_seen_cursor=?,contaminated=? WHERE id=?",
                     (cursor,max_seen,contaminated,session_id))
        db().commit()
        return jsonify(snapshot(session_row(session_id)))

    @app.get("/api/sessions/<session_id>/candles")
    def candles(session_id):
        row = session_row(session_id)
        if row is None:return jsonify({"error":"session not found"}),404
        tf = request.args.get("tf","1h")
        if tf not in TF_MS:return jsonify({"error":"unsupported timeframe"}),400
        # Fetch only bars up to replay cursor. Never query an unobserved future candle.
        visible = db().execute(
            "SELECT ts,open,high,low,close,volume FROM candles WHERE dataset_id=? AND seq<=? ORDER BY seq",
            (row["dataset_id"],row["cursor"])
        ).fetchall()
        clock = visible[-1]["ts"]+MINUTE_MS
        aggregated = aggregate([dict(r) for r in visible],tf,clock)
        # Limit response size, but aggregate from the full visible history first.
        return jsonify({"timeframe":tf,"clock_ms":clock,"candles":aggregated[-1200:],
                        "total_visible":len(aggregated),"truncated":len(aggregated)>1200})

    @app.get("/api/sessions/<session_id>/drawings")
    def list_drawings(session_id):
        if session_row(session_id) is None:return jsonify({"error":"session not found"}),404
        rows = db().execute("SELECT * FROM drawings WHERE session_id=? ORDER BY created_at_cursor",
                            (session_id,)).fetchall()
        return jsonify([dict(row) for row in rows])

    @app.post("/api/sessions/<session_id>/drawings")
    def create_drawing(session_id):
        row = session_row(session_id)
        if row is None:return jsonify({"error":"session not found"}),404
        payload = request.get_json(silent=True) or {}
        try:
            kind = payload.get("kind","horizontal")
            tf = payload.get("timeframe","1h")
            price = float(payload["price"])
            if kind != "horizontal" or tf not in TF_MS or not (price>0 and price<1e12):
                raise ValueError("invalid drawing")
        except (ValueError,TypeError,KeyError):
            return jsonify({"error":"invalid drawing"}),400
        candle = db().execute("SELECT ts FROM candles WHERE dataset_id=? AND seq=?",
                              (row["dataset_id"],row["cursor"])).fetchone()
        drawing_id = str(uuid.uuid4())
        db().execute("INSERT INTO drawings VALUES (?,?,?,?,?,?,?)",
                     (drawing_id,session_id,kind,tf,price,row["cursor"],candle["ts"]))
        db().commit()
        return jsonify({"id":drawing_id,"kind":kind,"timeframe":tf,"price":price,
                        "created_at_cursor":row["cursor"]}),201

    return app


app = create_app()

if __name__ == "__main__":
    # Localhost only; never expose publicly without authentication and HTTPS.
    app.run(host="127.0.0.1",port=5000,debug=False)
