from datetime import datetime, timezone
import pytest
from backend.engine import aggregate,bucket_start,MINUTE_MS,synthetic_candles,validate_and_normalize

def ms(y, m, d, h=0, minute=0):
    return int(datetime(y,m,d,h,minute,tzinfo=timezone.utc).timestamp()*1000)

def candle(ts, price):
    return {"ts":ts,"open":price,"high":price+1,"low":price-1,"close":price+0.5,"volume":10}

def test_utc_daily_partial_has_no_future():
    rows=[candle(ms(2026,1,1,23,58),100),candle(ms(2026,1,1,23,59),105),
          candle(ms(2026,1,2,0,0),110)]
    first=aggregate(rows[:2],"1d",ms(2026,1,2))
    assert len(first)==1 and first[0]["complete"] and first[0]["close"]==105.5
    next_day=aggregate(rows,"1d",ms(2026,1,2,0,1))
    assert len(next_day)==2 and not next_day[-1]["complete"]
    assert next_day[-1]["close"]==110.5

def test_htf_future_candle_is_rejected():
    with pytest.raises(ValueError,match="future"):
        aggregate([candle(ms(2026,1,1,10),100)],"4h",ms(2026,1,1,10))

def test_week_begins_monday_utc():
    assert bucket_start(ms(2026,1,7),"1w")==ms(2026,1,5)

def test_aggregate_is_repeatable():
    data=synthetic_candles(200)
    end=data[-1]["ts"]+MINUTE_MS
    assert aggregate(data,"15m",end)==aggregate(data,"15m",end)

def test_ordering_and_gap_flag():
    first=ms(2026,1,1)
    rows=[candle(first,100),candle(first+2*MINUTE_MS,101)]
    cleaned,gaps=validate_and_normalize(rows)
    assert len(cleaned)==2 and gaps==1
    with pytest.raises(ValueError,match="strictly increasing"):
        validate_and_normalize(list(reversed(rows)))
