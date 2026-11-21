# Roadmap and acceptance gates

## P0 — Prototype foundation (this initial commit)
- [x] Flask API + SQLite sessions
- [x] React + Lightweight Charts UI
- [x] UTC clock with no-future 1m→1w aggregation
- [x] Demo data explicitly synthetic
- [x] Binance 1m CSV/ZIP import, gap warnings
- [x] Rewind contamination flag
- [x] Basic horizontal drawing persistence
- [x] Backend test suite + CI configuration
- [ ] Verify full npm install/build and browser behavior via CI on GitHub
- [ ] End-to-end restore/resize interaction tests
- [ ] Performance profiling on 8GB RAM hardware

## P1 — Execution integrity
- [ ] Independent immutable event log for replay and order actions
- [ ] Market/limit, pending fills, order expiry, brackets and reduce-only
- [ ] Intrabar ambiguity policy: use low-TF data or mark ambiguous
- [ ] Fees, funding, leverage/margin and liquidation approximations with limitations
- [ ] Futures paper journal + export CSV
- [ ] Golden-path reconciliation tests and hostile data/gap tests

## P2 — Learning and quantitative validation (non-ML)
- [ ] Swing/zone/trendline geometry and versioned rubric assessor
- [ ] Indicators and compatibility tests (custom scripts are sandboxed)
- [ ] OI/funding/trade data adapters with availability timestamps
- [ ] Experiment registry, frozen rules and OOS holdout
- [ ] Expectancy, drawdown, MAE/MFE, confidence intervals and multiple-trial audit
- [ ] Blind mode: hidden symbol/date, per-session contamination and forward paper verification
- [ ] Google Sheets reporting, never using Sheets as tick database

## Important unresolved limits
No available historical order-book recording can be recreated from 1m candles. A remembered historical crash can contaminate blind replay. A successful backtest is not a guarantee of real trading returns.
