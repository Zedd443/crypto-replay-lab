import React, {useEffect, useRef, useState} from 'react';

export default function BracketOverlay({position, chart, series, candles, disabled, onAdjust}){
  const root=useRef(null);
  const drag=useRef(null);
  const [draft,setDraft]=useState(null);

  const firstTime=candles[0]?.time;
  const startTime=candles.findLast(c=>c.time<position.entry_ms)?.time;
  const endTime=candles.findLast(c=>c.time<(position.exit_ms??Infinity))?.time;
  useEffect(()=>{
    let frame;
    const paint=()=>{
      const pane=chart.current?.panes()[0]?.getHTMLElement();
      const host=root.current?.getBoundingClientRect();
      if(pane&&host){
        const bounds=pane.getBoundingClientRect();
        const scale=chart.current.timeScale();
        const left=chart.current.priceScale('left').width()+bounds.left-host.left;
        const width=scale.width();
        const clamp=value=>Math.max(0,Math.min(width,value));
        const entryX=startTime==null?0:scale.timeToCoordinate(startTime/1000);
        const endX=endTime==null?null:scale.timeToCoordinate(endTime/1000);
        const start=clamp(entryX??0);
        const end=clamp(position.status==='open'?Math.max((endX??0)+70,start+112):
          (endX??-10)+Math.max(4,scale.options().barSpacing/2));
        const positionVisible=firstTime!=null && (position.exit_ms==null||position.exit_ms>firstTime) && end>start;
        const entryY=series.current?.priceToCoordinate(position.entry_price);
        for(const line of root.current.children){
          const value=Number(line.dataset.price);
          const y=series.current?.priceToCoordinate(value);
          const zone=line.hasAttribute('data-zone');
          const visible=positionVisible&&y!=null&&entryY!=null&&(zone||y>=0&&y<=bounds.height);
          line.style.visibility=visible?'visible':'hidden';
          if(!visible)continue;
          const top=zone?Math.max(0,Math.min(y,entryY)):y;
          line.style.transform='translate('+(left+start)+'px,'+(bounds.top-host.top+top)+'px)';
          line.style.width=(end-start)+'px';
          if(zone)line.style.height=Math.max(0,Math.min(bounds.height,Math.max(y,entryY))-top)+'px';
        }
      }
      frame=requestAnimationFrame(paint);
    };
    paint();
    return ()=>cancelAnimationFrame(frame);
  },[chart,series,firstTime,startTime,endTime,position]);

  const pointerPrice=event=>{
    const pane=chart.current?.panes()[0]?.getHTMLElement();
    if(!pane)return null;
    const {top,height}=pane.getBoundingClientRect();
    const y=event.clientY-top;
    const value=series.current?.coordinateToPrice(Math.max(0,Math.min(height,y)));
    return Number.isFinite(value)&&value>0?Number(value.toPrecision(10)):null;
  };

  const start=(event,key)=>{
    if(disabled||event.button!==0)return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current={key,y:event.clientY};
  };
  const move=event=>{
    if(!drag.current || Math.abs(event.clientY-drag.current.y)<2 && !draft)return;
    const value=pointerPrice(event);
    if(value!==null)setDraft({key:drag.current.key,value});
  };
  const end=event=>{
    if(!drag.current)return;
    const {key,y}=drag.current;
    const value=pointerPrice(event);
    drag.current=null;
    setDraft(null);
    if(!disabled && value!==null && Math.abs(event.clientY-y)>=2)onAdjust(position.id,key,value);
  };

  const direction=position.side==='long'?1:-1;
  return <div ref={root} className="bracket-overlay" aria-label="Paper position price levels">
    <div className="bracket-zone bracket-reward" data-zone="" data-price={draft?.key==='take_profit'?draft.value:position.take_profit}/>
    <div className="bracket-zone bracket-risk" data-zone="" data-price={draft?.key==='stop_loss'?draft.value:position.stop_loss}/>
    {[['entry_price',position.side==='long'?'Long':'Short','entry'],['take_profit','TP','tp'],['stop_loss','SL','sl']].map(([key,label,tone])=>{
      const value=draft?.key===key?draft.value:position[key];
      const percent=100*direction*(value/position.entry_price-1);
      const number=value.toLocaleString(undefined,{maximumSignificantDigits:10});
      const detail=label+' '+number+(tone==='entry'?'':' ('+percent.toFixed(2)+'%)');
      return <div key={key} data-price={value} className={'bracket-level bracket-'+tone}>
        {tone==='entry'?<span>{detail}</span>:<button type="button" aria-label={'Drag '+label} disabled={disabled}
          onPointerDown={event=>start(event,key)} onPointerMove={move} onPointerUp={end}
          onPointerCancel={()=>{drag.current=null;setDraft(null);}}>{detail}</button>}
      </div>;
    })}
  </div>;
}
