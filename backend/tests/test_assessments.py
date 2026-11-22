"""Causal drawing-assessment checks: frozen plans, no lookahead and replay audit."""
import json
import sqlite3

from backend.app import create_app
from backend.assessment import evaluate, _structure_match
from backend.market_structure import structure_events

def bar(t,o,h,l,c):
    return {"time":t,"open":o,"high":h,"low":l,"close":c,"complete":True}

def locked(kind="rectangle",intent="bounce_up",horizon=4,price=100,end_price=101,tp=None):
    return {"id":"case","drawing_id":"draw","drawing_json":json.dumps({
        "kind":kind,"price":price,"end_price":end_price,"take_profit":tp}),
        "intent":intent,"locked_cursor":20,"timeframe":"1m","horizon":horizon,
        "target_pct":1.0,"stop_pct":1.0,"structure_json":json.dumps({"status":"UNVERIFIED"})}

def test_evaluator_causal_bounce_and_timeout():
    case=locked()
    bars=[bar(1,102,103,99.5,102),bar(2,102,103,101.0,102),
          bar(3,102,103,101.5,102),bar(4,102,102.5,101,101.5)]
    assert evaluate(case,[])["status"]=="PENDING"
    assert evaluate(case,bars[:1])["status"]=="PENDING"
    assert evaluate(case,bars)["status"]=="SUCCESS"
    assert evaluate(case,bars)["outcome_bar"]==2
    no_touch=[bar(i,104,105,103,104) for i in range(4)]
    assert evaluate(case,no_touch)["status"]=="NO_TRIGGER"

def test_same_bar_stop_target_is_ambiguous_not_success():
    case=locked(kind="long_position",intent="rr_plan",price=100,end_price=99,tp=102)
    bars=[bar(1,100,100.3,99.7,100),bar(2,100,103,98,100)]
    assert evaluate(case,bars)["status"]=="AMBIGUOUS"
    assert evaluate(case,bars[:1])["status"]=="PENDING"

def test_rr_plan_without_order_is_scored():
    case=locked(kind="short_position",intent="rr_plan",price=100,end_price=101,tp=98)
    bars=[bar(1,100,100.5,99.5,100),bar(2,99.5,99.8,97.5,98)]
    assert evaluate(case,bars)["status"]=="SUCCESS"

def test_pivot_requires_future_confirmation():
    bars=[bar(1,9,10,8,9),bar(2,10,15,9,12),
          bar(3,12,12,10,11),bar(4,11,11,9,10)]
    first=structure_events(bars[:3],pivot=2)
    after=structure_events(bars,pivot=1)
    assert first["swings"]==[]
    assert any(e["confirmed_time"]>e["pivot_time"] for e in after["swings"])

def test_lock_persists_without_order_and_hides_future_when_rewound(tmp_path):
    app=create_app(tmp_path/"assess.sqlite3")
    client=app.test_client()
    state=client.post("/api/sessions",json={"cursor":300}).get_json()
    sid=state["id"];base=f"/api/sessions/{sid}"
    clock=state["clock_ms"]
    candle=client.get(base+"/candles?tf=1m").get_json()["candles"][-1]
    created=client.post(base+"/drawings",json={"kind":"rectangle","timeframe":"1m",
      "price":candle["close"]*1.01,"end_price":candle["close"]*.99,
      "anchor_start":clock-3*60000,"anchor_end":clock-60000})
    assert created.status_code==201,created.get_json()
    did=created.get_json()["id"]
    endpoint=base+"/assessments"
    hypothesis={"drawing_id":did,"intent":"bounce_up","horizon":10,
                "target_pct":1,"stop_pct":1}
    response=client.post(endpoint,json=hypothesis)
    assert response.status_code==201,response.get_json()
    assert client.post(endpoint,json=hypothesis).status_code==409
    assess=client.get(endpoint).get_json()
    assert assess["summary"]["locked"]==1
    assert assess["summary"]["accuracy_pct"] is None
    assert assess["items"][0]["status"]=="PENDING"
    assert client.get(base+"/orders").get_json()==[]
    client.post(base+"/step",json={"amount":5})
    forward=client.get(endpoint).get_json()
    assert forward["items"][0]["observed"]==5
    client.post(base+"/step",json={"amount":-6})
    rewound=client.get(endpoint).get_json()
    assert rewound["summary"]["locked"]==0
    assert client.post(endpoint,json=hypothesis).status_code==409
    client.post(base+"/step",json={"amount":6})
    resumed=client.get(endpoint).get_json()
    assert resumed["summary"]["rewind_audit"] is True
    assert resumed["items"][0]["structure"]==assess["items"][0]["structure"]

