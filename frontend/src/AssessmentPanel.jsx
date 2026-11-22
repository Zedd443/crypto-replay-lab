import React,{useCallback,useEffect,useMemo,useState} from 'react';

const ZONES=new Set(['rectangle','horizontal','horizontal_ray']);
const PLANS=new Set(['long_position','short_position']);
const canAssess=d=>d&&(ZONES.has(d.kind)||PLANS.has(d.kind));
const fmt=(x,n=2)=>x==null||!Number.isFinite(Number(x))?'—':Number(x).toFixed(n);

export default function AssessmentPanel({session,timeframe,drawings=[],selectedDrawing,onSelectDrawing,isDemo}){
  const [items,setItems]=useState([]);
  const [summary,setSummary]=useState(null);
  const [structure,setStructure]=useState(null);
  const [selected,setSelected]=useState('');
  const [intent,setIntent]=useState('bounce_up');
  const [horizon,setHorizon]=useState(20);
  const [target,setTarget]=useState(1);
  const [stop,setStop]=useState(1);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [info,setInfo]=useState('');
  const base='/api/sessions/'+session?.id;
  const eligible=useMemo(()=>drawings.filter(canAssess),[drawings]);
  const drawingId=selectedDrawing&&eligible.some(x=>x.id===selectedDrawing)?
    selectedDrawing:(selected&&eligible.some(x=>x.id===selected)?selected:eligible.at(-1)?.id||'');
  const drawing=eligible.find(x=>x.id===drawingId);
  const isPlan=PLANS.has(drawing?.kind);
  const existing=items.find(x=>x.drawing_id===drawingId);
  const request=useCallback(async(url,options)=>{
    const response=await fetch(url,options);
    const payload=await response.json();
    if(!response.ok)throw new Error(payload.error||'Assessment request failed');
    return payload;
  },[]);
  const load=useCallback(async()=>{
    if(!session)return;
    const [a,s]=await Promise.all([
      request('/api/sessions/'+session.id+'/assessments'),
      request('/api/sessions/'+session.id+'/market-structure?tf='+timeframe+'&pivot=2')
    ]);
    setItems(a.items);setSummary(a.summary);setStructure(s);
  },[session?.id,session?.cursor,timeframe,request]);
  useEffect(()=>{
    let mounted=true;
    if(!session){setItems([]);setSummary(null);setStructure(null);return;}
    Promise.all([
      request(base+'/assessments'),
      request(base+'/market-structure?tf='+timeframe+'&pivot=2')
    ]).then(([a,s])=>{
      if(!mounted)return;
      setItems(a.items);setSummary(a.summary);setStructure(s);
    }).catch(e=>{if(mounted)setError(e.message)});
    return()=>{mounted=false};
  },[session?.id,session?.cursor,timeframe,request]);

  const lock=async()=>{
    if(!drawing||busy)return;
    setBusy(true);setError('');setInfo('');
    try{
      const result=await request(base+'/assessments',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          drawing_id:drawingId,intent:isPlan?'rr_plan':intent,
          horizon:Number(horizon),target_pct:Number(target),stop_pct:Number(stop)
        })
      });
      await load();
      setInfo('Hypothesis locked at cursor '+result.locked_cursor+
        '. Advance replay to score subsequent completed candles.');
    }catch(e){setError(e.message)}
    finally{setBusy(false)}
  };
  const resolved=items.filter(x=>['SUCCESS','FAILED'].includes(x.status));
  const grouped=Object.values(resolved.reduce((acc,x)=>{
    const key=x.drawing.kind+' / '+x.intent;
    if(!acc[key])acc[key]={name:key,wins:0,total:0};
    acc[key].total++;
    if(x.status==='SUCCESS')acc[key].wins++;
    return acc;
  },{}));
  return <section className="assessment-lab" aria-label="Drawing assessments">
    <p className="assessment-note">
      <strong>Hypothesis lock → Replay +N → Objective outcome.</strong>
      {' '}No paper order required. Score is separate from structural rule agreement.
      {isDemo&&<span> SYNTHETIC/DEMO DATA — not market evidence.</span>}
    </p>
    <div className="assessment-stat-grid">
      <div><small>Locked</small><strong>{summary?.locked??0}</strong></div>
      <div><small>Resolved</small><strong>{summary?.resolved??0}</strong></div>
      <div><small>Hypothesis accuracy</small><strong>{summary?.accuracy_pct==null?'—':fmt(summary.accuracy_pct,1)+'%'}</strong></div>
      <div><small>Pending</small><strong>{summary?.pending??0}</strong></div>
      <div><small>Ambiguous</small><strong>{summary?.ambiguous??0}</strong></div>
    </div>
    {session?.contaminated&&<p role="alert" className="assessment-warning">
      Rewind audit: this session has viewed future candles. Existing locks remain visible at their
      original cursor, but new scored hypotheses are disabled. Start a new replay to lock new trials.
    </p>}
    <div className="assessment-layout">
      <form className="assessment-form" onSubmit={e=>{e.preventDefault();lock();}}>
        <h3>Lock selected drawing</h3>
        <label>Drawing
          <select aria-label="Assessment drawing" value={drawingId} disabled={!eligible.length}
            onChange={e=>{setSelected(e.target.value);onSelectDrawing?.(e.target.value);}}>
            {eligible.length===0&&<option value="">Create a rectangle, level, or Long/Short plan</option>}
            {eligible.map(d=><option key={d.id} value={d.id}>{d.kind} · {fmt(d.price,4)} · {d.id.slice(0,8)}</option>)}
          </select>
        </label>
        {drawing&&<>
          <label>Hypothesis
            <select aria-label="Assessment hypothesis" value={isPlan?'rr_plan':intent}
              disabled={isPlan} onChange={e=>setIntent(e.target.value)}>
              {isPlan?<option value="rr_plan">{drawing.kind==='long_position'?'Long':'Short'} TP before SL</option>:<>
                <option value="bounce_up">Support bounce upward</option>
                <option value="bounce_down">Resistance rejection downward</option>
                <option value="break_up">Bullish breakout continuation</option>
                <option value="break_down">Bearish breakdown continuation</option>
              </>}
            </select>
          </label>
          <label>Evaluation horizon (completed {drawing.timeframe} candles)
            <input aria-label="Assessment horizon" type="number" min="1" max="200" step="1"
              value={horizon} onChange={e=>setHorizon(e.target.value)}/>
          </label>
          {!isPlan&&<div className="assessment-targets">
            <label>Target %
              <input aria-label="Assessment target percent" type="number" min=".01" max="50" step=".1"
                value={target} onChange={e=>setTarget(e.target.value)}/>
            </label>
            <label>Invalidation %
              <input aria-label="Assessment invalidation percent" type="number" min=".01" max="50" step=".1"
                value={stop} onChange={e=>setStop(e.target.value)}/>
            </label>
          </div>}
          {isPlan&&<p className="assessment-note">Use frozen drawing Entry, TP, and SL. An assessment
            does not execute a paper trade.</p>}
          <button type="submit" disabled={!drawing||busy||Boolean(existing)||
            session?.contaminated||session?.cursor!==session?.max_seen_cursor}>
            {existing?'Already locked':'Lock hypothesis'}
          </button>
          <small>One immutable hypothesis per drawing. Edits to the drawing after locking do not
            change the original assessment. Same-bar execution ambiguities are reported, not guessed.</small>
        </>}
        {info&&<p role="status" className="assessment-success">{info}</p>}
        {error&&<p role="alert" className="assessment-warning">{error}</p>}
      </form>
      <div className="assessment-structure">
        <h3>Confirmed market structure · {timeframe.toUpperCase()}</h3>
        <div className="assessment-structure-summary">
          <span>Rule: 2 left + 2 right bars</span>
          <strong>{structure?.trend?.toUpperCase()||'—'}</strong>
        </div>
        <div className="assessment-event-list">
          {(structure?.swings||[]).slice(-5).reverse().map((s,i)=><div key={'s'+i}>
            <strong>{s.type}</strong> <span>{fmt(s.price,3)} · confirmed {new Date(s.confirmed_time).toISOString().slice(5,16).replace('T',' ')}</span>
          </div>)}
          {(structure?.events||[]).slice(-5).reverse().map((s,i)=><div key={'e'+i}>
            <strong>{s.type} {s.direction}</strong>
            <span>{fmt(s.price,3)} · confirmed {new Date(s.confirmed_time).toISOString().slice(5,16).replace('T',' ')}</span>
          </div>)}
          {!structure?.swings?.length&&<p>Not enough confirmed pivots in currently visible history.</p>}
        </div>
      </div>
    </div>
    <h3>Locked hypotheses & evaluations</h3>
    {items.length?<div className="assessment-results">
      {items.map(x=><article className="assessment-result" key={x.id}>
        <div className="assessment-result-top">
          <strong>{x.drawing.kind} · {x.intent.replaceAll('_',' ')}</strong>
          <span className={'assessment-status status-'+x.status.toLowerCase()}>{x.status}</span>
        </div>
        <div className="assessment-result-meta">
          <span>{x.observed}/{x.horizon} completed bars</span>
          <span>Structure: {x.structure.status}</span>
          <span>{x.timeframe.toUpperCase()}</span>
        </div>
        <p>{x.reason}</p>
        <small>{x.structure.reason}</small>
        {(x.mfe_pct!=null||x.mae_pct!=null)&&<small>
          {' '}MFE {fmt(x.mfe_pct)}% · MAE {fmt(x.mae_pct)}%
        </small>}
      </article>)}
    </div>:<p className="assessment-note">No locked hypotheses yet. Create and select a drawing, lock
      an explicit outcome, then advance the replay.</p>}
    {grouped.length>0&&<div className="assessment-breakdown">
      <h3>Accuracy by hypothesis type (resolved only)</h3>
      {grouped.map(x=><div key={x.name}>
        <span>{x.name}</span><strong>{x.wins}/{x.total} · {fmt(x.wins/x.total*100,1)}%</strong>
      </div>)}
    </div>}
    <p className="assessment-note">Rule agreement is not universal technical-analysis ground truth.
      Accuracy excludes pending, ambiguous, no-trigger and timeout cases; inspect their counts separately.
      A successful hypothetical outcome is not the same as profitable execution.</p>
  </section>;
}
