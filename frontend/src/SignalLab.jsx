import React,{useMemo,useState,useEffect} from 'react';
import {SIGNALS,HOLDING_PERIODS,backtestIndicator,compareHoldingPeriods} from './signalBacktest.js';
import {DEFAULT_INDICATOR_OPTIONS,INDICATOR_SETTINGS} from './indicators.js';

const format=(x,n=2)=>x==null||!Number.isFinite(x)?'—':Number(x).toFixed(n);
const percent=x=>x==null?'—':format(x)+'%';
export default function SignalLab({candles,timeframe,isDemo,activeSignal}){
  const [id,setId]=useState('bos');
  const [settings,setSettings]=useState(DEFAULT_INDICATOR_OPTIONS);
  const [holding,setHolding]=useState(5);
  const [side,setSide]=useState('both');
  const [feePct,setFeePct]=useState(.04);
  const [slippagePct,setSlippagePct]=useState(.02);
  const [exit,setExit]=useState('time');
  const [targetPct,setTargetPct]=useState(2);
  const [stopPct,setStopPct]=useState(1);
  const [split,setSplit]=useState(70);
  useEffect(()=>{
    if(activeSignal?.id&&SIGNALS.some(x=>x.id===activeSignal.id)){
      setId(activeSignal.id);
      if(activeSignal.parameters)setSettings(prev=>({...prev,[activeSignal.id]:activeSignal.parameters}));
    }
  },[activeSignal?.id,activeSignal?.parameters]);
  const options=useMemo(()=>({
    holding,side,feePct,slippagePct,split:split/100,
    ...(exit==='tp-sl'?{targetPct,stopPct}:{})
  }),[holding,side,feePct,slippagePct,split,exit,targetPct,stopPct]);
  const result=useMemo(()=>backtestIndicator(candles,id,settings[id],options),
    [candles,id,settings,options]);
  const comparisons=useMemo(()=>compareHoldingPeriods(candles,id,settings[id],options),
    [candles,id,settings,options]);
  const s=result.summary,ci=s.winRateCI;
  const renderMetrics=(label,item)=><div className="signal-stat" key={label}>
    <small>{label}</small><strong>{label==='Trades'?item:percent(item)}</strong>
  </div>;
  return <section className="signal-lab" aria-label="Signal backtesting research">
    <div className="signal-warning">
      {isDemo&&<strong>DEMO DATA — results are not market evidence. </strong>}
      Backtest hanya memakai closed candles yang terlihat saat replay.
      Sinyal dieksekusi paling cepat di open candle berikutnya. Angka ini estimasi
      dengan fee/slippage, tanpa funding, liquidasi, order-book, dan koreksi multiple testing.
    </div>
    <div className="signal-controls">
      <label>Signal
        <select aria-label="Backtest signal" value={id} onChange={e=>setId(e.target.value)}>
          {SIGNALS.map(x=><option value={x.id} key={x.id}>{x.label}</option>)}
        </select>
      </label>
      <label>Holding (candles)
        <input aria-label="Holding period" type="number" min="1" max="200"
          value={holding} onChange={e=>setHolding(Math.max(1,Math.min(200,Number(e.target.value)||1)))}/>
      </label>
      <label>Direction
        <select aria-label="Signal direction" value={side} onChange={e=>setSide(e.target.value)}>
          <option value="both">Both</option><option value="long">Long</option><option value="short">Short</option>
        </select>
      </label>
      <label>Exit method
        <select aria-label="Signal exit method" value={exit} onChange={e=>setExit(e.target.value)}>
          <option value="time">Holding period</option>
          <option value="tp-sl">TP/SL or holding limit</option>
        </select>
      </label>
      <label>Fee per side %
        <input type="number" min="0" max="5" step=".01" value={feePct}
          onChange={e=>setFeePct(Math.min(5,Math.max(0,Number(e.target.value))))}/>
      </label>
      <label>Slippage per side %
        <input type="number" min="0" max="5" step=".01" value={slippagePct}
          onChange={e=>setSlippagePct(Math.min(5,Math.max(0,Number(e.target.value))))}/>
      </label>
      {exit==='tp-sl'&&<>
        <label>Take profit %
          <input type="number" min=".01" max="50" step=".1" value={targetPct}
            onChange={e=>setTargetPct(Math.max(.01,Math.min(50,Number(e.target.value))))}/>
        </label>
        <label>Stop loss %
          <input type="number" min=".01" max="50" step=".1" value={stopPct}
            onChange={e=>setStopPct(Math.max(.01,Math.min(50,Number(e.target.value))))}/>
        </label>
      </>}
      <label>Train split %
        <input type="number" min="50" max="90" step="5" value={split}
          onChange={e=>setSplit(Math.max(50,Math.min(90,Number(e.target.value))))}/>
      </label>
    </div>
    <div className="signal-params">
      {(INDICATOR_SETTINGS[id]||[]).map(([key,label,base,min,max])=><label key={key}>
        {label}<input type="number" step={['minGap','deviation','threshold'].includes(key)?.1:1}
          min={min} max={max} value={settings[id]?.[key]??base}
          onChange={e=>setSettings(prev=>({...prev,[id]:{...(prev[id]||{}),
            [key]:Number(e.target.value)}}))}/>
      </label>)}
    </div>
    <div className="signal-stat-row">
      {renderMetrics('Trades',s.count)}
      {renderMetrics('Win rate',s.winRate)}
      {renderMetrics('Net expectancy/trade',s.expectancy)}
      {renderMetrics('Avg net return',s.avgReturn)}
      <div className="signal-stat"><small>Profit factor</small><strong>{format(s.profitFactor)}</strong></div>
      <div className="signal-stat"><small>Completed / pending</small><strong>{s.count} / {result.pending}</strong></div>
    </div>
    <p className="signal-context">{s.count} trades, {s.wins} wins, {s.losses} losses,
      Wilson 95% WR interval: {ci?percent(ci[0])+' – '+percent(ci[1]):'—'}.
      {s.count<30?' LOW SAMPLE: fewer than 30 completed trades.':''}
      {' '}Max gross percentage-point drawdown (additive, unleveraged): {percent(s.maxDrawdown)}.
      {' '}Average holding: {format(s.avgBars,1)} candles.
      {' '}Ambiguous TP/SL candles: {s.ambiguities}.
      {' '}Signals may overlap; results are not independent portfolio returns.
    </p>
    <h3>Holding period comparison · {timeframe.toUpperCase()}</h3>
    <div className="signal-table-wrap"><table className="signal-table">
      <thead><tr><th>Holding</th><th>Trades</th><th>WR</th><th>Avg net %</th>
        <th>Profit factor</th><th>OOS trades</th><th>OOS WR</th><th>OOS avg net %</th></tr></thead>
      <tbody>{comparisons.map(row=><tr key={row.holding} className={row.holding===holding?'active':''}>
        <td>{row.holding} candles</td><td>{row.summary.count}</td>
        <td>{percent(row.summary.winRate)}</td><td>{percent(row.summary.expectancy)}</td>
        <td>{format(row.summary.profitFactor)}</td>
        <td>{row.oos.count}</td><td>{percent(row.oos.winRate)}</td>
        <td>{percent(row.oos.expectancy)}</td>
      </tr>)}</tbody></table></div>
    <div className="signal-warning">
      Chronological split: first {split}% of closed candles in-sample, remainder out-of-sample.
      Trades crossing the boundary are omitted from each segment. Changing settings based on
      these results contaminates the holdout; use fresh data for confirmation.
      Dataset window contains {result.usedBars} closed candles.
    </div>
  </section>;
}
