import React, {useEffect,useRef,useState} from 'react';

const format=value=>value==null?'--':value.toLocaleString(undefined,{maximumFractionDigits:8});

export default function OrderPanel({orders, busy, session, activePosition, onSelect, onPlace, onManage, shortcut}){
  const longButton=useRef(null);
  const shortButton=useRef(null);
  useEffect(()=>{
    if(shortcut)(shortcut.side==='long'?longButton:shortButton).current?.focus({preventScroll:true});
  },[shortcut]);
  const [quantity,setQuantity]=useState('1');
  const [tp,setTp]=useState('2');
  const [sl,setSl]=useState('1');
  const size=Number(quantity);
  const frontier=session.cursor===session.max_seen_cursor;
  const hasNext=session.cursor+1<session.total;
  const ready=!busy && frontier && size>0 && size<=1e9 &&
    Number(tp)>0 && Number(tp)<100 && Number(sl)>0 && Number(sl)<100;
  return <section className="order-panel" aria-label="Simulated orders">
    <form onSubmit={event=>event.preventDefault()} className="order-entry">
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
      <span className="muted">{frontier?'Fills at replay price. Drag TP/SL on chart.':'Advance to the furthest cursor to trade.'}</span>
    </form>
    {orders.length>0&&<div className="orders-table"><table><thead><tr>
      <th>Side</th><th>Quantity</th><th>Status</th><th>Entry</th><th>Exit</th><th>P&amp;L (gross)</th><th>Action</th>
    </tr></thead><tbody>{orders.map(order=><tr key={order.id}>
      <td className={order.side==='long'?'ok':'warning'}>{order.side.toUpperCase()}</td>
      <td>{format(order.quantity)}</td><td>{order.exit_reason?order.exit_reason.toUpperCase():order.status}</td>
      <td>{format(order.entry_price)}</td>
      <td>{format(order.exit_price)}</td><td className={order.pnl<0?'warning':'ok'}>{format(order.pnl)}</td>
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
