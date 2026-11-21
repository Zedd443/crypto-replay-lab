"""Pure, deterministic UTC replay helpers; never read candles after cursor."""
from __future__ import annotations

from datetime import datetime, timezone
import math

MINUTE_MS = 60_000
TF_MS = {
    "1m": MINUTE_MS,
    "5m": 5 * MINUTE_MS,
    "15m": 15 * MINUTE_MS,
    "30m": 30 * MINUTE_MS,
    "1h": 60 * MINUTE_MS,
    "4h": 240 * MINUTE_MS,
    "1d": 1440 * MINUTE_MS,
    "1w": 10080 * MINUTE_MS,
}
THREE_DAYS_MS = 3 * 24 * 60 * MINUTE_MS  # Unix epoch was Thursday


def bucket_start(timestamp_ms: int, timeframe: str) -> int:
    if timeframe not in TF_MS:
        raise ValueError("unsupported timeframe")
    span = TF_MS[timeframe]
    if timeframe == "1w":
        # ISO week begins Monday, not Unix epoch Thursday.
        return ((timestamp_ms + THREE_DAYS_MS) // span) * span - THREE_DAYS_MS
    return timestamp_ms // span * span


def aggregate(visible_candles: list[dict], timeframe: str, replay_cutoff_ms: int,
              base_ms: int = MINUTE_MS) -> list[dict]:
    """Aggregate *visible* closed base candles. Current HTF candle is partial."""
    if timeframe not in TF_MS:
        raise ValueError("unsupported timeframe")
    if TF_MS[timeframe] < base_ms or TF_MS[timeframe] % base_ms:
        raise ValueError("unsupported timeframe for dataset interval")
    acc: list[dict] = []
    current = None
    for row in visible_candles:
        ts = int(row["ts"])
        if ts + base_ms > replay_cutoff_ms:
            raise ValueError("future candle leak attempted")
        key = bucket_start(ts, timeframe)
        if current is None or current["time"] != key:
            current = {
                "time": key,
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": float(row["volume"]),
                "complete": False,
            }
            acc.append(current)
        else:
            current["high"] = max(current["high"], float(row["high"]))
            current["low"] = min(current["low"], float(row["low"]))
            current["close"] = float(row["close"])
            current["volume"] += float(row["volume"])
    for candle in acc:
        candle["complete"] = replay_cutoff_ms >= candle["time"] + TF_MS[timeframe]
    return acc


def synthetic_candles(count: int = 30_240) -> list[dict]:
    """Deterministic fake candles for UI testing. Never represent as market data."""
    start = int(datetime(2026, 1, 5, tzinfo=timezone.utc).timestamp() * 1000)
    price = 100.0
    out: list[dict] = []
    for i in range(count):
        opening = price
        change = 0.14 * math.sin(i / 37) + 0.08 * math.cos(i / 103) + 0.015 * math.sin(i / 7)
        price = max(1.0, price + change)
        spread = 0.06 + 0.04 * (1 + math.sin(i / 29))
        out.append({
            "ts": start + i * MINUTE_MS,
            "open": round(opening, 6),
            "high": round(max(opening, price) + spread, 6),
            "low": round(min(opening, price) - spread, 6),
            "close": round(price, 6),
            "volume": round(10 + 5 * (1 + math.cos(i / 21)), 6),
        })
    return out


def validate_and_normalize(rows: list[dict], base_ms: int = MINUTE_MS,
                           *, minimum: int = 2) -> tuple[list[dict], int]:
    """Validate schema, ordering and prices. Return validated rows and gap count."""
    if len(rows) < minimum:
        raise ValueError(f"at least {minimum} candles required")
    normalized: list[dict] = []
    gaps = 0
    last = None
    for row in rows:
        ts = int(row["ts"])
        if ts % base_ms:
            raise ValueError("candle timestamp must align to the UTC dataset interval")
        values = [float(row[k]) for k in ("open", "high", "low", "close", "volume")]
        o, h, l, close, v = values
        if not all(math.isfinite(x) for x in values) or min(o, h, l, close) <= 0 or v < 0:
            raise ValueError("invalid price or volume")
        if h < max(o, close, l) or l > min(o, close, h):
            raise ValueError("invalid OHLC relationships")
        if last is not None:
            if ts <= last:
                raise ValueError("timestamp must be strictly increasing")
            if ts - last > base_ms:
                gaps += (ts - last) // base_ms - 1
        last = ts
        normalized.append({"ts":ts,"open":o,"high":h,"low":l,"close":close,"volume":v})
    return normalized, gaps
