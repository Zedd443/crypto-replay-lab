"""Simulated market orders derived from the current replay cursor."""

import math
import uuid

from flask import jsonify, request

from . import brackets

SCHEMA = """
CREATE TABLE IF NOT EXISTS replay_orders (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, side TEXT NOT NULL,
    quantity REAL NOT NULL, placed_cursor INTEGER NOT NULL,
    close_requested_cursor INTEGER
);
CREATE INDEX IF NOT EXISTS ix_replay_orders_session ON replay_orders(session_id, placed_cursor);
"""


def register(app, db, session_row):
    def visible_orders(session_id):
        rows = db().execute("""
            SELECT o.id,o.side,o.quantity,o.placed_cursor,
                   s.cursor,c.close AS mark_price,
                   entry.open AS entry_price,entry.ts AS entry_ms,
                   exit.open AS exit_price,exit.ts AS exit_ms,
                   o.close_requested_cursor <= s.cursor AS closing
            FROM replay_orders o
            JOIN sessions s ON s.id=o.session_id
            JOIN candles c ON c.dataset_id=s.dataset_id AND c.seq=s.cursor
            LEFT JOIN candles entry ON entry.dataset_id=s.dataset_id
                AND entry.seq=o.placed_cursor+1 AND entry.seq<=s.cursor
            LEFT JOIN candles exit ON exit.dataset_id=s.dataset_id
                AND exit.seq=o.close_requested_cursor+1 AND exit.seq<=s.cursor
            WHERE o.session_id=? AND o.placed_cursor<=s.cursor
            ORDER BY o.placed_cursor,o.rowid
        """, (session_id,)).fetchall()
        result = []
        for row in rows:
            status = "pending"
            pnl = None
            if row["entry_price"] is not None:
                status = "closed" if row["exit_price"] is not None else ("closing" if row["closing"] else "open")
                price = row["exit_price"] if status == "closed" else row["mark_price"]
                pnl = (price - row["entry_price"]) * row["quantity"] * (1 if row["side"] == "long" else -1)
            result.append({key:row[key] for key in (
                "id","side","quantity","entry_price","entry_ms","exit_price","exit_ms"
            )} | {"status":status,"pnl":pnl})
        return result

    @app.get("/api/sessions/<session_id>/orders")
    def orders(session_id):
        conn = db()
        with conn:
            conn.execute("BEGIN")
            state = session_row(session_id)
            if state is None:
                return jsonify({"error":"session not found"}),404
            expected = request.args.get("cursor")
            if expected is not None and expected != str(state["cursor"]):
                return jsonify({"error":"Replay cursor changed while loading orders."}),409
            return jsonify(visible_orders(session_id) + brackets.list_positions(conn,state))

    def validate_clock(conn, session_id, payload, *, next_candle=True):
        state = session_row(session_id)
        if state is None:
            return None,(jsonify({"error":"session not found"}),404)
        if type(payload.get("cursor")) is not int or payload["cursor"] != state["cursor"]:
            return None,(jsonify({"error":"Replay cursor changed. Refresh before submitting an order."}),409)
        if not next_candle:
            return state,None
        available = conn.execute("SELECT 1 FROM candles WHERE dataset_id=? AND seq=?",
                                 (state["dataset_id"],state["cursor"]+1)).fetchone()
        if available is None:
            return None,(jsonify({"error":"No next candle is available for a market fill."}),409)
        return state,None

    @app.post("/api/sessions/<session_id>/orders")
    def place_order(session_id):
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error":"invalid order"}),400
        side = payload.get("side")
        try:
            quantity = float(payload.get("quantity"))
        except (TypeError, ValueError, OverflowError):
            quantity = 0
        if side not in ("long","short") or not (math.isfinite(quantity) and 0 < quantity <= 1e9):
            return jsonify({"error":"Choose long or short and a positive quantity up to 1 billion."}),400
        conn = db()
        with conn:
            conn.execute("BEGIN IMMEDIATE")
            paper = payload.get("mode") == "bracket"
            state, error = validate_clock(conn,session_id,payload,next_candle=not paper)
            if error:
                return error
            if paper:
                if state["cursor"] != state["max_seen_cursor"]:
                    return jsonify({"error":"Advance to the furthest replay cursor to place a bracket."}),409
                try:
                    order_id = brackets.place(conn,state,side,quantity,payload)
                except (KeyError,TypeError,ValueError,OverflowError) as err:
                    return jsonify({"error":str(err)}),400
                return jsonify({"id":order_id}),201
            order_id = str(uuid.uuid4())
            conn.execute("INSERT INTO replay_orders VALUES (?,?,?,?,?,NULL)",
                         (order_id,session_id,side,quantity,state["cursor"]))
        return jsonify({"id":order_id}),201

    @app.post("/api/sessions/<session_id>/orders/<order_id>/close")
    def close_order(session_id,order_id):
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error":"invalid close request"}),400
        conn = db()
        with conn:
            conn.execute("BEGIN IMMEDIATE")
            state,error = validate_clock(conn,session_id,payload)
            if error:
                return error
            changed = conn.execute("""
                UPDATE replay_orders SET close_requested_cursor=?
                WHERE session_id=? AND id=? AND placed_cursor<? AND close_requested_cursor IS NULL
            """,(state["cursor"],session_id,order_id,state["cursor"])).rowcount
        if not changed:
            return jsonify({"error":"Only an open order with no recorded exit can be closed."}),409
        return jsonify({"id":order_id})

    @app.patch("/api/sessions/<session_id>/paper-positions/<order_id>")
    @app.post("/api/sessions/<session_id>/paper-positions/<order_id>/close")
    def manage_paper_position(session_id,order_id):
        payload = request.get_json(silent=True)
        if not isinstance(payload,dict):
            return jsonify({"error":"invalid position request"}),400
        conn = db()
        with conn:
            conn.execute("BEGIN IMMEDIATE")
            state,error = validate_clock(conn,session_id,payload,next_candle=False)
            if error:
                return error
            if state["cursor"] != state["max_seen_cursor"]:
                return jsonify({"error":"Advance to the furthest replay cursor to edit a bracket."}),409
            position = conn.execute("""SELECT * FROM paper_positions
                WHERE id=? AND session_id=? AND placed_cursor<=?""",
                (order_id,session_id,state["cursor"])).fetchone()
            if position is None:
                return jsonify({"error":"position not found"}),404
            try:
                brackets.manage(conn,state,position,payload,"close" if request.method=="POST" else "edit")
            except (TypeError,ValueError,OverflowError) as err:
                return jsonify({"error":str(err)}),400
        return jsonify({"id":order_id})

    @app.delete("/api/sessions/<session_id>/orders/<order_id>")
    def cancel_order(session_id,order_id):
        conn = db()
        with conn:
            changed = conn.execute("""
                DELETE FROM replay_orders WHERE session_id=? AND id=?
                AND placed_cursor=(SELECT cursor FROM sessions WHERE id=? AND max_seen_cursor=cursor)
                AND close_requested_cursor IS NULL
            """,(session_id,order_id,session_id)).rowcount
        if not changed:
            return jsonify({"error":"Only a pending order at the furthest replay cursor can be canceled."}),409
        return jsonify({"id":order_id})
