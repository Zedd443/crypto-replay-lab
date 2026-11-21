# Crypto Replay Lab — V0 (development prototype)

A local-first, **manual** crypto futures research and replay workspace. V0 is a functional foundation for testing replay correctness, not a validated exchange simulator or a profitable strategy.

## What works today
- Flask API + SQLite session persistence.
- UTC-based replay clock; forward/back candle stepping with rewind contamination flag.
- Aggregated 1m, 5m, 15m, 30m, 1h, 4h, 1d and 1w candles. HTF candles show only information available at the current replay timestamp.
- Responsive React + TradingView Lightweight Charts candlestick UI, zoom/pan, fit, autoscale and reset controls.
- Session resume after refresh, timeframe-specific viewport saved in browser.
- Basic horizontal price line drawing, saved with candle cursor in SQLite.
- Seeded **synthetic demo dataset** and import of real Binance **1m** historical klines as CSV or ZIP.
- Pytest safety tests and GitHub Actions CI.

## Install (Windows PowerShell)

Requires Python 3.11+ and Node.js LTS.

```powershell
git clone https://github.com/Zedd443/crypto-replay-lab.git
cd crypto-replay-lab
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
python -m backend.app
```

Open a **second terminal**:

```powershell
cd crypto-replay-lab\frontend
npm install
npm run dev
```

Open http://localhost:5173. Backend binds to 127.0.0.1:5000 by default.

Tests:

```powershell
python -m pytest backend/tests -q
```

## Import real futures data

Download Binance **USDT-M futures, 1m kline** CSV/ZIP from https://data.binance.vision/ (not spot data). In the Data panel choose your file and label the symbol, e.g. BTCUSDT. The 1m parser expects Binance kline columns: `open_time, open, high, low, close, volume, ...`.

The synthetic dataset is explicitly marked DEMO, **not** historical BTC. It must never be used to claim real returns. Imported datasets should have regular 1-minute UTC spacing; gaps are detected and flagged. Data completeness remains the user's responsibility.

## Security
- No API keys; no brokerage execution; no funds involved.
- Backend runs localhost-only. **Do not** expose this API through a public tunnel without adding authentication, HTTPS and request protection.
- `data/` and SQLite files are ignored by Git.

## Current limitations
No futures order execution, funding, OI, CVD, free-form trendline, indicator scripting, or statistical strategy evaluation yet. Those modules have interfaces planned in docs/ROADMAP.md. Historical L2 execution cannot be inferred from OHLCV.

## License
MIT (code in this repository only; third-party data retain their respective terms).
