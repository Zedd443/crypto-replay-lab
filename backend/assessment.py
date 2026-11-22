"""Immutable drawing assessments evaluated only against completed replay-visible candles."""
from __future__ import annotations

import json
import math
import uuid

from flask import jsonify, request
from .engine import TF_MS, bucket_start, aggregate
from .market_structure import structure_events

SCHEMA="""
CREATE TABLE IF NOT EXISTS drawing_assessments(
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    drawing_id TEXT NOT NULL,
    locked_cursor INTEGER NOT NULL,
    locked_clock_ms INTEGER NOT NULL,
    timeframe TEXT NOT NULL,
    drawing_json TEXT NOT NULL,
    intent TEXT NOT NULL,
    horizon INTEGER NOT NULL,
    target_pct REAL NOT NULL,
    stop_pct REAL NOT NULL,
    structure_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(session_id,drawing_id)
);
CREATE INDEX IF NOT EXISTS ix_drawing_assessments_session
 ON drawing_assessments(session_id,locked_cursor);
"""

INTENTS={"bounce_up","bounce_down","break_up","break_down","rr_plan"}
ZONE_KINDS={"rectangle","horizontal","horizontal_ray"}

def _roundup(time_ms,tf):
    span=TF_MS[tf]
    origin=bucket_start(time_ms,tf)
    return origin if origin>=time_ms else origin+span

def _future_bars(conn,state,entry):
    """Use full closed bars after lock; partial higher-timeframe candles never get scored."""
    start=_roundup(entry["locked_clock_ms"],entry["timeframe"])
    rows=conn.execute(
        """SELECT ts,open,high,low,close,volume FROM candles
           WHERE dataset_id=? AND ts>=? AND seq<=? ORDER BY seq""",
        (state["dataset_id"],start,state["cursor"])
    ).fetchall()
    if not rows:return []
    clock=conn.execute("SELECT ts FROM candles WHERE dataset_id=? AND seq=?",
        (state["dataset_id"],state["cursor"])).fetchone()["ts"]+state["base_ms"]
    return [c for c in aggregate([dict(x) for x in rows],entry["timeframe"],
            clock,state["base_ms"]) if c["complete"] and c["time"]>=start]

def _test_levels(b,stop,target,direction):
    """Stop-first, ambiguous if OHLC spans both levels. Gap opens conservatively."""
    if direction==1:
        hit_stop=b["low"]<=stop
        hit_target=b["high"]>=target
    else:
        hit_stop=b["high"]>=stop
        hit_target=b["low"]<=target
    if hit_stop and hit_target:return "AMBIGUOUS"
    if hit_stop:return "FAILED"
    if hit_target:return "SUCCESS"
    return None

def evaluate(locked,bars):
    """Pure evaluator. No access to database or future bars, reproducible on every replay cursor."""
    d=json.loads(locked["drawing_json"])
    mode=locked["intent"]
    horizon=locked["horizon"]
    observed=bars[:horizon]
    response={"id":locked["id"],"drawing_id":locked["drawing_id"],
      "intent":mode,"horizon":horizon,"observed":len(observed),
      "locked_cursor":locked["locked_cursor"],"timeframe":locked["timeframe"],
      "structure":json.loads(locked["structure_json"]),
      "status":"PENDING","trigger_bar":None,"outcome_bar":None,
      "mfe_pct":None,"mae_pct":None,
      "reason":"Waiting for completed candles after the hypothesis lock"}
    if not observed:return response
    up=mode in {"bounce_up","break_up"} or d["kind"]=="long_position"
    direction=1 if up else -1
    triggered=False
    entry=None
    start_index=None
    upper=max(d["price"],d.get("end_price") or d["price"])
    lower=min(d["price"],d.get("end_price") or d["price"])
    for i,b in enumerate(observed):
        if not triggered:
            if mode=="rr_plan":
                entry=d["price"]
                # Entry touch after the plan was locked; no simulated market fill.
                fired=b["low"]<=entry<=b["high"]
            elif mode in ("bounce_up","bounce_down"):
                fired=b["low"]<=upper and b["high"]>=lower
                entry=upper if direction==1 else lower
            else:
                fired=b["close"]>upper if direction==1 else b["close"]<lower
                entry=b["close"]
            if not fired:continue
            triggered=True;start_index=i
            response["trigger_bar"]=i+1
            # Same-bar ordering of touch vs threshold cannot be inferred from OHLC.
            # Only evaluate target/stop on subsequent completed bars.
            continue
        stop=d["end_price"] if mode=="rr_plan" else entry*(1-direction*locked["stop_pct"]/100)
        target=d["take_profit"] if mode=="rr_plan" else entry*(1+direction*locked["target_pct"]/100)
        outcome=_test_levels(b,stop,target,direction)
        favorable=(b["high"]/entry-1)*100 if direction==1 else (1-b["low"]/entry)*100
        adverse=(1-b["low"]/entry)*100 if direction==1 else (b["high"]/entry-1)*100
        response["mfe_pct"]=max(response["mfe_pct"] or 0,favorable)
        response["mae_pct"]=max(response["mae_pct"] or 0,adverse)
        if outcome:
            response["status"]=outcome
            response["outcome_bar"]=i+1
            response["reason"]=("Both target and stop touched in same candle; intrabar order unknown"
                if outcome=="AMBIGUOUS" else
                "Target reached before stop" if outcome=="SUCCESS" else "Stop reached before target")
            return response
    if len(observed)>=horizon:
        response["status"]="TIMEOUT" if triggered else "NO_TRIGGER"
        response["reason"]="Neither level reached within evaluation horizon" if triggered else "Setup never triggered within evaluation horizon"
    elif triggered:
        response["reason"]="Triggered; awaiting target, stop, or horizon"
    return response

