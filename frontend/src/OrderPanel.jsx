import React,{useEffect,useRef,useState} from 'react';

const format=value=>value==null?'--':Number(value).toLocaleString(undefined,{maximumFractionDigits:8});
const numeric=(v)=>Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;

export default function OrderPanel({orders,busy,session,activePosition,onSelect,onPlace,onManage,
  shortcut,drawing,onUpdateDrawing,onExecuteDrawing,markPrice}){
  const longButton=useRef(null),shortButton=useRef(null);
  useEffect(()=>{
    if(shortcut)(shortcut.side==='long'?longButton:shortButton).current?.focus({preventScroll:true});
  },[shortcut]);
  const [quantity,setQuantity]=useState('1');
  const [tp,setTp]=useState('2'),[sl,setSl]=useState('1');
  const [levels,setLevels]=useState(null);
  useEffect(()=>setLevels(drawing?{
    entry:String(drawing.price),stop:String(drawing.end_price),target:String(drawing.take_profit)
  }:null),[drawing?.id,drawing?.price,drawing?.end_price,drawing?.take_profit]);
  const size=Number(quantity),frontier=session.cursor===session.max_seen_cursor;
  const hasNext=session.cursor+1<session.total;
  const ready=!busy&&frontier&&size>0&&size<=1e9&&
    Number(tp)>0&&Number(tp)<100&&Number(sl)>0&&Number(sl)<100;
  const isLong=drawing?.kind==='long_position';
  const entry=numeric(levels?.entry),stop=numeric(levels?.stop),target=numeric(levels?.target);
  const valid=!!drawing&&entry!=null&&stop!=null&&target!=null&&
    (isLong?stop<entry&&entry<target:target<entry&&entry<stop);
  const risk=valid?Math.abs(entry-stop)*size:null;
  const profit=valid?Math.abs(target-entry)*size:null;
  const rr=valid?profit/risk:null;
  const marketAligned=valid&&Number.isFinite(markPrice)&&Math.abs(entry/markPrice-1)<=.001;
  const snapPossible=valid&&Number.isFinite(markPrice)&&markPrice>0&&
    (stop+markPrice-entry)>0&&(target+markPrice-entry)>0;
  const snapToMarket=()=>{
    if(!snapPossible||busy||!frontier)return;
    const delta=markPrice-entry;
    onUpdateDrawing(drawing.id,{
      price:markPrice,end_price:stop+delta,take_profit:target+delta,
      anchor_start:drawing.anchor_start,anchor_end:drawing.anchor_end
    });
  };
  const updateLevel=(key,value)=>{
    if(!drawing||!valid)return;
    const next={...levels,[key]:value};
    const price=Number(next.entry),end_price=Number(next.stop),take_profit=Number(next.target);
    const ok=[price,end_price,take_profit].every(x=>Number.isFinite(x)&&x>0)&&
      (isLong?end_price<price&&price<take_profit:take_profit<price&&price<end_price);
    if(ok)onUpdateDrawing(drawing.id,{price,end_price,take_profit,
      anchor_start:drawing.anchor_start,anchor_end:drawing.anchor_end});
  };
  return <section className="order-panel" aria-label="Simulated orders">
    {drawing?<form className="order-entry plan-order" onSubmit={e=>e.preventDefault()}>
      <strong>{isLong?'LONG':'SHORT'} · Selected chart plan</strong>
      <span className="muted">Drag levels on chart, or edit prices here and press Enter/blur.</span>
      <label>Quantity <input type="number" min=".00000001" max="1000000000" step="any"
        value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
      {[
        ['entry','Entry'],['stop','Stop loss'],['target','Take profit']
      ].map(([key,label])=><label key={key}>{label}
        <input type="number" step="any" min="0" value={levels?.[key]||''}
          onChange={e=>setLevels(old=>({...old,[key]:e.target.value}))}
          onBlur={e=>updateLevel(key,e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}}}/>
      </label>)}
      <div className="plan-stats">
        <div>Risk <strong>{risk==null?'—':format(risk)}</strong></div>
        <div>Potential profit <strong>{profit==null?'—':format(profit)}</strong></div>
        <div>R:R <strong>{rr==null?'—':format(rr)}</strong></div>
        <div>Notional at entry <strong>{entry==null?'—':format(entry*size)}</strong></div>
        <div>Current mark <strong>{format(markPrice)}</strong></div>
      </div>
      {!marketAligned&&<div className="snap-plan">
        <span className="plan-warning">Entry differs from current replay close.
          Snap shifts Entry/SL/TP together and preserves your risk/reward distances.</span>
        <button type="button" disabled={!snapPossible||busy||!frontier}
          onClick={snapToMarket}>Snap Entry to Market ({format(markPrice)})</button>
      </div>}
      <button type="button" className={isLong?'long-order':'short-order'}
        disabled={!ready||!marketAligned} onClick={()=>onExecuteDrawing(drawing.id,size)}>
        Execute Paper {isLong?'Long':'Short'}
      </button>
      <span className="muted">Drawings never automatically open orders. Execution uses current replay market close.</span>
    </form>:<form onSubmit={event=>event.preventDefault()} className="order-entry">
      <strong>Paper market order</strong>
      <label>Quantity <input type="number" min="0" max="1000000000" step="any"
        value={quantity} onChange={event=>setQuantity(event.target.value)} /></label>
      <label>TP % <input type="number" min="0" max="100" step="any" value={tp}
        onChange={event=>setTp(event.target.value)}/></label>
      <label>SL % <input type="number" min="0" max="100" step="any" value={sl}
        onChange={event=>setSl(event.target.value)}/></label>
      <button type="button" className="long-order" ref={longButton} disabled={!ready}
        onClick={()=>onPlace('long',size,Number(tp),Number(sl))}>Long</button>
      <button type="button" className="short-order" ref={shortButton} disabled={!ready}
        onClick={()=>onPlace('short',size,Number(tp),Number(sl))}>Short</button>
      <span className="muted">{frontier?'Fills at replay price. Drag TP/SL on chart.':'Advance to furthest cursor to trade.'}</span>
    </form>}
    {orders.length>0&&<div className="orders-table"><table><thead><tr>
      <th>Side</th><th>Qty</th><th>Status</th><th>Entry</th><th>Exit</th><th>Gross P&amp;L</th><th>Action</th>
    </tr></thead><tbody>{orders.map(order=><tr key={order.id} className={order.drawing_id===drawing?.id?'linked-order':''}>
      <td className={order.side==='long'?'ok':'warning'}>{order.side.toUpperCase()}</td>
      <td>{format(order.quantity)}</td>
      <td>{order.exit_reason?order.exit_reason.toUpperCase():order.status}</td>
      <td>{format(order.entry_price)}</td>
      <td>{format(order.exit_price)}</td>
      <td className={order.pnl<0?'warning':'ok'}>{format(order.pnl)}</td>
      <td>{order.status==='pending'&&<button disabled={busy||!frontier}
        onClick={()=>onManage(order.id,'cancel')}>Cancel</button>}
        {order.mode==='bracket'&&<>
          <button aria-pressed={activePosition===order.id} onClick={()=>onSelect(order.id)}>Show TP/SL</button>{' '}
          {order.status==='open'&&<button disabled={busy||!frontier}
            onClick={()=>onManage(order.id,'close-now')}>Close now</button>}
        </>}
        {order.status==='open'&&order.mode!=='bracket'&&<button disabled={busy||!hasNext}
          onClick={()=>onManage(order.id,'close')}>Close next open</button>}</td>
    </tr>)}</tbody></table></div>}
  </section>;
}
