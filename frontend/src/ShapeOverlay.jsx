import React, {useEffect,useRef} from 'react';

export default function ShapeOverlay({chart,series,drawings,selected}){
  const root=useRef(null);
  useEffect(()=>{
    let frame;
    function update(){
      const api=chart.current;
      const pane=api?.panes()[0]?.getHTMLElement();
      if(pane&&root.current){
        const bounds=pane.getBoundingClientRect();
        const host=root.current.parentElement.getBoundingClientRect();
        const scale=api.timeScale();
        const width=scale.width();
        root.current.style.cssText='left:'+(bounds.left-host.left+api.priceScale('left').width())+
          'px;top:'+(bounds.top-host.top)+'px;width:'+width+'px;height:'+bounds.height+'px';
        drawings.forEach((drawing,i)=>{
          const element=root.current.children[i];
          const x=scale.timeToCoordinate(drawing.anchor_start/1000);
          const y=series.current.priceToCoordinate(drawing.price);
          const otherX=drawing.kind==='rectangle'?scale.timeToCoordinate(drawing.anchor_end/1000):null;
          const otherY=drawing.kind==='rectangle'?series.current.priceToCoordinate(drawing.end_price):null;
          const show=x!=null && (drawing.kind==='vertical'||y!=null) &&
            (drawing.kind!=='rectangle'||(otherX!=null&&otherY!=null));
          element.style.visibility=show?'visible':'hidden';
          if(!show)return;
          const left=otherX==null?x:Math.min(x,otherX);
          const top=drawing.kind==='vertical'?0:otherY==null?y:Math.min(y,otherY);
          element.style.transform='translate('+left+'px,'+top+'px)';
          element.style.width=(drawing.kind==='horizontal_ray'?Math.max(0,width-x):
            otherX==null?1:Math.max(1,Math.abs(x-otherX)))+'px';
          element.style.height=(drawing.kind==='vertical'?bounds.height:
            otherY==null?1:Math.max(1,Math.abs(y-otherY)))+'px';
        });
      }
      frame=requestAnimationFrame(update);
    }
    update();
    return ()=>cancelAnimationFrame(frame);
  },[chart,series,drawings]);
  return <div ref={root} className="chart-shape-overlay" aria-hidden="true">
    {drawings.map(d=><div key={d.id} className={'chart-shape chart-shape-'+d.kind+
      (selected===d.id?' selected':'')}/>)}
  </div>;
}