def _structure_match(d,candles):
    """Rule agreement, never an absolute ground truth or a prediction."""
    report=structure_events(candles)
    swings=report["swings"]
    if not swings:return {"status":"UNVERIFIED","reason":"Insufficient confirmed pivots at lock"}
    tolerance=max(d["price"]*.003,1e-8)
    if d["kind"] in ("long_position","short_position"):
        return {"status":"NOT_APPLICABLE","reason":"Position plan tests outcomes, not pivot placement"}
    if d["kind"] in ("rectangle","horizontal","horizontal_ray"):
        lo=min(d["price"],d.get("end_price") or d["price"])
        hi=max(d["price"],d.get("end_price") or d["price"])
        matches=[s for s in swings if lo-tolerance<=s["price"]<=hi+tolerance]
        return {"status":"MATCH" if matches else "NO_MATCH",
          "reason":f"{len(matches)} confirmed swing pivots lie within or near the zone (0.3% tolerance)",
          "matched":len(matches)}
    if d["kind"] in ("trendline","fib"):
        low=min(d["price"],d.get("end_price") or d["price"])
        high=max(d["price"],d.get("end_price") or d["price"])
        matches=[p for p in (low,high) if any(abs(p-s["price"])<=tolerance for s in swings)]
        return {"status":"MATCH" if len(matches)==2 else "PARTIAL" if matches else "NO_MATCH",
          "reason":f"{len(matches)}/2 anchor prices near previously confirmed pivots",
          "matched":len(matches)}
    return {"status":"UNVERIFIED","reason":"No structural scoring rule for this drawing kind"}

