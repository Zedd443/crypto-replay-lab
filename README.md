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

## Replay local Parquet

The Data / import panel lists files named `<SYMBOL>_15m.parquet` in `raw/`.
Select a dataset and click **New replay**. A fresh browser session opens BTCUSDT
when its file is available. The first replay for a symbol copies its candles
into SQLite for reuse. Source files are read-only.

Each step advances one 15m candle. Only timeframes from 15m to 1w are available
for this source, and larger bars use only closed 15m candles. Binance CSV/ZIP
imports and the synthetic demo still use 1m as their base interval.

## Import real futures data

Download Binance **USDT-M futures, 1m kline** CSV/ZIP from https://data.binance.vision/ (not spot data). In the Data panel choose your file and label the symbol, e.g. BTCUSDT. The 1m parser expects Binance kline columns: `open_time, open, high, low, close, volume, ...`.

The synthetic dataset is explicitly marked DEMO, **not** historical BTC. It must never be used to claim real returns. Imported datasets should have regular 1-minute UTC spacing; gaps are detected and flagged. Data completeness remains the user's responsibility.

## Security
- No API keys; no brokerage execution; no funds involved.
- Backend runs localhost-only. **Do not** expose this API through a public tunnel without adding authentication, HTTPS and request protection.
- `data/` and SQLite files are ignored by Git.

## Simulated orders and indicators

Open **Trade**, enter a quantity and TP/SL percentages, and choose **Long**
or **Short**. Paper entries and manual exits use the price visible at the
replay cursor. Drag the TP/SL labels in the chart to move the bracket.
Automatic exits first check subsequent base candles. A gap at the open fills
at that open. When both levels are touched intrabar, the stop takes precedence
because candle data cannot identify the order of touches. Earlier next-open
orders keep their stored execution mode. P&L is gross.

The **Indicators** menu contains SMA, EMA, Bollinger Bands, Donchian, VWMA, RSI,
ATR, MACD, ADX, OBV, Stochastic, SMC Break of Structure, and ICT Fair Value Gap.
Price overlays can be combined. One oscillator is shown in a lower pane.
BOS marks a close through a confirmed two-bars-per-side swing. FVG marks
three-candle price separation on the third closed candle. These two markers
apply local rules inspired by community scripts. Numeric indicators can update
with the visible partial higher-timeframe candle.

References include [TradingView technical indicators](https://www.tradingview.com/support/solutions/43000614331-technical-ratings/),
[TA-Lib on GitHub](https://github.com/TA-Lib/ta-lib),
[Research article on intraday Bitcoin price shocks](https://doi.org/10.1080/15140326.2022.2151253),
and [LuxAlgo's SMC community indicator](https://www.tradingview.com/script/CnB3fSph-Smart-Money-Concepts-SMC-LuxAlgo/).

## Current limitations
Simulated execution supports market orders with gross P&L. Fees, slippage, liquidation, funding, OI, CVD, indicator scripting, and statistical strategy evaluation remain future work. Those modules have interfaces planned in docs/ROADMAP.md. Historical L2 execution cannot be inferred from OHLCV.

## License
MIT (code in this repository only; third-party data retain their respective terms).
