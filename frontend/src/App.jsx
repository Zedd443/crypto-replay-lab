import React, { useEffect, useRef, useState } from 'react';
import ChartPanel from './ChartPanel.jsx';
import OrderPanel from './OrderPanel.jsx';

const TFS=['1m','5m','15m','30m','1h','4h','1d','1w'];
const baseTf=(ms)=>ms===900000?'15m':'1m';

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
  const [orders,setOrders]=useState([]);
  const [showOrders,setShowOrders]=useState(false);
  const [selectedPosition,setSelectedPosition]=useState(null);
  const [tradeShortcut,setTradeShortcut]=useState(null);
  const openTradeShortcut=side=>{setShowOrders(true);setTradeShortcut({side});};
  const openBrackets=orders.filter(order=>order.mode==='bracket' && order.status==='open');
  const activePosition=orders.find(order=>order.mode==='bracket'&&order.id===selectedPosition)||openBrackets.at(-1);
  const chartShell=useRef(null);
  const [fullscreen,setFullscreen]=useState(null);

  useEffect(()=>{
    const sync=()=>setFullscreen(mode=>document.fullscreenElement===chartShell.current?'browser':
      mode==='browser'?null:mode);
    const escape=event=>{
      if(event.key==='Escape')setFullscreen(mode=>mode==='window'?null:mode);
    };
    document.addEventListener('fullscreenchange',sync);
    document.addEventListener('keydown',escape);
    return ()=>{
      document.removeEventListener('fullscreenchange',sync);
      document.removeEventListener('keydown',escape);
    };
  },[]);

  const toggleFullscreen=async()=>{
    if(fullscreen==='browser'){
      await document.exitFullscreen();
    }else if(fullscreen==='window'){
      setFullscreen(null);
    }else{
      try{
        await chartShell.current.requestFullscreen();
      }catch{
        setFullscreen('window');
      }
    }
  };
  const [drawingMode,setDrawingMode]=useState(null);
  const [syncStatus,setSyncStatus]=useState('');
  const [busy,setBusy]=useState(true);
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
    const path='/api/sessions/'+sid;
    const state=await api(path);
    const [candleData,drawData,orderData]=await Promise.all([
      api(path+'/candles?tf='+timeframe),
      api(path+'/drawings'),
      api(path+'/orders?cursor='+state.cursor),
    ]);
    if(candleData.clock_ms!==state.clock_ms)throw new Error('Replay cursor changed while loading candles.');
    setSession(state);setCandles(candleData.candles);setDrawings(drawData);setOrders(orderData);
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
              const orderPayload=await api(`/api/sessions/${saved}/orders?cursor=${state.cursor}`);
              if(active){
                setCandles(candlesPayload.candles);setDrawings(drawingsPayload);setOrders(orderPayload);
              }
            }
            return;
          }catch { localStorage.removeItem('crl-session'); }
        }
        const initial=data.find(d=>d.id==='raw:BTCUSDT')||data.find(d=>d.id==='synthetic-demo')||data[0];
        if(initial && active){
          const created=await post('/api/sessions',{dataset_id:initial.id,start:'random'});
          if(!active)return;
          localStorage.setItem('crl-session',created.id);
          setSelected(initial.id);setSession(created);
          const payload=await api(`/api/sessions/${created.id}/candles?tf=1h`);
          setCandles(payload.candles);
        }
      }catch(e){if(active)setError(e.message);}finally{if(active)setBusy(false);}
    })();
    return()=>{active=false;};
  },[]);

  const run=async(fn)=>{
    if(busy)return;
    setBusy(true);setError('');
    try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}
  };

  const openReplay=async(datasetId,start)=>{
    const created=await post('/api/sessions',{dataset_id:datasetId,start});
    await refreshSession(created.id,'1h');
    localStorage.setItem('crl-session',created.id);
    setSelected(datasetId);setTf('1h');setDrawingMode(null);
  };

  const newSession=(datasetId=selected,start='random')=>run(async()=>{
    setSyncStatus('');
    await openReplay(datasetId,start);
  });

  const syncLatest=()=>run(async()=>{
    if(!session)return;
    setSyncStatus('');
    const result=await post('/api/datasets/'+encodeURIComponent(session.dataset_id)+'/sync',{});
    await openReplay(session.dataset_id,'latest');
    const last=new Date(result.last_ms+900000).toISOString().slice(0,16).replace('T',' ');
    setSyncStatus(last+' UTC'+(result.added?' / +'+result.added+' candles':''));
  });

  const step=(amount)=>run(async()=>{
    if(!session)return;
    await post(`/api/sessions/${session.id}/step`,{amount,timeframe:tf});
    await refreshSession(session.id,tf);
  });

  const changeTf=(value)=>run(async()=>{
    if(!session)return;
    await refreshSession(session.id,value);
    setTf(value);
  });

  const addLine=(drawing)=>run(async()=>{
    if(!session)return;
    await post('/api/sessions/'+session.id+'/drawings',{...drawing,timeframe:tf});
    setDrawings(await api('/api/sessions/'+session.id+'/drawings'));
  });

  const updateDrawing=(id,changes)=>run(async()=>{
    if(!session)return;
    const url='/api/sessions/'+session.id+'/drawings/'+encodeURIComponent(id);
    await api(url,{method:'PATCH',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(changes)});
    setDrawings(await api('/api/sessions/'+session.id+'/drawings'));
  });

  const removeDrawing=(id)=>run(async()=>{
    if(!session)return;
    const path='/api/sessions/'+session.id+'/drawings';
    await api(id?path+'/'+encodeURIComponent(id):path,{method:'DELETE'});
    setDrawings(await api(path));
  });

  const placeOrder=(side,quantity,tpPercent,slPercent)=>run(async()=>{
    const path='/api/sessions/'+session.id+'/orders';
    const placed=await post(path,{side,quantity,cursor:session.cursor,
      mode:'bracket',tp_percent:tpPercent,sl_percent:slPercent});
    setSelectedPosition(placed.id);
    setOrders(await api(path+'?cursor='+session.cursor));
  });

  const manageOrder=(id,action)=>run(async()=>{
    const path='/api/sessions/'+session.id+'/orders';
    if(action==='cancel'){
      await api(path+'/'+id,{method:'DELETE'});
    }else if(action==='close-now'){
      await post('/api/sessions/'+session.id+'/paper-positions/'+id+'/close',{cursor:session.cursor});
    }else{
      await post(path+'/'+id+'/close',{cursor:session.cursor});
    }
    setOrders(await api(path+'?cursor='+session.cursor));
  });

  const adjustPosition=(id,key,value)=>run(async()=>{
    const path='/api/sessions/'+session.id;
    await api(path+'/paper-positions/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({cursor:session.cursor,[key]:value})});
    setOrders(await api(path+'/orders?cursor='+session.cursor));
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

  const date=session ? new Date(session.clock_ms).toISOString().replace('T',' ').slice(0,16)+' UTC':'—';

  return <div className="app">
    <header className="topbar">
      <div className="brand"><span className="brand-dot"/> CRYPTO <strong>REPLAY LAB</strong> <span className="version">V0.1</span></div>
      <div className="topright"><span className="tag">RESEARCH ONLY</span><span className="tag">LOCAL FIRST</span></div>
    </header>
    <main className="workspace">
      <section className="headline">
        <div><h1>Replay workstation</h1><p>UTC replay · Local Parquet, Binance 1m imports, and synthetic demo</p></div>
        <div className="headline-actions"><button onClick={()=>setShowData(!showData)}>Data / import</button><button className="accent" disabled={busy} onClick={()=>newSession()}>New replay</button></div>
      </section>
      {error&&<div className="alert" role="alert">{error}</div>}
      {showData&&<section className="panel data-panel">
        <strong>Import historical Binance USDT-M 1-minute klines</strong>
        <p>Supports CSV/ZIP (max 30MB upload). Ensure chronological 1m data; gaps are flagged. No API key.</p>
        <div className="data-actions">
          <label>Dataset<select value={selected} onChange={e=>setSelected(e.target.value)}>{datasets.map(d=><option key={d.id} value={d.id}>{d.symbol} · {baseTf(d.base_ms)}{d.candles!=null?' ('+d.candles.toLocaleString()+' bars)':''}{d.is_demo?' — SYNTHETIC':''}{d.gap_count?' — GAPS':''}</option>)}</select></label>
          <label>Symbol<input value={symbol} onChange={e=>setSymbol(e.target.value)}/></label>
          <label>File<input type="file" accept=".csv,.zip" onChange={e=>setUpload(e.target.files?.[0]||null)}/></label>
          <button disabled={busy} onClick={importFile}>Import</button>
        </div>
        <p>After selecting a dataset, press <strong>New replay</strong> to start a new session.</p>
      </section>}
      <section ref={chartShell} className="panel chart-shell" data-fullscreen={fullscreen||undefined}>
        <div className="toolbar">
          <div className="instrument">
            {blind?<span>ASSET X</span>:<select aria-label="Symbol" disabled={busy} value={session?.dataset_id||''}
              onChange={e=>newSession(e.target.value)}>
              {!session&&<option value="">Loading...</option>}
              {[...datasets].sort((a,b)=>a.symbol.localeCompare(b.symbol)).map(d=>
                <option key={d.id} value={d.id}>{d.symbol} / {baseTf(d.base_ms)}</option>)}
            </select>}
          </div>
          <div className="tf-list">{TFS.map(t=><button className={tf===t?'active':''} key={t} disabled={busy||!session||TFS.indexOf(t)<TFS.indexOf(baseTf(session.base_ms))} onClick={()=>changeTf(t)}>{t.toUpperCase()}</button>)}</div>
          <div className="toolbar-right">
            <button aria-expanded={showOrders} disabled={!session} onClick={()=>setShowOrders(open=>!open)}>
              Trade{orders.length>0?' ('+orders.length+')':''}
            </button>
            <button disabled={busy||!session} onClick={()=>newSession(session.dataset_id,'latest')}>Latest local</button>
            {session?.dataset_id.startsWith('raw:')&&<button disabled={busy} onClick={syncLatest}>Sync Binance</button>}
            {syncStatus&&<span className="muted" role="status">{syncStatus}</span>}
          </div>
        </div>
        <div className="chart-with-aside">
          <ChartPanel candles={candles} timeframe={tf} sessionId={session?.id}
            drawings={drawings} drawingMode={drawingMode} onNewLine={addLine} onUpdateDrawing={updateDrawing} busy={busy}
            onDrawingMode={setDrawingMode} onRemoveDrawing={removeDrawing}
            fullscreen={Boolean(fullscreen)} onToggleFullscreen={toggleFullscreen}
            paperPosition={activePosition} onAdjustPosition={adjustPosition}
            positionLocked={busy||session?.cursor!==session?.max_seen_cursor}
            onTradeShortcut={openTradeShortcut}/>
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
        {showOrders&&session&&<OrderPanel orders={orders} busy={busy} session={session}
          onPlace={placeOrder} onManage={manageOrder} activePosition={activePosition?.id}
          onSelect={setSelectedPosition} shortcut={tradeShortcut}/>}
        <div className="playback">
          <span>REPLAY</span>
          <button disabled={busy||!session} onClick={()=>step(-20)}>−20</button>
          <button disabled={busy||!session} onClick={()=>step(-10)}>−10</button>
          <button disabled={busy||!session} onClick={()=>step(-1)}>◀ −1</button>
          <button className="accent" disabled={busy||!session} onClick={()=>step(1)}>+1 ▶</button>
          <button disabled={busy||!session} onClick={()=>step(10)}>+10</button>
          <button disabled={busy||!session} onClick={()=>step(20)}>+20</button>
          <span className="muted">Step = candle TF aktif ({tf.toUpperCase()})</span>
        </div>
      </section>
    </main>
  </div>;
}
