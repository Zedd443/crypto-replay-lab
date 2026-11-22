"""Causal market-structure events: each pivot is first known after right-side confirmation."""
from __future__ import annotations

def structure_events(candles, pivot=2):
    """Events are stamped at confirmation bar, never retrospectively at the pivot."""
    if not isinstance(pivot,int) or not 1 <= pivot <= 12:
        raise ValueError("pivot must be an integer between 1 and 12")
    bars=[c for c in candles if c["complete"]]
    swings=[]
    events=[]
    last_high=None
    last_low=None
    broken_high=None
    broken_low=None
    trend=None
    for i in range(2*pivot,len(bars)):
        b=bars[i]
        candidate=bars[i-pivot]
        neighbors=bars[i-2*pivot:i-pivot]+bars[i-pivot+1:i+1]
        if all(candidate["high"]>x["high"] for x in neighbors):
            kind="HH" if last_high is not None and candidate["high"]>last_high else (
                "LH" if last_high is not None else "H")
            last_high=candidate["high"]
            broken_high=None
            swings.append({"type":kind,"side":"high","price":last_high,
                           "pivot_time":candidate["time"],"confirmed_time":b["time"]})
        if all(candidate["low"]<x["low"] for x in neighbors):
            kind="HL" if last_low is not None and candidate["low"]>last_low else (
                "LL" if last_low is not None else "L")
            last_low=candidate["low"]
            broken_low=None
            swings.append({"type":kind,"side":"low","price":last_low,
                           "pivot_time":candidate["time"],"confirmed_time":b["time"]})
        if last_high is not None and broken_high!=last_high:
            if b["close"]>last_high:
                typ="CHoCH" if trend=="bear" else "BOS"
                events.append({"type":typ,"direction":"bull","price":last_high,
                               "confirmed_time":b["time"],"pivot":pivot})
                trend="bull";broken_high=last_high
            elif b["high"]>last_high and b["close"]<last_high:
                events.append({"type":"SWEEP","direction":"bear","price":last_high,
                               "confirmed_time":b["time"],"pivot":pivot})
        if last_low is not None and broken_low!=last_low:
            if b["close"]<last_low:
                typ="CHoCH" if trend=="bull" else "BOS"
                events.append({"type":typ,"direction":"bear","price":last_low,
                               "confirmed_time":b["time"],"pivot":pivot})
                trend="bear";broken_low=last_low
            elif b["low"]<last_low and b["close"]>last_low:
                events.append({"type":"SWEEP","direction":"bull","price":last_low,
                               "confirmed_time":b["time"],"pivot":pivot})
    return {"pivot":pivot,"swings":swings,"events":events,
            "trend":trend or "undetermined","confirmed_bars":len(bars)}