def test_structure_route_respects_cursor(tmp_path):
    client=create_app(tmp_path/"structure.sqlite3").test_client()
    state=client.post("/api/sessions",json={"cursor":350}).get_json()
    base=f"/api/sessions/{state['id']}"
    result=client.get(base+"/market-structure?tf=1m&pivot=2")
    assert result.status_code==200
    body=result.get_json()
    assert all(x["confirmed_time"]<=state["clock_ms"] for x in body["events"])
    assert client.get(base+"/market-structure?tf=1m&pivot=20").status_code==400

def test_lock_rejects_synthetic_future_drawing_and_wrong_hypothesis(tmp_path):
    client=create_app(tmp_path/"validation.sqlite3").test_client()
    state=client.post("/api/sessions",json={"cursor":300}).get_json()
    base=f"/api/sessions/{state['id']}"
    future=client.post(base+"/drawings",json={"kind":"ghost_feed","timeframe":"1m",
        "price":100,"end_price":101,"anchor_start":state["clock_ms"]-60000,
        "anchor_end":state["clock_ms"]+60000}).get_json()
    assert client.post(base+"/assessments",json={"drawing_id":future["id"],
        "intent":"bounce_up"}).status_code==400

def test_fibonacci_structural_annotation_not_counted_as_directional_accuracy(tmp_path):
    client=create_app(tmp_path/"fib-review.sqlite3").test_client()
    state=client.post("/api/sessions",json={"cursor":300}).get_json()
    base=f"/api/sessions/{state['id']}"
    clock=state["clock_ms"]
    create=client.post(base+"/drawings",json={
        "kind":"fib","timeframe":"1m","price":100,"end_price":105,
        "anchor_start":clock-180000,"anchor_end":clock-60000
    })
    assert create.status_code==201,create.get_json()
    did=create.get_json()["id"]
    post=client.post(base+"/assessments",json={
        "drawing_id":did,"intent":"structural_only","horizon":20
    })
    assert post.status_code==201,post.get_json()
    output=client.get(base+"/assessments").get_json()
    assert output["items"][0]["status"]=="STRUCTURE_ONLY"
    assert output["summary"]["accuracy_pct"] is None
    assert output["summary"]["pending"]==0

def test_pending_assessment_reports_trigger_and_progress():
    case=locked(horizon=20)
    not_touch=[bar(i,105,106,104,105) for i in range(9)]
    waiting=evaluate(case,not_touch)
    assert waiting["status"]=="PENDING"
    assert waiting["trigger_bar"] is None
    assert "9/20" in waiting["reason"]
    hit=bar(10,102,102.5,100,101.5)
    activated=evaluate(case,[*not_touch,hit])
    assert activated["status"]=="PENDING"
    assert activated["trigger_bar"]==10
    assert "Triggered" in activated["reason"]
    next_bar=bar(11,101.5,101.8,101,101.4)
    ongoing=evaluate(case,[*not_touch,hit,next_bar])
    assert ongoing["status"]=="PENDING"
    assert ongoing["trigger_bar"]==10
    assert "9 bars remain" in ongoing["reason"]
