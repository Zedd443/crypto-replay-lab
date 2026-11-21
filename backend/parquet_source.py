"""Read local 15m OHLCV without modifying the source files."""

from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from .engine import TF_MS, validate_and_normalize

SUFFIX = "_15m.parquet"
BASE_MS = TF_MS["15m"]


def discover(directory: Path) -> dict[str, Path]:
    return {f"raw:{file.name[:-len(SUFFIX)]}": file
            for file in sorted(directory.glob(f"*{SUFFIX}")) if file.is_file()}


def read_candles(path: Path) -> tuple[list[dict], int]:
    columns = ("open_time", "open", "high", "low", "close", "volume")
    table = pq.read_table(path, columns=list(columns))
    data = {
        name: table[name].to_pylist() for name in columns[1:]
    }
    # Safe cast rejects timestamps that would lose sub-millisecond precision.
    data["ts"] = table["open_time"].cast(pa.timestamp("ms", tz="UTC")).cast(pa.int64()).to_pylist()
    return validate_and_normalize(
        [dict(zip(data, values)) for values in zip(*data.values())],
        BASE_MS,
    )
