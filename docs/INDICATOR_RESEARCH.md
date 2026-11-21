# Indicator research: RSI, baseline TA and ICT/SMC

Status: **candidate hypotheses**, not profitable signals or audited strategy rules.

## Evidence hierarchy
1. Reproducible, timestamp-causal execution + net costs + chronological OOS / walk-forward + multiple-testing correction.
2. Academic empirical evidence with well-defined markets, periods and benchmark.
3. Public TradingView source code, documentation and community use — useful for formalization, **not proof of profitability**.
4. Screenshots, before/after demonstrations, social media win rates — do not use as acceptance evidence.

## Reviewed references
- LuxAlgo SMC public Pine script: BOS/CHoCH, equal highs/lows, order blocks, fair value gaps, premium/discount. Developer itself states liquidity/institutional interpretation is not empirically proven: https://www.tradingview.com/script/CnB3fSph-Smart-Money-Concepts-SMC-LuxAlgo/
- WillyAlgoTrader HTF Sweep CISD Setups: community tool describes HTF sweep → CISD displacement → FVG/OB/IFVG entries, optional SMT and alerts. The claimed signal performance is **not** independently audited here: https://www.tradingview.com/script/M0FCXfZC-HTF-Sweep-CISD-Setups-WillyAlgoTrader/
- Open-source independent sweep+CISD example: https://www.tradingview.com/script/u7X05Lva-cd-sweep-cisd-Cx/
- 2023 crypto TA study on BTC/USDT, ETH/USDT, August 2017–October 2023: pre-Dec-2021 profitable rules generally failed subsequent OOS tests after data-snooping controls: https://pubs.sciepub.com/jfe/11/4/2/index.html
- Deprez & Frömmel (2024), some simple BTC technical rules show risk-adjusted OOS benefit after considering costs and data mining (not unconditional guarantee of RSI efficacy): https://www.sciencedirect.com/science/article/pii/S1059056024003010
- SMC research preprint (2026) formalized 44 detectors on daily US stocks; no detector beat a matched random-entry baseline after multiple-testing controls. **Not peer-reviewed nor directly equivalent to BTC intraday futures**: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7483658

## Research workstreams
A. Baseline: no filter / random time-matched events / mechanical breakout with fixed risk.
B. HTF sweep: wick breaks **previous completed** HTF high/low and candle closes back inside.
C. LTF CISD: only on confirmed bar, with parameterized displacement (e.g., candle body/ATR >= threshold).
D. Add one filter at a time: FVG or IFVG retest, order block, volatility/range, volume/RVOL, session time and market regime.
E. Comparator: RSI/MACD/EMA conditions as independently adjustable candidates, never hardcoded 'best' or deleted solely by reputation.

### Outcome protocol
For every strategy version record source/market/symbol/timeframe, event timestamp, confirmation lag, fixed SL/TP and position size, fee/slippage/funding assumptions, ambiguous fills, and all attempted variants including failures. Evaluate net expectancy R, PF, WR, payoff, drawdown, confidence intervals, walk-forward/holdout; compare against matched null in the same market/regime. **Confluence increases conditions; it does not automatically add independent information.**

### Priority
- Current PR: chart drawing interaction and causal replay stepping.
- Next: editable indicator parameters, reliable order ledger, fee-aware trade analytics, strategy tag and OOS engine.
- After: reproducible ICT/SMC event detectors with causal timing; not wholesale copy of protected Pine code.

Open-source TradingView scripts may still have House Rules or license constraints. Independently recreate documented behavior and compare test outputs rather than copying source without reviewing permissions.
