import React, { useEffect, useState } from 'react';
import ChartPanel from './ChartPanel.jsx';

const TFS=['1m','5m','15m','30m','1h','4h','1d','1w'];

async function api(path,options) {
  const response=await fetch(path,options);
  const data=await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
const post=(path,body)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

export default function App() {
  const [datasets,setDatasets]=useState([]);
  const [selected,setSelected]=useState('synthetic-demo');
  const [session,setSession]=useState(null);
  const [candles,setCandles]=useState([]);
  const [tf,setTf]=useState('1h');
  const [drawings,setDrawings]=useState([]);
  const [lineMode,setLineMode]=useState(false);
  const [resetSignal,setResetSignal]=useState(0);
  const [fitSignal,setFitSignal]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [symbol,setSymbol]=useState('BTCUSDT');
  const [upload,setUpload]=useState(null);
  const [showData,setShowData]=useState(false);
  const [blind,setBlind]=useState(false);

  const refreshDatasets=async()=>{
    const data=await api('/api/datasets');
    setDatasets(data);
    return data;
  };

  const refreshSession=async(sid,timeframe=tf)=>{
    const [state,candleData,drawData]=await Promise.all([
      api(`/api/sessions/${sid}`),
      api(`/api/sessions/${sid}/candles?tf=${timeframe}`),
      api(`/api/sessions/${sid}/drawings`),
    ]);
    setSession(state);setCandles(candleData.candles);setDrawings(drawData);
    return state;
  };

  useEffect(()=>{
    let active=true;
    (async()=>{
      try {
        const data=await api('/api/datasets');
        if(!active) return;
        setDatasets(data);
        const saved=localStorage.getItem('crl-session');
        if(saved){
          try {
            const state=await api(`/api/sessions/${saved}`);
            if(active){
              setSession(state);setSelected(state.dataset_id);
              const candlesPayload=await api(`/api/sessions/${saved}/candles?tf=1h`);
              const drawingsPayload=await api(`/api/sessions/${saved}/drawings`);
              setCandles(candlesPayload.candles);setDrawings(drawingsPayload);
            }
            return;
          }catch { localStorage.removeItem('crl-session'); }
        }
        const initial=data.find(d=>d.id==='synthetic-demo')||data[0];
        if(initial && active){
          const created=await post('/api/sessions',{dataset_id:initial.id});
          if(!active)return;
          localStorage.setItem('crl-session',created.id);
          setSelected(initial.id);setSession(created);
          const payload=await api(`/api/sessions/${created.id}/candles?tf=1h`);
          setCandles(payload.candles);
        }
      }catch(e){if(active)setError(e.message);}
    })();
    return()=>{active=false;};
  },[]);

  const run=async(fn)=>{
    if(busy)return;
    setBusy(true);setError('');
    try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}
  };

  const newSession=()=>run(async()=>{
    const created=await post('/api/sessions',{dataset_id:selected});
    localStorage.setItem('crl-session',created.id);
    setTf('1h');setLineMode(false);
    await refreshSession(created.id,'1h');
  });

  const step=(amount)=>run(async()=>{
    if(!session)return;
    await post(`/api/sessions/${session.id}/step`,{amount});
    await refreshSession(session.id,tf);
  });

  const changeTf=(value)=>run(async()=>{
    if(!session)return;
    setTf(value);
    await refreshSession(session.id,value);
  });

  const addLine=(price)=>run(async()=>{
    if(!session)return;
    await post(`/api/sessions/${session.id}/drawings`,{
      kind:'horizontal',timeframe:tf,price,
    });
    setDrawings(await api(`/api/sessions/${session.id}/drawings`));
    setLineMode(false);
  });

  const importFile=()=>run(async()=>{
    if(!upload)throw new Error('Choose a 1m Binance CSV/ZIP first');
    const form=new FormData();
    form.append('file',upload);
    form.append('symbol',symbol);
    const response=await fetch('/api/datasets/import',{method:'POST',body:form});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'Import failed');
    await refreshDatasets();
    setSelected(result.id);
    setShowData(false);
    setUpload(null);
  });

  const active=datasets.find(d=>d.id===session?.dataset_id);
  const date=session ? new Date(session.clock_ms).toISOString().replace('T',' ').slice(0,16)+' UTC':'—';

  return <div className="app">
    <header className="topbar">
      <div className="brand"><span className="brand-dot"/> CRYPTO <strong>REPLAY LAB</strong> <span className="version">V0.1</span></div>
      <div className="topright"><span className="tag">RESEARCH ONLY</span><span className="tag">LOCAL FIRST</span></div>
    </header>
    <main className="workspace">
      <section className="headline">
        <div><h1>Replay workstation</h1><p>Deterministic UTC replay · Synthetic demo or imported Binance futures 1m data</p></div>
        <div className="headline-actions"><button onClick={()=>setShowData(!showData)}>Data / import</button><button className="accent" disabled={busy} onClick={newSession}>New replay</button></div>
      </section>
      {error&&<div className="alert" role="alert">{error}</div>}
      {showData&&<section className="panel data-panel">
        <strong>Import historical Binance USDT-M 1-minute klines</strong>
        <p>Supports CSV/ZIP (max 30MB upload). Ensure chronological 1m data; gaps are flagged. No API key.</p>
        <div className="data-actions">
          <label>Dataset<select value={selected} onChange={e=>setSelected(e.target.value)}>{datasets.map(d=><option key={d.id} value={d.id}>{d.symbol} ({d.candles?.toLocaleString()} bars){d.is_demo?' — SYNTHETIC':''}{d.gap_count?' — GAPS':''}</option>)}</select></label>
          <label>Symbol<input value={symbol} onChange={e=>setSymbol(e.target.value)}/></label>
          <label>File<input type="file" accept=".csv,.zip" onChange={e=>setUpload(e.target.files?.[0]||null)}/></label>
          <button disabled={busy} onClick={importFile}>Import</button>
        </div>
        <p>After selecting a dataset, press <strong>New replay</strong> to start a new session.</p>
      </section>}
      <section className="panel chart-shell">
        <div className="toolbar">
          <div className="instrument"><span>{blind?'ASSET X':(active?.symbol||'Loading...')}</span><span className="muted">{active?.is_demo?'SYNTHETIC DATA':''}</span></div>
          <div className="tf-list">{TFS.map(t=><button className={tf===t?'active':''} key={t} disabled={busy||!session} onClick={()=>changeTf(t)}>{t.toUpperCase()}</button>)}</div>
          <div className="toolbar-right">
            <button className={lineMode?'active':''} onClick={()=>setLineMode(!lineMode)} title="Click chart to place horizontal line">+ S/R line</button>
            <button onClick={()=>setFitSignal(n=>n+1)}>Fit</button>
            <button onClick={()=>setResetSignal(n=>n+1)}>Auto/reset</button>
          </div>
        </div>
        <div className="chart-with-aside">
          <ChartPanel candles={candles} timeframe={tf} sessionId={session?.id}
            drawings={drawings} drawingMode={lineMode} onNewLine={addLine}
            resetSignal={resetSignal} fitSignal={fitSignal}/>
          <aside className="sideinfo">
            <div className="small-label">REPLAY CLOCK</div>
            <div className="clock">{blind?'DATE HIDDEN':date}</div>
            <div className="small-label">SESSION</div>
            <div className="mono">{session?.id?.slice(0,8)||'—'}</div>
            <div className="small-label">PROGRESS</div>
            <div className="mono">{session?.cursor?.toLocaleString()||0} / {session?.total?.toLocaleString()||0}</div>
            <div className="small-label">DRAWINGS SAVED</div>
            <div className="mono">{drawings.length}</div>
            <div className="small-label">BIAS AUDIT</div>
            <div className={session?.contaminated?'warning':'ok'}>{session?.contaminated?'REWIND DETECTED':'NO REWIND'}</div>
            <label className="blind"><input type="checkbox" checked={blind} onChange={e=>setBlind(e.target.checked)}/> Hide date / asset</label>
            <div className="note">Blind toggle hides labels only. It is NOT certified blind testing: price patterns may reveal history.</div>
          </aside>
        </div>
        <div className="playback">
          <span>REPLAY</span>
          <button disabled={busy||!session} onClick={()=>step(-1)}>◀ −1</button>
          <button className="accent" disabled={busy||!session} onClick={()=>step(1)}>+1 ▶</button>
          <button disabled={busy||!session} onClick={()=>step(10)}>+10</button>
          <button disabled={busy||!session} onClick={()=>step(60)}>+60</button>
          <span className="muted">Step unit = one 1m bar · Current TF = {tf}</span>
        </div>
      </section>
      <section className="bottom-grid">
        <article className="panel"><div className="small-label">CAUSALITY GUARANTEE</div><h3>Visible candles only</h3><p>All OHLCV aggregation stops at the replay cursor. An unfinished 1D/4H/1W candle is marked partial internally and cannot include future 1m prices.</p></article>
        <article className="panel"><div className="small-label">DRAWING STORAGE</div><h3>Price-anchored lines</h3><p>Enable <strong>+ S/R line</strong>, then click the chart. Price and creation cursor are persisted in SQLite. Trendline anchors/assessment come later.</p></article>
        <article className="panel"><div className="small-label">NEXT MILESTONE</div><h3>Execution simulator</h3><p>Market/limit orders, stop-loss, TP, realistic fees, ambiguous intrabar handling, journal and verified statistics are pending.</p></article>
      </section>
    </main>
    <footer>Prototype only · Not financial advice · No live orders · GitHub: Zedd443/crypto-replay-lab</footer>
  </div>;
}
