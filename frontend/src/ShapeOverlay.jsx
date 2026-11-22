import React, {useEffect,useRef,useState} from 'react';
import {FIB_LEVELS} from './research.js';
import {TF_MILLISECONDS} from './ghostScenario.js';

const isPosition = kind => kind === 'long_position' || kind === 'short_position';
const editable = kind => ['rectangle','fib','trendline','ghost_feed'].includes(kind) || isPosition(kind);

/** DOM overlay for editable, price/time anchored drawings. No orders are placed by drawings. */
export default function ShapeOverlay({chart,series,drawings,selected,onSelect,onEdit,draft,disabled,orders=[]}){
  const root=useRef(null);
  const drag=useRef(null);
  const [preview,setPreview]=useState(null);
  const items=drawings.map(d=>preview?.id===d.id?preview:d).concat(draft?[draft]:[]);

  useEffect(()=>{
    let frame;
    function update(){
      const api=chart.current, s=series.current, host=root.current;
      const pane=api?.panes()[0]?.getHTMLElement();
      if(pane&&host&&s){
        const bounds=pane.getBoundingClientRect();
        const parent=host.parentElement.getBoundingClientRect();
        const scale=api.timeScale();
        host.style.left=(bounds.left-parent.left+api.priceScale('left').width())+'px';
        host.style.top=(bounds.top-parent.top)+'px';
        host.style.width=scale.width()+'px';
        host.style.height=bounds.height+'px';
        for(let i=0;i<items.length;i++){
          const d=items[i],el=host.children[i];
          if(!el)continue;
          const x1=d.anchor_start!=null?scale.timeToCoordinate(d.anchor_start/1000):null;
          const x2=d.anchor_end!=null?scale.timeToCoordinate(d.anchor_end/1000):null;
          const y1=s.priceToCoordinate(d.price);
          const y2=d.end_price!=null?s.priceToCoordinate(d.end_price):null;
          const tp=isPosition(d.kind)?s.priceToCoordinate(d.take_profit):null;
          const good=(d.kind==='horizontal'||x1!=null) && (d.kind==='vertical'||y1!=null) &&
            (!['rectangle','fib','trendline','ghost_feed','long_position','short_position'].includes(d.kind)||(x2!=null&&y2!=null)) &&
            (!isPosition(d.kind)||tp!=null);
          el.style.visibility=good?'visible':'hidden';
          if(!good)continue;
          const left=d.kind==='horizontal'?0:x2==null?x1:Math.min(x1,x2);
          const right=d.kind==='horizontal'?scale.width():x2==null?x1:Math.max(x1,x2);
          const top=d.kind==='vertical'?0:isPosition(d.kind)?Math.min(y1,y2,tp):Math.min(y1,y2??y1);
          const bottom=d.kind==='vertical'?bounds.height:isPosition(d.kind)?Math.max(y1,y2,tp):Math.max(y1,y2??y1);
          el.style.transform='translate('+left+'px,'+top+'px)';
          el.style.width=(d.kind==='horizontal_ray'?Math.max(0,scale.width()-x1):Math.max(1,right-left))+'px';
          el.style.height=Math.max(1,bottom-top)+'px';
          if(d.kind==='trendline'){
            const line=el.querySelector('.trendline-segment');
            if(line){
              const ax=x1-left,ay=y1-top,bx=x2-left,by=y2-top;
              line.style.width=Math.hypot(bx-ax,by-ay)+'px';
              line.style.transform='translate('+ax+'px,'+ay+'px) rotate('+Math.atan2(by-ay,bx-ax)+'rad)';
            }
          }
          if(d.kind==='ghost_feed'){
            const bars=el.querySelectorAll('[data-ghost-bar]');
            const range=(d.ghost_range??.35)/100*Math.abs(d.price);
            const variance=(d.ghost_variance??.2)/100*Math.abs(d.price);
            let previous=d.price;
            bars.forEach((node,j)=>{
              const n=bars.length,ratio=(j+1)/n;
              const target=d.price+(d.end_price-d.price)*ratio;
              const offset=j===n-1?0:Math.sin((j+1)*2.41)*variance;
              const close=Math.max(.000000001,target+offset);
              const open=previous;previous=close;
              const wick=Math.max(range*.3,Math.abs(close-open)*.15);
              const high=Math.max(open,close)+wick,low=Math.max(.000000001,Math.min(open,close)-wick);
              const hi=s.priceToCoordinate(high),lo=s.priceToCoordinate(low);
              const op=s.priceToCoordinate(open),cl=s.priceToCoordinate(close);
              if([hi,lo,op,cl].every(Number.isFinite)){
                const candleX=x1+(x2-x1)*(j+.5)/n-left;
                node.style.left=candleX+'px';
                node.style.top=(Math.min(hi,lo)-top)+'px';
                node.style.height=Math.max(2,Math.abs(hi-lo))+'px';
                const body=node.firstElementChild;
                body.style.top=(Math.min(op,cl)-Math.min(hi,lo))+'px';
                body.style.height=Math.max(2,Math.abs(op-cl))+'px';
                body.dataset.direction=close>=open?'up':'down';
              }
            });
          }
          if(d.kind==='fib'){
            for(const level of el.querySelectorAll('[data-fib-ratio]')){
              const ratio=Number(level.dataset.fibRatio);
              const fy=s.priceToCoordinate(d.price+(d.end_price-d.price)*ratio);
              if(fy!=null)level.style.top=(fy-top)+'px';
            }
          }
          if(isPosition(d.kind)){
            const hit=el.querySelector('[data-position-hit]');
            if(hit){
              const result=orders.find(o=>o.drawing_id===d.id&&o.status==='closed');
              const y=result?.exit_reason==='tp'?tp:result?.exit_reason==='sl'?y2:y1;
              hit.style.visibility=result?'visible':'hidden';
              hit.style.top=(y-top)+'px';
            }
            const reward=el.querySelector('[data-zone="reward"]'),risk=el.querySelector('[data-zone="risk"]');
            if(reward){reward.style.top=(Math.min(y1,tp)-top)+'px';reward.style.height=Math.abs(y1-tp)+'px';}
            if(risk){risk.style.top=(Math.min(y1,y2)-top)+'px';risk.style.height=Math.abs(y1-y2)+'px';}
            for(const [part,y] of [['entry',y1],['stop',y2],['target',tp]]){
              const marker=el.querySelector('[data-handle="'+part+'"]');
              if(marker)marker.style.top=(y-top)+'px';
            }
          }
        }
      }
      frame=requestAnimationFrame(update);
    }
    update();
    return()=>cancelAnimationFrame(frame);
  },[chart,series,items]);

  const transform=(event)=>{
    const api=chart.current,s=series.current,pane=api?.panes()[0]?.getHTMLElement();
    if(!pane||!s)return null;
    const bounds=pane.getBoundingClientRect(),scale=api.timeScale();
    const dx=event.clientX-drag.current.x,dy=event.clientY-drag.current.y;
    const d=drag.current.origin;
    const x1=scale.timeToCoordinate(d.anchor_start/1000);
    const x2=scale.timeToCoordinate(d.anchor_end/1000);
    const y1=s.priceToCoordinate(d.price);
    const y2=s.priceToCoordinate(d.end_price);
    const yt=isPosition(d.kind)?s.priceToCoordinate(d.take_profit):null;
    if([x1,x2,y1,y2].some(v=>v==null))return null;
    const time=x=>{const t=scale.coordinateToTime(Math.max(0,Math.min(scale.width()-1,x)));return typeof t==='number'?t*1000:null;};
    const price=y=>{const p=s.coordinateToPrice(Math.max(0,Math.min(bounds.height-1,y)));return Number.isFinite(p)&&p>0?Number(p.toPrecision(12)):null;};
    const part=drag.current.part, next={...d};
    if(part==='move'){
      next.anchor_start=time(x1+dx);next.anchor_end=time(x2+dx);
      next.price=price(y1+dy);next.end_price=price(y2+dy);
      if(isPosition(d.kind))next.take_profit=price(yt+dy);
    }else if(part==='start'){
      next.anchor_start=time(x1+dx);next.price=price(y1+dy);
    }else if(part==='end'){
      next.anchor_end=time(x2+dx);next.end_price=price(y2+dy);
    }else if(part==='entry')next.price=price(y1+dy);
    else if(part==='stop')next.end_price=price(y2+dy);
    else if(part==='target')next.take_profit=price(yt+dy);
    if(next.anchor_start==null||next.anchor_end==null||next.anchor_start>=next.anchor_end||
      next.price==null||next.end_price==null)return null;
    if(isPosition(d.kind)&&!(d.kind==='long_position'?
      0<next.end_price&&next.end_price<next.price&&next.price<next.take_profit:
      0<next.take_profit&&next.take_profit<next.price&&next.price<next.end_price))return null;
    return next;
  };
  const down=event=>{
    const el=event.target.closest('[data-drawing-id]');
    const d=drawings.find(item=>item.id===el?.dataset.drawingId);
    if(!d||disabled||event.button!==0||!editable(d.kind))return;
    event.preventDefault();event.stopPropagation();
    onSelect?.(d.id);
    el.setPointerCapture(event.pointerId);
    drag.current={origin:d,part:event.target.closest('[data-handle]')?.dataset.handle||'move',
      x:event.clientX,y:event.clientY,latest:null};
  };
  const move=event=>{
    if(!drag.current)return;
    event.preventDefault();event.stopPropagation();
    const next=transform(event);
    if(next){drag.current.latest=next;setPreview(next);}
  };
  const up=event=>{
    if(!drag.current)return;
    event.preventDefault();event.stopPropagation();
    const next=drag.current.latest;
    drag.current=null;setPreview(null);
    if(next)onEdit?.(next.id,{price:next.price,end_price:next.end_price,
      anchor_start:next.anchor_start,anchor_end:next.anchor_end,
      ...(isPosition(next.kind)?{take_profit:next.take_profit}:{})});
  };
  return <div ref={root} className="chart-shape-overlay" onPointerDown={down}
    onPointerMove={move} onPointerUp={up}
    onPointerCancel={()=>{drag.current=null;setPreview(null);}}>
    {items.map(d=>{
      const edit=editable(d.kind)&&d.id!=='draft';
      const direction=isPosition(d.kind);
      const risk=Math.abs(d.price-d.end_price),reward=isPosition(d.kind)?Math.abs(d.take_profit-d.price):0;
      return <div key={d.id} data-drawing-id={d.id}
        style={{'--drawing-color':d.color||'#f0c266'}}
        className={'chart-shape chart-shape-'+d.kind+(selected===d.id?' selected':'')+
          (d.id==='draft'?' draft':'')+(edit?' editable':'')} title={edit?'Drag to move; drag handles to edit':''}>
        {direction&&<>
          {orders.filter(o=>o.drawing_id===d.id&&o.status==='closed').slice(-1).map(o=>
            <span key={o.id} className={'plan-hit-dot '+(o.exit_reason==='tp'?'hit-tp':
                o.exit_reason==='sl'?'hit-sl':'hit-manual')}
              data-position-hit="" title={(o.exit_reason||'exit').toUpperCase()+
                ' at '+o.exit_price+' · Gross PnL '+o.pnl}/>)}
          <div className="plan-reward" data-zone="reward"/>
          <div className="plan-risk" data-zone="risk"/>
          {['entry','stop','target'].map(part=><div key={part}
            className={'plan-level plan-'+part} data-handle={part}>{part==='entry'?
              (d.kind==='long_position'?'LONG':'SHORT')+' PLAN · R:R '+(risk?reward/risk:0).toFixed(2):
              part==='stop'?'SL':'TP'}</div>)}
        </>}
        {d.kind==='trendline'&&<span className="trendline-segment" data-handle="move"/>}
        {d.kind==='horizontal'&&<span className="horizontal-line-hit" title="Horizontal support/resistance level"/>}
        {d.kind==='horizontal_ray'&&<span className="horizontal-ray-hit" title="Horizontal ray"/>}
        {d.kind==='ghost_feed'&&<>
          <span className="ghost-feed-select" title="Select, drag, or press Delete to remove Ghost Feed">GHOST FEED</span>
          <div className="ghost-feed-candles" aria-label="Hypothetical Ghost Feed candles">
          {Array.from({length:Math.max(2,Math.min(40,Math.round(
            (d.anchor_end-d.anchor_start)/(TF_MILLISECONDS[d.timeframe]||3600000)
          )))},(_,i)=><span key={i} data-ghost-bar="" className="ghost-feed-bar">
            <span className="ghost-feed-body"/></span>)}
          </div>
        </>}
        {d.kind==='fib'&&FIB_LEVELS.map(r=><span key={r} className="fib-level"
          data-fib-ratio={r}>{(r*100).toFixed(1)}%</span>)}
        {edit&&!direction&&<>
          <span className={'shape-handle start '+(d.price>=d.end_price?'top':'bottom')} data-handle="start"/>
          <span className={'shape-handle end '+(d.price>=d.end_price?'bottom':'top')} data-handle="end"/>
        </>}
      </div>;
    })}
  </div>;
}
