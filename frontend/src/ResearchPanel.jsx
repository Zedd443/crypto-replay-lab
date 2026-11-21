import React,{useMemo,useState} from 'react';
import {analyzeDrawings,evaluateTrades} from './research.js';

const fmt=v=>v==null||!Number.isFinite(v)?'—':v.toLocaleString(undefined,{maximumFractionDigits:3});
const pct=v=>v==null?'—':v.toFixed(1)+'%';
function Sparkline({values}){
  if(!values.length)return <div className="empty-spark">No closed trades</div>;
  const padded=[0,...values],lo=Math.min(...padded),hi=Math.max(...padded),span=Math.max(hi-lo,1e-9);
  const points=padded.map((v,i)=>`${(i/Math.max(1,padded.length-1)*340).toFixed(1)},${(85-(v-lo)/span*70).toFixed(1)}`).join(' ');
  return <svg className="equity-sparkline" viewBox="0 0 340 100" role="img" aria-label="Cumulative gross PnL by completed trade">
    <line x1="0" y1="85" x2="340" y2="85" stroke="#35435a" strokeDasharray="3 5"/>
    <polyline fill="none" stroke={values.at(-1)>=0?'#3acaa6':'#ee8486'} strokeWidth="2.4" points={points}/>
  </svg>;
}
export default function ResearchPanel({orders,drawings,candles,session}){
  const [tab,setTab]=useState('trades');
  const result=useMemo(()=>evaluateTrades(orders),[orders]);
  const readings=useMemo(()=>analyzeDrawings(drawings,candles),[drawings,candles]);
  return <section className="research-panel" aria-label="Trade analytics and drawing research">
    <div className="research-tabs">
      <strong>RESEARCH DESK</strong>
      <button className={tab==='trades'?'active':''} onClick={()=>setTab('trades')}>Trade analytics</button>
      <button className={tab==='patterns'?'active':''} onClick={()=>setTab('patterns')}>Drawing & pattern reader</button>
      <span className="muted">Session only · {session?.contaminated?'rewind contaminated':'replay-visible'}</span>
    </div>
    {tab==='trades'?<>
      <div className="metrics-grid">
        <div><small>Closed trades</small><strong>{result.count}</strong></div>
        <div><small>Win rate</small><strong>{pct(result.winRate)}</strong></div>
        <div><small>Profit factor</small><strong>{fmt(result.profitFactor)}</strong></div>
        <div><small>Gross PnL</small><strong className={result.grossPnl<0?'negative':'positive'}>{fmt(result.grossPnl)}</strong></div>
        <div><small>Gross expectancy/trade</small><strong>{fmt(result.expectancy)}</strong></div>
        <div><small>Max gross drawdown</small><strong>{fmt(result.maxDrawdown)}</strong></div>
      </div>
      <div className="research-bottom">
        <div className="equity-display">
          <span className="rail-title">GROSS EQUITY CURVE</span>
          <Sparkline values={result.equity}/>
          <small>Only completed trades; excludes fees, funding, slippage and liquidation.</small>
        </div>
        <div className="analytics-details">
          <span className="rail-title">TRADE BREAKDOWN</span>
          <div><span>Wins / losses</span><b>{result.wins} / {result.losses}</b></div>
          <div><span>Average win / loss</span><b>{fmt(result.avgWin)} / {fmt(result.avgLoss)}</b></div>
          <div><span>Open PnL (mark)</span><b>{fmt(result.unrealized)}</b></div>
          {result.bySide.map(x=><div key={x.side}><span>{x.side.toUpperCase()} · {x.n} trades</span><b>{pct(x.wr)} WR</b></div>)}
        </div>
      </div>
    </>:<>
      <div className="pattern-intro">Membaca geometri yang lu gambar terhadap OHLC replay yang sudah terlihat. Event dihitung setelah gambar dibuat; ini <strong>bukan</strong> pengujian profitabilitas strategi.</div>
      {readings.length?<div className="pattern-cards">{readings.map(x=><article className="pattern-card" key={x.id} style={{borderLeftColor:x.color}}>
        <div className="pattern-heading"><b>{x.label}</b><span>{x.status}</span></div>
        <p>{x.detail}</p>
        <small>{x.seen} candle teramati sesudah dibuat · {x.warning||'Perlu holdout untuk menguji edge'}</small>
      </article>)}</div>:<div className="pattern-empty">Gambar rectangle, Fibonacci, atau Long/Short pada chart untuk melihat analisisnya di sini.</div>}
    </>}
  </section>;
}
