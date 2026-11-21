"""Public Binance USD-M candles used to extend local 15m datasets."""

import csv
from datetime import datetime, timezone
import io
import json
import zipfile
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import urlopen

from .engine import TF_MS, validate_and_normalize

BASE_MS = TF_MS["15m"]


def fetch_rest(symbol, start, now_ms):
    end = now_ms // BASE_MS * BASE_MS
    rows = []
    while start < end:
        query = urlencode({"symbol": symbol, "interval": "15m", "startTime": start,
                           "endTime": end - 1, "limit": 1500})
        with urlopen("https://fapi.binance.com/fapi/v1/klines?" + query, timeout=12) as response:
            page = json.load(response)
        if not isinstance(page, list):
            raise ValueError("unexpected Binance response")
        if not page:
            break
        for ts, opening, high, low, close, volume, closed_at, *_ in page:
            if ts != start or closed_at != ts + BASE_MS - 1 or closed_at >= end:
                raise ValueError("Binance returned a gap or an unclosed candle")
            rows.append(dict(ts=ts, open=opening, high=high, low=low, close=close, volume=volume))
            start += BASE_MS
    return validate_and_normalize(rows, BASE_MS, minimum=0)[0]


def archive_rows(symbol, period, date):
    filename = f"{symbol}-15m-{date}.zip"
    url = f"https://data.binance.vision/data/futures/um/{period}/klines/{symbol}/15m/{filename}"
    try:
        with urlopen(url, timeout=12) as response:
            content = response.read()
    except HTTPError as error:
        if error.code == 404:
            return None
        raise
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        with archive.open(filename[:-4] + ".csv") as csv_file:
            return list(csv.reader(io.TextIOWrapper(csv_file, encoding="utf-8-sig")))


def fetch_archive(symbol, start, now_ms):
    end = now_ms // BASE_MS * BASE_MS
    today = datetime.fromtimestamp(now_ms / 1000, timezone.utc).date()
    rows = []
    while start < end:
        date = datetime.fromtimestamp(start / 1000, timezone.utc).date()
        if date >= today:
            break
        page = None
        if date.day == 1 and (date.year, date.month) < (today.year, today.month):
            page = archive_rows(symbol, "monthly", date.strftime("%Y-%m"))
        if page is None:
            page = archive_rows(symbol, "daily", date.isoformat())
        if not page:
            break
        before = start
        for fields in page:
            if not fields or fields[0] == "open_time":
                continue
            open_time, opening, high, low, close, volume, close_time, *_ = fields
            ts = int(open_time)
            if ts < before:
                continue
            if ts != start or int(close_time) != ts + BASE_MS - 1 or ts + BASE_MS > end:
                raise ValueError("Binance archive returned a gap or an unclosed candle")
            rows.append(dict(ts=ts, open=opening, high=high, low=low, close=close, volume=volume))
            start += BASE_MS
        if start == before:
            break
    return validate_and_normalize(rows, BASE_MS, minimum=0)[0]


def fetch_closed(symbol, start, now_ms):
    try:
        return fetch_rest(symbol, start, now_ms)
    except OSError as rest_error:
        try:
            return fetch_archive(symbol, start, now_ms)
        except (OSError, ValueError, zipfile.BadZipFile, KeyError) as archive_error:
            raise ValueError(f"REST: {rest_error}; public archive: {archive_error}") from archive_error
