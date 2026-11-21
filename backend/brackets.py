"""Paper positions using only replay-visible prices and cursor-scoped bracket edits."""

import math
import uuid

SCHEMA = """
CREATE TABLE IF NOT EXISTS paper_positions (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, side TEXT NOT NULL,
    quantity REAL NOT NULL, placed_cursor INTEGER NOT NULL,
    entry_price REAL NOT NULL, entry_ms INTEGER NOT NULL, manual_exit_cursor INTEGER,
    drawing_id TEXT
);
CREATE INDEX IF NOT EXISTS ix_paper_positions_session ON paper_positions(session_id, placed_cursor);
CREATE TABLE IF NOT EXISTS paper_brackets (
    position_id TEXT NOT NULL, cursor INTEGER NOT NULL,
    take_profit REAL NOT NULL, stop_loss REAL NOT NULL,
    PRIMARY KEY(position_id, cursor)
);
"""


def mark(conn, state):
    return conn.execute("SELECT close,ts FROM candles WHERE dataset_id=? AND seq=?",
                        (state["dataset_id"], state["cursor"])).fetchone()


def place(conn, state, side, quantity, payload):
    current = mark(conn,state)
    price = current["close"]
    direction = 1 if side == "long" else -1
    drawing_id = payload.get("drawing_id")
    if drawing_id is not None:
        drawing = conn.execute("""SELECT d.*,COALESCE(e.price,d.price) AS effective_price,
            COALESCE(e.end_price,d.end_price) AS effective_stop,
            COALESCE(e.take_profit,d.take_profit) AS effective_target
            FROM drawings d LEFT JOIN drawing_edits e
            ON e.drawing_id=d.id AND e.cursor=(SELECT MAX(cursor) FROM drawing_edits
              WHERE drawing_id=d.id AND cursor<=?)
            WHERE d.id=? AND d.session_id=? AND d.created_at_cursor<=?""",
            (state["cursor"],drawing_id,state["id"],state["cursor"])).fetchone()
        if drawing is None or drawing["kind"] != side+"_position":
            raise ValueError("Selected drawing is missing or has the wrong direction.")
        if abs(drawing["effective_price"] / price-1) > 0.001:
            raise ValueError("Drawing entry is not at replay market price (0.1% tolerance). Adjust entry or use a separate market order.")
        take_price=float(drawing["effective_target"])
        stop_price=float(drawing["effective_stop"])
    else:
        take = float(payload["tp_percent"])
        stop = float(payload["sl_percent"])
        if not (0 < take < 100 and 0 < stop < 100):
            raise ValueError("TP and SL percentages must be between 0 and 100.")
        take_price = price * (1 + direction * take / 100)
        stop_price = price * (1 - direction * stop / 100)
    if not valid_levels(side, price, take_price, stop_price):
        raise ValueError("Percentages must resolve to two distinct valid price levels.")
    position_id = str(uuid.uuid4())
    cursor = state["cursor"]
    conn.execute("""INSERT INTO paper_positions
        (id,session_id,side,quantity,placed_cursor,entry_price,entry_ms,manual_exit_cursor,drawing_id)
        VALUES (?,?,?,?,?,?,?,NULL,?)""",
                 (position_id,state["id"],side,quantity,cursor,price,current["ts"]+state["base_ms"],drawing_id))
    conn.execute("INSERT INTO paper_brackets VALUES (?,?,?,?)",
                 (position_id,cursor,take_price,stop_price))
    return position_id


def valid_levels(side, current, take, stop):
    if not (math.isfinite(take) and math.isfinite(stop)):
        return False
    return 0 < stop < current < take if side == "long" else 0 < take < current < stop


def view(conn, state, position, current):
    cursor = state["cursor"]
    end = position["manual_exit_cursor"] if position["manual_exit_cursor"] is not None else cursor
    end = min(end,cursor)
    changes = conn.execute("""
        SELECT cursor,take_profit,stop_loss FROM paper_brackets
        WHERE position_id=? AND cursor<=? ORDER BY cursor
    """,(position["id"],end)).fetchall()
    long = position["side"] == "long"
    hit = None
    reason = None
    exit_price = exit_ms = None
    for i, levels in enumerate(changes):
        take, stop = levels["take_profit"], levels["stop_loss"]
        until = changes[i+1]["cursor"] if i+1 < len(changes) else end
        low, high = (stop,take) if long else (take,stop)
        hit = conn.execute("""
            SELECT open, high, low, ts FROM candles
            WHERE dataset_id=? AND seq>? AND seq<=? AND (low<=? OR high>=?)
            ORDER BY seq LIMIT 1
        """,(state["dataset_id"],levels["cursor"],until,low,high)).fetchone()
        if hit is None:
            continue
        opening = hit["open"]
        if (long and opening<=stop) or (not long and opening>=stop):
            reason,exit_price = "sl",opening
        elif (long and opening>=take) or (not long and opening<=take):
            reason,exit_price = "tp",opening
        elif (long and hit["low"]<=stop) or (not long and hit["high"]>=stop):
            # A base candle has no intrabar sequence. Favor the stop on a tie.
            reason,exit_price = "sl",stop
        else:
            reason,exit_price = "tp",take
        exit_ms = hit["ts"]+state["base_ms"]
        break

    if not reason and position["manual_exit_cursor"] == end and end<=cursor:
        closed = conn.execute("SELECT close,ts FROM candles WHERE dataset_id=? AND seq=?",
                              (state["dataset_id"],end)).fetchone()
        reason,exit_price,exit_ms = "manual",closed["close"],closed["ts"]+state["base_ms"]

    entry = position["entry_price"]
    price = current["close"] if exit_price is None else exit_price
    return {key:position[key] for key in ("id","side","quantity","entry_price","entry_ms","drawing_id")} | {
        "mode":"bracket","status":"closed" if reason else "open",
        "take_profit":take,"stop_loss":stop,"exit_reason":reason,
        "exit_price":exit_price,"exit_ms":exit_ms,
        "pnl":(price-entry)*position["quantity"]*(1 if long else -1),
    }


def list_positions(conn, state):
    positions = conn.execute("""
        SELECT * FROM paper_positions WHERE session_id=? AND placed_cursor<=?
        ORDER BY placed_cursor,rowid
    """,(state["id"],state["cursor"])).fetchall()
    if not positions:
        return []
    current = mark(conn,state)
    return [view(conn,state,position,current) for position in positions]


def manage(conn, state, position, payload, action):
    current = mark(conn,state)
    rendered = view(conn,state,position,current)
    if rendered["status"] != "open":
        raise ValueError("Position already closed.")
    if action == "close":
        conn.execute("UPDATE paper_positions SET manual_exit_cursor=? WHERE id=?",
                     (state["cursor"],position["id"]))
        return
    take = float(payload.get("take_profit",rendered["take_profit"]))
    stop = float(payload.get("stop_loss",rendered["stop_loss"]))
    if not valid_levels(position["side"],current["close"],take,stop):
        raise ValueError("Keep TP and SL on opposite sides of the current replay price.")
    conn.execute("""INSERT INTO paper_brackets VALUES (?,?,?,?)
        ON CONFLICT(position_id,cursor) DO UPDATE SET
        take_profit=excluded.take_profit,stop_loss=excluded.stop_loss""",
        (position["id"],state["cursor"],take,stop))
