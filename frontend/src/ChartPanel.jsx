import React, { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, CrosshairMode, createSeriesMarkers } from 'lightweight-charts';
import BracketOverlay from './BracketOverlay.jsx';
import DrawingTools, {DRAWING_TOOLS} from './DrawingTools.jsx';
import ShapeOverlay from './ShapeOverlay.jsx';
import {calculateIndicator, INDICATORS, INDICATOR_SETTINGS, DEFAULT_INDICATOR_OPTIONS} from './indicators.js';
import {FIB_LEVELS} from './research.js';

export default function ChartPanel({ candles, timeframe, sessionId, drawings, drawingMode, onNewLine, onUpdateDrawing, busy, onDrawingMode, onRemoveDrawing, fullscreen, onToggleFullscreen, paperPosition, onAdjustPosition, positionLocked, onTradeShortcut,
  selectedDrawing, onSelectDrawing, orders=[], onSignalSelection }) {
  const rootRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const drawingModeRef = useRef(drawingMode);
  const onNewLineRef = useRef(onNewLine);
  const chartLinesRef = useRef([]);
  const drawingPriceLabelsRef = useRef([]);
  const candlesRef=useRef(candles);
  const timeframeRef=useRef(timeframe);
  candlesRef.current=candles;
  timeframeRef.current=timeframe;
  const trendlinesRef = useRef([]);
  const indicatorSeries = useRef(new Map());
  const indicatorMarkers = useRef(null);
  const displayedRef = useRef({key:null,length:0,last:null});
  const [indicatorMenu,setIndicatorMenu] = React.useState(false);
  const [enabled,setEnabled] = React.useState(()=>{
    try{return JSON.parse(localStorage.getItem('crl-enabled-indicators')||'["ema"]');}catch{return ['ema'];}
  });
  const [parameters,setParameters]=React.useState(()=>{
    try{return {...DEFAULT_INDICATOR_OPTIONS,...JSON.parse(localStorage.getItem('crl-indicator-settings')||'{}')};}
    catch{return DEFAULT_INDICATOR_OPTIONS;}
  });
  const [drawingColor,setDrawingColor]=React.useState(()=>{
    try{return localStorage.getItem('crl-drawing-color')||'#f0c266';}catch{return '#f0c266';}
  });
  React.useEffect(()=>{
    const marker=INDICATORS.find(([id,,kind])=>kind==='marker'&&enabled.includes(id));
    if(marker)onSignalSelection?.({id:marker[0],parameters:parameters[marker[0]]});
  },[enabled,parameters,onSignalSelection]);
  const activeIndicators=React.useMemo(()=>INDICATORS.filter(([id])=>enabled.includes(id))
    .map(([id,label,kind])=>({id,label,kind,...calculateIndicator(id,candles,parameters[id])})),
    [enabled,candles,parameters]);
  React.useEffect(()=>{try{localStorage.setItem('crl-enabled-indicators',JSON.stringify(enabled));}catch{/* ignored */}},[enabled]);
  React.useEffect(()=>{try{localStorage.setItem('crl-indicator-settings',JSON.stringify(parameters));}catch{/* ignored */}},[parameters]);
  const updateParameter=(id,key,value)=>setParameters(old=>({...old,[id]:{...(old[id]||{}),[key]:Number(value)}}));
  const toggleIndicator=(id,kind)=>setEnabled(previous=>{
    if(previous.includes(id))return previous.filter(value=>value!==id);
    const paneIds=INDICATORS.filter(entry=>entry[2]==='pane').map(entry=>entry[0]);
    return [...previous.filter(value=>kind!=='pane'||!paneIds.includes(value)),id];
  });
  const firstAnchor = useRef(null);
  const busyRef = useRef(busy);
  const [awaitingEnd,setAwaitingEnd] = React.useState(false);
  const [drawingListOpen,setDrawingListOpen] = React.useState(false);
  const [toolMenu,setToolMenu] = React.useState(false);
  const hasOpenPosition=paperPosition?.status==='open';
  const shapes=React.useMemo(()=>drawings.filter(d=>d.timeframe===timeframe &&
    ['horizontal_ray','vertical','trendline','rectangle','fib','long_position','short_position'].includes(d.kind)),[drawings,timeframe]);
  const showToolMenu=open=>{
    setToolMenu(open);
    if(open){setDrawingListOpen(false);setIndicatorMenu(false);}
  };
  const setSelectedDrawing=onSelectDrawing;
  const [draftShape,setDraftShape] = React.useState(null);
  const chosen=drawings.find(d=>d.id===selectedDrawing);
  const chooseColor=value=>{
    setDrawingColor(value);
    try{localStorage.setItem('crl-drawing-color',value);}catch{/* ignored */}
    if(chosen)onUpdateDrawing(chosen.id,{color:value});
  };
  busyRef.current = busy;
  React.useEffect(()=>{
    const handler=event=>{
      const el=event.target;
      if(el?.closest?.('input,textarea,select,[contenteditable="true"]')||
        event.ctrlKey||event.metaKey||event.altKey)return;
      if(event.key==='Escape'){
        if(selectedDrawing){setSelectedDrawing(null);event.preventDefault();}
        return;
      }
      if(['Delete','Backspace'].includes(event.key)&&selectedDrawing&&!busy){
        event.preventDefault();onRemoveDrawing?.(selectedDrawing);
        setSelectedDrawing(null);
      }
    };
    document.addEventListener('keydown',handler);
    return()=>document.removeEventListener('keydown',handler);
  },[selectedDrawing,busy,onRemoveDrawing,onSelectDrawing]);
  const resetAnchor = () => {
    firstAnchor.current = null;
    setAwaitingEnd(false);
  };

  useEffect(() => {
    resetAnchor();
    setDraftShape(null);
  }, [drawingMode, timeframe, sessionId]);
  drawingModeRef.current = drawingMode;
  onNewLineRef.current = drawing=>{
    onNewLine?.({...drawing,color:drawingColor});
    onDrawingMode?.(null);
  };

  useEffect(() => {
    if (!rootRef.current) return;
    const chart = createChart(rootRef.current, {
      autoSize: true,
      layout: { background: { color: '#101b2e' }, textColor: '#AFC0D5' },
      grid: { vertLines: { color: '#233047' }, horzLines: { color: '#233047' } },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { borderColor: '#33465e', timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: '#33465e', autoScale: true },
      handleScroll: true, handleScale: true,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#42B891', downColor: '#E17978',
      wickUpColor: '#42B891', wickDownColor: '#E17978',
      borderVisible: false, priceLineVisible: true,
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    chartRef.current=chart;
    candleSeriesRef.current=series;
    volumeSeriesRef.current=volume;
    indicatorMarkers.current=createSeriesMarkers(series,[]);
    const pane=chart.panes()[0].getHTMLElement();
    let pointerStart=null;
    let dragStart=null;
    const point=(event)=>{
      const bounds=pane.getBoundingClientRect(),scale=chart.timeScale();
      const x=event.clientX-bounds.left-chart.priceScale('left').width();
      const y=event.clientY-bounds.top;
      if(x<0||x>=scale.width()||y<0||y>=bounds.height)return null;
      const time=scale.coordinateToTime(x);
      const price=series.coordinateToPrice(y);
      return typeof time==='number'&&Number.isFinite(price)&&price>0?
        {time:time*1000,price}:null;
    };
    const makeDraft=(first,last,kind)=>{
      if(!first||!last||first.time===last.time)return null;
      const [a,b]=first.time<last.time?[first,last]:[last,first];
      if(['rectangle','fib','trendline'].includes(kind))return {id:'draft',kind,price:a.price,end_price:b.price,
        anchor_start:a.time,anchor_end:b.time};
      const diff=Math.abs(last.price-first.price);
      if(diff<=0||!Number.isFinite(diff))return null;
      const direction=kind==='long_position'?1:-1;
      const stop=first.price-direction*diff;
      const target=first.price+direction*2*diff;
      if(stop<=0||target<=0)return null;
      return {id:'draft',kind,price:first.price,end_price:stop,
        take_profit:target,anchor_start:a.time,anchor_end:b.time};
    };
    const onPointerDown=(event)=>{
      pointerStart={x:event.clientX,y:event.clientY};
      const kind=drawingModeRef.current;
      if(busyRef.current||event.button!==0||!['rectangle','fib','long_position','short_position'].includes(kind))return;
      const anchor=point(event);
      if(!anchor)return;
      dragStart={anchor,x:event.clientX,y:event.clientY,kind};
      pane.setPointerCapture(event.pointerId);
      event.preventDefault();event.stopPropagation();
    };
    const onPointerMove=event=>{
      const p=point(event);
      if(!dragStart){
        if(firstAnchor.current&&p&&['trendline','rectangle','fib'].includes(drawingModeRef.current))
          setDraftShape(makeDraft(firstAnchor.current,p,drawingModeRef.current));
        return;
      }
      setDraftShape(p?makeDraft(dragStart.anchor,p,dragStart.kind):null);
      event.preventDefault();event.stopPropagation();
    };
    const onPointerUp=event=>{
      if(!dragStart)return;
      const start=dragStart;
      const p=point(event);
      const drawing=p?makeDraft(start.anchor,p,start.kind):null;
      dragStart=null;
      const moved=Math.abs(event.clientX-start.x)>7&&Math.abs(event.clientY-start.y)>3;
      if(drawing&&moved){
        resetAnchor();setDraftShape(null);
        const {id,...payload}=drawing;
        onNewLineRef.current?.(payload);
      }else if(['rectangle','fib'].includes(start.kind)){
        if(firstAnchor.current){
          const completed=p?makeDraft(firstAnchor.current,p,start.kind):null;
          if(completed){resetAnchor();setDraftShape(null);
            const {id,...payload}=completed;onNewLineRef.current?.(payload);}
        }else{firstAnchor.current=start.anchor;setAwaitingEnd(true);}
      }else if(['long_position','short_position'].includes(start.kind)){
        setDraftShape(null);
        // One-click placement: default SL 1%, TP 2%; immediately editable.
        const anchor=start.anchor,scale=chart.timeScale(),bounds=pane.getBoundingClientRect();
        const x=event.clientX-bounds.left-chart.priceScale('left').width();
        const before=scale.coordinateToTime(Math.max(0,x-110));
        const seriesBars=candlesRef.current;
        const fallback=seriesBars[Math.max(0,seriesBars.length-12)]?.time;
        const first=typeof before==='number'&&before*1000<anchor.time?before*1000:fallback;
        const long=start.kind==='long_position',stop=anchor.price*(long?.99:1.01),target=anchor.price*(long?1.02:.98);
        if(first!=null&&first<anchor.time&&stop>0&&target>0){
          onNewLineRef.current?.({kind:start.kind,price:anchor.price,end_price:stop,take_profit:target,
            anchor_start:first,anchor_end:anchor.time});
        }
      }
      try{pane.releasePointerCapture(event.pointerId);}catch{/* capture already lost */}
      event.preventDefault();event.stopPropagation();
    };
    const onClick=(event) => {
      if(!drawingModeRef.current){setSelectedDrawing(null);return;}
      if (busyRef.current ||
          ['rectangle','fib','long_position','short_position'].includes(drawingModeRef.current) || !pointerStart ||
          Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)>5) return;
      const bounds=pane.getBoundingClientRect();
      const scale=chart.timeScale();
      const x=event.clientX-bounds.left-chart.priceScale('left').width();
      const y=event.clientY-bounds.top;
      if(x<0 || x>=scale.width() || y<0 || y>=bounds.height)return;
      const time=scale.coordinateToTime(x);
      if(typeof time!=='number')return;
      const price=series.coordinateToPrice(y);
      if (price == null || !Number.isFinite(price) || price<=0) return;
      if (drawingModeRef.current === 'horizontal') {
        onNewLineRef.current({kind:'horizontal',price});
        return;
      }
      const anchor = {time:time*1000,price};
      const kind=drawingModeRef.current;
      if(kind==='horizontal_ray'||kind==='vertical'){
        onNewLineRef.current({kind,price,anchor_start:anchor.time});
        return;
      }
      if (!firstAnchor.current) {
        firstAnchor.current = anchor;
        setAwaitingEnd(true);
        return;
      }
      if (firstAnchor.current.time === anchor.time) return;
      const draft=makeDraft(firstAnchor.current,anchor,kind);
      resetAnchor();setDraftShape(null);
      if(draft){const {id,...drawing}=draft;onNewLineRef.current(drawing);}
      else{
        const [start,end]=[firstAnchor.current,anchor].sort((a,b)=>a.time-b.time);
        onNewLineRef.current({kind,price:start.price,end_price:end.price,
          anchor_start:start.time,anchor_end:end.time});
      }
    };
    pane?.addEventListener('pointerdown',onPointerDown,true);
    pane?.addEventListener('pointermove',onPointerMove,true);
    pane?.addEventListener('pointerup',onPointerUp,true);
    pane?.addEventListener('pointercancel',onPointerUp,true);
    pane?.addEventListener('click',onClick);
    return () => {
      pane?.removeEventListener('pointerdown',onPointerDown,true);
      pane?.removeEventListener('pointermove',onPointerMove,true);
      pane?.removeEventListener('pointerup',onPointerUp,true);
      pane?.removeEventListener('pointercancel',onPointerUp,true);
      pane?.removeEventListener('click',onClick);
      indicatorMarkers.current?.detach();
      indicatorMarkers.current=null;
      indicatorSeries.current.clear();
      chart.remove();
      chartLinesRef.current=[];
      trendlinesRef.current=[];
      chartRef.current=null;
      candleSeriesRef.current=null;
      volumeSeriesRef.current=null;
    };
  }, []);

  useEffect(() => {
    const chart=chartRef.current;
    const series=candleSeriesRef.current;
    const vol=volumeSeriesRef.current;
    if (!chart || !series || !vol) return;
    const ohlc=candles.map(c=>({
      time:c.time/1000,open:c.open,high:c.high,low:c.low,close:c.close,
    }));
    const volumeBars=candles.map(c=>({
      time:c.time/1000,value:c.volume,color:c.close>=c.open?'#286c61':'#784448'
    }));
    const key=sessionId+':'+timeframe, prev=displayedRef.current;
    const scale=chart.timeScale(), visible=scale.getVisibleLogicalRange();
    if(prev.key&&prev.key!==key&&visible)try{
      localStorage.setItem('crl-view:'+prev.key,JSON.stringify(visible));
    }catch{/* storage disabled */}
    const last=ohlc.at(-1)?.time??null;
    const append=prev.key===key&&prev.length===ohlc.length-1&&prev.last===ohlc.at(-2)?.time;
    const replaceLast=prev.key===key&&prev.length===ohlc.length&&prev.last===last;
    displayedRef.current={key,length:ohlc.length,last};
    if((append||replaceLast)&&last!==null){
      series.update(ohlc.at(-1));vol.update(volumeBars.at(-1));
    }else{
      series.setData(ohlc);vol.setData(volumeBars);
      if(prev.key!==key){
        let saved=null;
        try{saved=JSON.parse(localStorage.getItem('crl-view:'+key)||'null');}catch{/* ignore */}
        if(saved&&Number.isFinite(saved.from)&&Number.isFinite(saved.to)){
          scale.setVisibleLogicalRange(saved);
        }else showRecent(chart,candles.length,hasOpenPosition);
      }else if(visible&&Number.isFinite(visible.from)&&Number.isFinite(visible.to)){
        scale.setVisibleLogicalRange(visible);
      }
    }
  }, [candles,timeframe,sessionId]);

  useEffect(()=>{
    const scale=chartRef.current?.timeScale();
    if(!scale)return;
    const save=range=>{
      const key=displayedRef.current.key;
      if(!key||!range||!Number.isFinite(range.from)||!Number.isFinite(range.to))return;
      try{localStorage.setItem('crl-view:'+key,JSON.stringify(range));}catch{/* ignore */}
    };
    scale.subscribeVisibleLogicalRangeChange(save);
    return()=>scale.unsubscribeVisibleLogicalRangeChange(save);
  },[]);

  useEffect(() => {
    const series=candleSeriesRef.current;
    if (!series) return;
    for (const pl of chartLinesRef.current) series.removePriceLine(pl);
    chartLinesRef.current=drawings.filter(d=>d.kind==='horizontal').map(d=>series.createPriceLine({
      price:d.price, color:d.color||'#f0c266',lineWidth:2,lineStyle:2,
      axisLabelVisible:true,title:'User S/R'
    }));
    const chart=chartRef.current;
    for (const line of trendlinesRef.current) chart.removeSeries(line);
    const times = new Set(candles.map(c=>c.time));
    trendlinesRef.current=drawings.filter(d=>d.kind==='trendline' && d.timeframe===timeframe &&
      times.has(d.anchor_start) && times.has(d.anchor_end)).map(d=>{
      const line=chart.addSeries(LineSeries,{color:d.color||'#f0c266',lineWidth:2,
        priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false,
        autoscaleInfoProvider:()=>null});
      line.setData([{time:d.anchor_start/1000,value:d.price},{time:d.anchor_end/1000,value:d.end_price}]);
      return line;
    });
  }, [drawings,candles,timeframe,selectedDrawing]);

  useEffect(()=>{
    const series=candleSeriesRef.current;
    if(!series)return;
    for(const line of drawingPriceLabelsRef.current)series.removePriceLine(line);
    const selected=drawings.find(d=>d.id===selectedDrawing);
    const visible=drawings.filter(d=>d.timeframe===timeframe).slice(-25);
    const levels=[];
    for(const d of visible){
      if(!Number.isFinite(d.price))continue;
      if(d.kind!=='horizontal')levels.push({price:d.price,color:d.color||'#f0c266',
        label:d.kind==='long_position'?'Entry':d.kind==='fib'?'Fib 0':'Drawing'});
      if(d.id===selectedDrawing){
        if(Number.isFinite(d.end_price))levels.push({price:d.end_price,color:d.color||'#f0c266',
          label:d.kind==='long_position'||d.kind==='short_position'?'SL':'End'});
        if(Number.isFinite(d.take_profit))levels.push({price:d.take_profit,color:'#48d6ab',label:'TP'});
        if(d.kind==='fib')for(const ratio of FIB_LEVELS.slice(1,-2)){
          levels.push({price:d.price+(d.end_price-d.price)*ratio,color:d.color||'#f0c266',
            label:(ratio*100).toFixed(1)+'%'});
        }
      }
    }
    drawingPriceLabelsRef.current=levels.map(l=>series.createPriceLine({
      price:l.price,color:l.color,lineWidth:1,lineStyle:2,
      lineVisible:false,axisLabelVisible:true,title:l.label
    }));
    return()=>{for(const line of drawingPriceLabelsRef.current)series.removePriceLine(line);
      drawingPriceLabelsRef.current=[];};
  },[drawings,timeframe,selectedDrawing]);

  useEffect(()=>{
    const series=indicatorMarkers.current;
    if(!series)return;
    const bars=new Set(candles.map(c=>c.time/1000));
    const tradeMarkers=orders.flatMap(order=>{
      const direction=order.side==='long';
      const output=[];
      if(order.entry_ms!=null){
        const target=candles.findLast(c=>c.time<=order.entry_ms && c.time+(timeframe==='1m'?60000:0)>0);
        if(target&&bars.has(target.time/1000))output.push({
          time:target.time/1000,position:direction?'belowBar':'aboveBar',
          color:direction?'#45d5b1':'#ff8b93',shape:direction?'arrowUp':'arrowDown',
          text:(direction?'LONG':'SHORT')+' '+order.entry_price.toFixed(2)
        });
      }
      if(order.exit_ms!=null&&order.status==='closed'){
        const target=candles.findLast(c=>c.time<=order.exit_ms);
        if(target&&bars.has(target.time/1000))output.push({
          time:target.time/1000,position:direction?'aboveBar':'belowBar',
          color:order.pnl>=0?'#45d5b1':'#ff647b',shape:'circle',
          text:(order.exit_reason||'EXIT').toUpperCase()+' '+(order.pnl>=0?'+':'')+order.pnl.toFixed(2)
        });
      }
      return output;
    });
    const indicators=activeIndicators.flatMap(item=>item.markers||[]);
    series.setMarkers([...indicators,...tradeMarkers].sort((a,b)=>a.time-b.time));
  },[activeIndicators,orders,candles,timeframe]);

  useEffect(()=>{
    const chart=chartRef.current;
    if(!chart)return;
    const next=new Set(activeIndicators.flatMap(item=>(item.series||[]).map(line=>item.id+line.label)));
    for(const [key,series] of indicatorSeries.current){
      if(!next.has(key)){
        chart.removeSeries(series);
        indicatorSeries.current.delete(key);
      }
    }
    for(const indicator of activeIndicators){
      for(const line of indicator.series||[]){
        const key=indicator.id+line.label;
        let series=indicatorSeries.current.get(key);
        if(!series){
          series=chart.addSeries(line.kind==='histogram'?HistogramSeries:LineSeries,{
            color:line.color,lineWidth:1,title:line.label,priceLineVisible:false,
            lastValueVisible:true,crosshairMarkerVisible:false,
          },indicator.kind==='pane'?1:0);
          indicatorSeries.current.set(key,series);
        }
        series.setData(line.points);
      }
    }
    // Signal and executed-trade markers share the main candlestick series.
  },[activeIndicators]);

  useEffect(()=>{
    const series=candleSeriesRef.current;
    series?.applyOptions({autoscaleInfoProvider:original=>{
      const scale=original();
      if(!scale?.priceRange || !paperPosition)return scale;
      const {entry_price,take_profit,stop_loss}=paperPosition;
      return {...scale,priceRange:{
        minValue:Math.min(scale.priceRange.minValue,entry_price,take_profit,stop_loss),
        maxValue:Math.max(scale.priceRange.maxValue,entry_price,take_profit,stop_loss),
      }};
    }});
  },[paperPosition]);

  const reset=()=>{
    const chart=chartRef.current;
    if(!chart)return;
    chart.priceScale('right').applyOptions({autoScale:true});
    showRecent(chart,candles.length,hasOpenPosition);
  };

  return <div className="chart-frame">
    <div ref={rootRef} className="chart-area" aria-label="Interactive replay candlestick chart" />
    {paperPosition&&<BracketOverlay key={paperPosition.id} position={paperPosition} chart={chartRef}
      series={candleSeriesRef} candles={candles} disabled={positionLocked||paperPosition.status!=='open'}
      onAdjust={onAdjustPosition}/>}
    {(shapes.length>0||draftShape)&&<ShapeOverlay chart={chartRef} series={candleSeriesRef}
      drawings={shapes} draft={draftShape} selected={selectedDrawing} onSelect={setSelectedDrawing} orders={orders}
      onEdit={onUpdateDrawing} disabled={busy||positionLocked}/>}
    <DrawingTools open={toolMenu} onOpen={showToolMenu} mode={drawingMode}
      disabled={busy||!sessionId} onSelect={onDrawingMode} onTrade={onTradeShortcut}/>
    <div className="chart-drawing-tools" aria-label="Chart options">
      <button aria-expanded={drawingListOpen} aria-controls="chart-drawing-list"
        disabled={!sessionId} onClick={()=>{setDrawingListOpen(open=>!open);setIndicatorMenu(false);setToolMenu(false);}}>
        Drawings ({drawings.length})
      </button>
      <button aria-expanded={indicatorMenu} aria-controls="chart-indicators"
        onClick={()=>{setIndicatorMenu(open=>!open);setDrawingListOpen(false);setToolMenu(false);}}>Indicators ({enabled.length})</button>
      {indicatorMenu&&<section id="chart-indicators" className="chart-drawing-list indicator-list" aria-label="Indicators">
        {INDICATORS.map(([id,label,kind])=><div key={id} className="indicator-entry">
          <label><input type="checkbox" checked={enabled.includes(id)} onChange={()=>toggleIndicator(id,kind)}/>
          {label}</label>
          {enabled.includes(id)&&<div className="indicator-params">{(INDICATOR_SETTINGS[id]||[]).map(
            ([key,title,base,min,max])=><label key={key} title={title}>{title}
              <input type="number" step={['deviation','minGap','threshold'].includes(key)?0.1:1}
                min={min} max={max} value={parameters[id]?.[key]??base}
                onChange={e=>updateParameter(id,key,e.target.value)}/></label>
          )}</div>}
        </div>)}
        <p>Indicators are research aids, not validated buy/sell signals.</p>
      </section>}
      {awaitingEnd&&<span role="status">Move cursor to preview · click second point · Esc to cancel</span>}
      {draftShape?.kind&&<span className="draft-measure" role="status">
        {Math.abs(draftShape.end_price-draftShape.price).toFixed(3)} Δ ·
        {(100*(draftShape.end_price/draftShape.price-1)).toFixed(2)}% ·
        {Math.max(1,Math.round(Math.abs(draftShape.anchor_end-draftShape.anchor_start)/
          ({'1m':60000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,
            '4h':14400000,'1d':86400000,'1w':604800000}[timeframe]||3600000)))} bars
      </span>}
      {['rectangle','fib','long_position','short_position'].includes(drawingMode)&&
        <span role="status">Drag to draw · tap to place Long/Short · Esc to cancel</span>}
      {drawingListOpen&&<section id="chart-drawing-list" className="chart-drawing-list" aria-label="Saved drawings">
        {drawings.length===0?<p>No drawings at this cursor</p>:<>
          <ul>{drawings.map(d=>{
            const label=(DRAWING_TOOLS.find(tool=>tool.id===d.kind)?.label||d.kind)+' '+d.timeframe+' / '+d.price.toLocaleString();
            return <li key={d.id}>
              <button aria-pressed={selectedDrawing===d.id}
                onClick={()=>setSelectedDrawing(selectedDrawing===d.id?null:d.id)}>{label}</button>
              <button aria-label={'Delete '+label} disabled={busy}
                onClick={()=>onRemoveDrawing(d.id)}>Delete</button>
            </li>;
          })}</ul>
          <button className="clear-drawings" disabled={busy}
            onClick={()=>{if(window.confirm('Clear all drawings at this replay cursor?'))onRemoveDrawing();}}>
            Clear drawings
          </button>
        </>}
      </section>}
    </div>
    <div className="drawing-color-control" title="Default drawing color or selected drawing color">
      <label>{chosen?'Selected color':'Drawing color'} <input aria-label="Drawing color"
        type="color" value={chosen?.color||drawingColor} onChange={e=>chooseColor(e.target.value)}/></label>
      {chosen&&<button onClick={()=>setSelectedDrawing(null)}>Deselect</button>}
    </div>
    <div className="chart-view-tools">
      <button onClick={()=>chartRef.current?.timeScale().fitContent()}>Fit</button>
      <button onClick={reset}>Reset</button>
      <button aria-pressed={fullscreen} onClick={onToggleFullscreen}>
        {fullscreen?'Exit fullscreen':'Fullscreen'}
      </button>
    </div>
  </div>;
}

function showRecent(chart,count,padPosition) {
  if(count<=200&&!padPosition){
    chart.timeScale().fitContent();
    return;
  }
  const padding=padPosition?Math.min(18,Math.max(3,Math.ceil(count*0.09))):0;
  chart.timeScale().setVisibleLogicalRange({from:Math.max(0,count-200),to:count-1+padding});
}