def register(app,db,session_row,snapshot):
    def _entry(row):
        state=session_row(row["session_id"])
        if state is None:return None
        result={k:row[k] for k in ("id","session_id","drawing_id","locked_cursor",
          "locked_clock_ms","timeframe","intent","horizon","target_pct","stop_pct","created_at")}
        result["drawing"]=json.loads(row["drawing_json"])
        result["structure"]=json.loads(row["structure_json"])
        if state["cursor"]<row["locked_cursor"]:
            result.update(status="HIDDEN_BY_REWIND",observed=0,reason="Hypothesis not locked yet at this replay cursor")
        else:
            result.update(evaluate(row,_future_bars(db(),state,row)))
        result["rewind_audit"]=bool(state["contaminated"])
        return result

    @app.get("/api/sessions/<session_id>/assessments")
    def list_assessments(session_id):
        state=session_row(session_id)
        if state is None:return jsonify({"error":"session not found"}),404
        rows=db().execute("SELECT * FROM drawing_assessments WHERE session_id=? ORDER BY locked_cursor,id",
            (session_id,)).fetchall()
        # Don't disclose locked hypotheses from future cursor on a rewound session.
        visible=[_entry(r) for r in rows if r["locked_cursor"]<=state["cursor"]]
        evaluated=[r for r in visible if r["status"] in {"SUCCESS","FAILED"}]
        return jsonify({"items":visible,"summary":{
            "locked":len(visible),"resolved":len(evaluated),
            "success":sum(x["status"]=="SUCCESS" for x in evaluated),
            "accuracy_pct":100*sum(x["status"]=="SUCCESS" for x in evaluated)/len(evaluated) if evaluated else None,
            "ambiguous":sum(x["status"]=="AMBIGUOUS" for x in visible),
            "pending":sum(x["status"]=="PENDING" for x in visible),
            "no_trigger":sum(x["status"]=="NO_TRIGGER" for x in visible),
            "timeout":sum(x["status"]=="TIMEOUT" for x in visible),
            "demo":state["dataset_id"]=="synthetic-demo",
            "rewind_audit":bool(state["contaminated"])
        }})

    @app.post("/api/sessions/<session_id>/assessments")
    def lock_assessment(session_id):
        state=session_row(session_id)
        if state is None:return jsonify({"error":"session not found"}),404
        # The user must make and lock a prediction at the maximum reached cursor.
        if state["contaminated"] or state["cursor"]!=state["max_seen_cursor"]:
            return jsonify({"error":"Cannot lock scored hypotheses in a rewound/contaminated session. Create a fresh replay."}),409
        payload=request.get_json(silent=True) or {}
        drawing_id=payload.get("drawing_id")
        if not isinstance(drawing_id,str):return jsonify({"error":"drawing_id required"}),400
        drawing=db().execute("""SELECT d.*,
           COALESCE(e.price,d.price) AS effective_price,
           COALESCE(e.end_price,d.end_price) AS effective_end,
           COALESCE(e.take_profit,d.take_profit) AS effective_tp,
           COALESCE(e.anchor_start,d.anchor_start) AS effective_start,
           COALESCE(e.anchor_end,d.anchor_end) AS effective_anchor_end
           FROM drawings d LEFT JOIN drawing_edits e
           ON e.drawing_id=d.id AND e.cursor=(SELECT MAX(cursor) FROM drawing_edits
                WHERE drawing_id=d.id AND cursor<=?)
           WHERE d.session_id=? AND d.id=? AND d.created_at_cursor<=?""",
           (state["cursor"],session_id,drawing_id,state["cursor"])).fetchone()
        if drawing is None:return jsonify({"error":"drawing not found at cursor"}),404
        kind=drawing["kind"]
        intent=payload.get("intent","rr_plan" if kind in ("long_position","short_position") else None)
        if intent not in INTENTS:return jsonify({"error":"Select a supported outcome hypothesis"}),400
        if kind in ("long_position","short_position") and intent!="rr_plan":
            return jsonify({"error":"Position plans require rr_plan"}),400
        if kind not in ("long_position","short_position") and intent=="rr_plan":
            return jsonify({"error":"rr_plan requires a Long/Short drawing"}),400
        if intent!="rr_plan" and kind not in ZONE_KINDS:
            return jsonify({"error":"Directional hypotheses require a rectangle or horizontal zone"}),400
        try:
            horizon=int(payload.get("horizon",20))
            target=float(payload.get("target_pct",1))
            stop=float(payload.get("stop_pct",1))
            if isinstance(payload.get("horizon",20),bool) or horizon!=float(payload.get("horizon",20)):
                raise ValueError("non-integer horizon")
            if not (1<=horizon<=200 and math.isfinite(target) and math.isfinite(stop)
                    and .01<=target<=50 and .01<=stop<=50):
                raise ValueError("invalid ranges")
        except (ValueError,TypeError):
            return jsonify({"error":"Horizon 1–200 bars, target and stop .01–50% required"}),400
        frozen={"kind":kind,"price":drawing["effective_price"],
          "end_price":drawing["effective_end"],"take_profit":drawing["effective_tp"],
          "anchor_start":drawing["effective_start"],"anchor_end":drawing["effective_anchor_end"]}
        if kind in ("long_position","short_position"):
            direction=1 if kind=="long_position" else -1
            if not (direction*(frozen["take_profit"]-frozen["price"])>0
                    and direction*(frozen["price"]-frozen["end_price"])>0):
                return jsonify({"error":"Invalid position levels"}),400
        timeframe=drawing["timeframe"]
        # Structure snapshot uses only history known at lock, including confirmation delay.
        past=db().execute("""SELECT ts,open,high,low,close,volume FROM candles
                             WHERE dataset_id=? AND seq<=? ORDER BY seq DESC LIMIT 6000""",
                             (state["dataset_id"],state["cursor"])).fetchall()
        known=aggregate([dict(r) for r in reversed(past)],timeframe,
            snapshot(state)["clock_ms"],state["base_ms"])
        structure=_structure_match(frozen,known)
        assessment_id=str(uuid.uuid4())
        try:
            with db():
                db().execute("""INSERT INTO drawing_assessments
                   (id,session_id,drawing_id,locked_cursor,locked_clock_ms,timeframe,
                    drawing_json,intent,horizon,target_pct,stop_pct,structure_json)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                   (assessment_id,session_id,drawing_id,state["cursor"],snapshot(state)["clock_ms"],
                    timeframe,json.dumps(frozen),intent,horizon,target,stop,json.dumps(structure)))
        except Exception as error:
            import sqlite3
            if isinstance(error,sqlite3.IntegrityError):
                return jsonify({"error":"This drawing is already locked. Create another drawing for a new hypothesis."}),409
            raise
        return jsonify({"id":assessment_id,"drawing_id":drawing_id,"status":"PENDING",
                        "structure":structure,"locked_cursor":state["cursor"]}),201

    @app.get("/api/sessions/<session_id>/market-structure")
    def get_market_structure(session_id):
        state=session_row(session_id)
        if state is None:return jsonify({"error":"session not found"}),404
        tf=request.args.get("tf","1h")
        try:pivot=int(request.args.get("pivot",2))
        except (TypeError,ValueError):return jsonify({"error":"invalid pivot"}),400
        if tf not in TF_MS or TF_MS[tf]<state["base_ms"] or not 1<=pivot<=12:
            return jsonify({"error":"invalid timeframe or pivot"}),400
        known=db().execute("""SELECT ts,open,high,low,close,volume FROM candles WHERE
                         dataset_id=? AND seq<=? ORDER BY seq DESC LIMIT 6000""",
                         (state["dataset_id"],state["cursor"])).fetchall()
        bars=aggregate([dict(x) for x in reversed(known)],tf,
          snapshot(state)["clock_ms"],state["base_ms"])
        return jsonify(structure_events(bars,pivot))
