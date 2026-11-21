import React, {useEffect,useRef,useState} from 'react';

export const DRAWING_TOOLS=[
  {id:'trendline',label:'Trendline',icon:'\u2571',key:'T',group:'Lines'},
  {id:'horizontal',label:'Horizontal line',icon:'\u2501',key:'H',group:'Lines'},
  {id:'horizontal_ray',label:'Horizontal ray',icon:'\u2192',key:'J',group:'Lines'},
  {id:'vertical',label:'Vertical line',icon:'\u2503',key:'V',group:'Lines'},
  {id:'rectangle',label:'Rectangle',icon:'\u25ad',key:'R',group:'Shapes'},
  {id:'fib',label:'Fibonacci retracement',icon:'≡',key:'F',group:'Shapes'},
  {id:'ghost_feed',label:'Ghost Feed drawing',icon:'♧',key:'G',group:'Forecast'},
  {id:'long',label:'Long R:R drawing',icon:'L',key:'L',group:'Paper trading'},
  {id:'short',label:'Short R:R drawing',icon:'S',key:'S',group:'Paper trading'},
];
const storageKey='crl-drawing-favorites';
const initialFavorites=['trendline','rectangle','fib','ghost_feed','long','short'];

export default function DrawingTools({open,onOpen,mode,disabled,onSelect,onTrade}){
  const menu=useRef(null);
  const bar=useRef(null);
  const grab=useRef(null);
  const [offset,setOffset]=useState({x:0,y:0});
  const [favorites,setFavorites]=useState(()=>{
    try{
      const saved=JSON.parse(localStorage.getItem(storageKey));
      return Array.isArray(saved)?saved:initialFavorites;
    }catch{return initialFavorites;}
  });
  const choose=tool=>{
    if(disabled)return;
    const next=tool.id==='long'?'long_position':tool.id==='short'?'short_position':tool.id;
    onSelect(mode===next?null:next);
    onOpen(false);
  };
  const toggleFavorite=id=>{
    const next=favorites.includes(id)?favorites.filter(value=>value!==id):[...favorites,id];
    setFavorites(next);
    try{localStorage.setItem(storageKey,JSON.stringify(next));}catch{/* storage unavailable */}
  };
  useEffect(()=>{
    const keyboard=event=>{
      if(event.key==='Escape'){
        if(open)onOpen(false);
        else if(mode)onSelect(null);
        return;
      }
      if(!event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.repeat||
        event.target.closest?.('input,select,textarea,[contenteditable=true]')||disabled)return;
      const tool=DRAWING_TOOLS.find(item=>item.key===event.key.toUpperCase());
      if(tool){event.preventDefault();choose(tool);}
    };
    const outside=event=>{
      if(open&&!menu.current?.contains(event.target))onOpen(false);
    };
    document.addEventListener('keydown',keyboard);
    document.addEventListener('pointerdown',outside);
    return ()=>{
      document.removeEventListener('keydown',keyboard);
      document.removeEventListener('pointerdown',outside);
    };
  },[open,mode,disabled,onOpen,onSelect,onTrade]);

  const startDrag=event=>{
    if(event.button!==0)return;
    const area=bar.current.closest('.chart-frame').getBoundingClientRect();
    const bounds=bar.current.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    grab.current={x:event.clientX,y:event.clientY,offset,
      minX:area.left-bounds.left+6,maxX:area.right-bounds.right-6,
      minY:area.top-bounds.top+6,maxY:area.bottom-bounds.bottom-6};
  };
  const move=event=>{
    const state=grab.current;
    if(!state)return;
    const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
    setOffset({
      x:state.offset.x+clamp(event.clientX-state.x,state.minX,state.maxX),
      y:state.offset.y+clamp(event.clientY-state.y,state.minY,state.maxY),
    });
  };
  const active=DRAWING_TOOLS.find(tool=>tool.id===(mode==='long_position'?'long':mode==='short_position'?'short':mode));
  const pinned=DRAWING_TOOLS.filter(tool=>favorites.includes(tool.id));
  return <>
    <div className="drawing-picker" ref={menu}>
      <button type="button" aria-controls="drawing-tool-menu" aria-expanded={open}
        disabled={disabled&&!open} onClick={()=>onOpen(!open)}>
        {active?active.label:'Drawing tools'} <span aria-hidden="true">&#9662;</span>
      </button>
      {open&&<div id="drawing-tool-menu" className="drawing-tool-menu" aria-label="Drawing tool choices">
        {['Lines','Shapes','Forecast','Paper trading'].map(group=><section key={group} aria-label={group}>
          <h3>{group}</h3>
          {DRAWING_TOOLS.filter(tool=>tool.group===group).map(tool=><div className="drawing-tool-option" key={tool.id}>
            <button type="button" disabled={disabled} aria-pressed={mode===(tool.id==='long'?'long_position':tool.id==='short'?'short_position':tool.id)} onClick={()=>choose(tool)}>
              <span aria-hidden="true">{tool.icon}</span>{tool.label}<kbd>Alt+{tool.key}</kbd>
            </button>
            <button type="button" aria-label={'Favorite '+tool.label} aria-pressed={favorites.includes(tool.id)}
              title={'Favorite '+tool.label} onClick={()=>toggleFavorite(tool.id)}>
              {favorites.includes(tool.id)?'\u2605':'\u2606'}
            </button>
          </div>)}
        </section>)}
      </div>}
    </div>
    {pinned.length>0&&<div ref={bar} className="drawing-favorites" aria-label="Drawing shortcuts"
      style={{transform:'translate('+offset.x+'px,'+offset.y+'px)'}}>
      <button type="button" className="drawing-grip" aria-label="Move shortcuts" title="Drag to move shortcuts"
        onPointerDown={startDrag} onPointerMove={move} onPointerUp={()=>{grab.current=null;}}
        onPointerCancel={()=>{grab.current=null;}}>&#8942;</button>
      {pinned.map(tool=><button key={tool.id} type="button" aria-label={'Shortcut '+tool.label}
        title={tool.label+' (Alt+'+tool.key+')'} disabled={disabled}
        aria-pressed={mode===(tool.id==='long'?'long_position':tool.id==='short'?'short_position':tool.id)} className={'shortcut-'+tool.id} onClick={()=>choose(tool)}>{tool.icon}</button>)}
    </div>}
  </>;
}
