import React, { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, CrosshairMode, createSeriesMarkers } from 'lightweight-charts';
import BracketOverlay from './BracketOverlay.jsx';
import DrawingTools, {DRAWING_TOOLS} from './DrawingTools.jsx';
import ShapeOverlay from './ShapeOverlay.jsx';
import {calculateIndicator, INDICATORS} from './indicators.js';

export default function ChartPanel({ candles, timeframe, sessionId, drawings, drawingMode, onNewLine, onUpdateDrawing, busy, onDrawingMode, onRemoveDrawing, fullscreen, onToggleFullscreen, paperPosition, onAdjustPosition, positionLocked, onTradeShortcut }) {
  const rootRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const drawingModeRef = useRef(drawingMode);
  const onNewLineRef = useRef(onNewLine);
  const chartLinesRef = useRef([]);
  const trendlinesRef = useRef([]);
  const indicatorSeries = useRef(new Map());
  const indicatorMarkers = useRef(null);
  const displayedRef = useRef({key:null,length:0,last:null});
  const [indicatorMenu,setIndicatorMenu] = React.useState(false);
  const [enabled,setEnabled] = React.useState([]);
  const activeIndicators=React.useMemo(()=>INDICATORS.filter(([id])=>enabled.includes(id))
    .map(([id,label,kind])=>({id,label,kind,...calculateIndicator(id,candles)})),[enabled,candles]);
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
    ['horizontal_ray','vertical','rectangle','long_position','short_position'].includes(d.kind)),[drawings,timeframe]);
  const showToolMenu=open=>{
    setToolMenu(open);
    if(open){setDrawingListOpen(false);setIndicatorMenu(false);}
  };
  const [selectedDrawing,setSelectedDrawing] = React.useState(null);
  const [draftShape,setDraftShape] = React.useState(null);
  busyRef.current = busy;
  const resetAnchor = () => {
    firstAnchor.current = null;
    setAwaitingEnd(false);
  };

  useEffect(() => {
    resetAnchor();
    setDraftShape(null);
  }, [drawingMode, timeframe, sessionId]);
  drawingModeRef.current = drawingMode;
  onNewLineRef.current = onNewLine;

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
      if(kind==='rectangle')return {id:'draft',kind,price:a.price,end_price:b.price,
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
      if(busyRef.current||event.button!==0||!['rectangle','long_position','short_position'].includes(kind))return;
      const anchor=point(event);
      if(!anchor)return;
      dragStart={anchor,x:event.clientX,y:event.clientY,kind};
      pane.setPointerCapture(event.pointerId);
      event.preventDefault();event.stopPropagation();
    };
    const onPointerMove=event=>{
      if(!dragStart)return;
      const p=point(event);
      setDraftShape(p?makeDraft(dragStart.anchor,p,dragStart.kind):null);
      event.preventDefault();event.stopPropagation();
    };
    const onPointerUp=event=>{
      if(!dragStart)return;
      const start=dragStart;
      const p=point(event);
      const drawing=p?makeDraft(start.anchor,p,start.kind):null;
      dragStart=null;setDraftShape(null);
      if(drawing&&Math.abs(event.clientX-start.x)>7&&Math.abs(event.clientY-start.y)>3){
        const {id,...payload}=drawing;
        onNewLineRef.current?.(payload);
      }
      try{pane.releasePointerCapture(event.pointerId);}catch{/* capture already lost */}
      event.preventDefault();event.stopPropagation();
    };
    const onClick=(event) => {
      if (busyRef.current || !drawingModeRef.current ||
          ['rectangle','long_position','short_position'].includes(drawingModeRef.current) || !pointerStart ||
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
      const [start,end] = [firstAnchor.current,anchor].sort((a,b)=>a.time-b.time);
      resetAnchor();
      onNewLineRef.current({kind,price:start.price,end_price:end.price,
        anchor_start:start.time,anchor_end:end.time});
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
      price:d.price, color:d.id===selectedDrawing?'#8BE1FF':'#F0C266',lineWidth:2,lineStyle:2,
      axisLabelVisible:true,title:'User S/R'
    }));
    const chart=chartRef.current;
    for (const line of trendlinesRef.current) chart.removeSeries(line);
    const times = new Set(candles.map(c=>c.time));
    trendlinesRef.current=drawings.filter(d=>d.kind==='trendline' && d.timeframe===timeframe &&
      times.has(d.anchor_start) && times.has(d.anchor_end)).map(d=>{
      const line=chart.addSeries(LineSeries,{color:d.id===selectedDrawing?'#8BE1FF':'#F0C266',lineWidth:2,
        priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false,
        autoscaleInfoProvider:()=>null});
      line.setData([{time:d.anchor_start/1000,value:d.price},{time:d.anchor_end/1000,value:d.end_price}]);
      return line;
    });
  }, [drawings,candles,timeframe,selectedDrawing]);

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
    const markers=activeIndicators.flatMap(item=>item.markers||[]).sort((a,b)=>a.time-b.time);
    indicatorMarkers.current?.setMarkers(markers);
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
      drawings={shapes} draft={draftShape} selected={selectedDrawing} onSelect={setSelectedDrawing}
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
        {INDICATORS.map(([id,label,kind])=><label key={id}>
          <input type="checkbox" checked={enabled.includes(id)} onChange={()=>toggleIndicator(id,kind)}/>
          {label}
        </label>)}
        <p>One lower-pane indicator at a time.</p>
      </section>}
      {awaitingEnd&&<span role="status">Pick second point</span>}
      {['rectangle','long_position','short_position'].includes(drawingMode)&&
        <span role="status">Drag on chart to create · drawings do not execute orders</span>}
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
