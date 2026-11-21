# Architecture baseline v0.1

## Modules and contracts

| Module | Current | Next |
|---|---|---|
| Market data | synthetic seed, Binance 1m ZIP/CSV import | providers, backfill, quality flags |
| Replay engine | deterministic cursor and UTC 1m→1w aggregation | incremental cache, multichart synchronization |
| Chart UI | interactive candlesticks, zoom/pan/fit, 1m–1w | trendlines, pane resizing, indicator engine |
| Drawing | horizontal price lines with created-at cursor | trendline anchors, edit history, geometry assessor |
| Execution | NOT IMPLEMENTED | orders, fill policy, SL/TP, fees, funding, margin |
| Research | NOT IMPLEMENTED | experiment registry, blind holdouts, metrics |
| Learning OS | NOT IMPLEMENTED | evidence, assessment, export to Sheets |

## Causal invariant
For every market datum D exposed at replay time T, the last information used to calculate D must have been available by T. Current engine accepts only **closed 1-minute base candles**. Higher timeframes can have an in-progress bar calculated exclusively from those closed 1m bars. Timeframe switch does not advance the clock.

## Reproducibility
- Session stores dataset ID and cursor in SQLite.
- Rewinds set contaminated=true.
- Drawings stored with price and creation cursor.
- No order fills yet. Do not infer execution quality from OHLCV.
- Synthetic data are for UI demonstration only.

## Local deployment
Flask listens on 127.0.0.1:5000; Vite proxies /api during development. No mobile-native variant. Termux is only an alternate runtime, not a different application. Internet exposure requires auth/TLS/rate limiting and a deployment review.

## Security and data lineage
- No exchange API key required.
- Imported data labelled by symbol and source; gaps are counted, not silently filled.
- CSV/ZIP import accepts up to 30MB compressed / 70MB uncompressed.
- Dataset's 1m candle duration is assumed; currently imports do not verify exchange signature or provenance. Do not treat labels as proof of exchange source.
