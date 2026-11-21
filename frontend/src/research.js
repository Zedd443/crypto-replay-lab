export const FIB_LEVELS=[0,0.236,0.382,0.5,0.618,0.705,0.786,1,1.272,1.618];

export function structureSnapshot(candles=[],pivot=2){
  // A pivot only exists after the candles to its right have closed.
  const confirmed=candles.filter(c=>c.complete);
  const highs=[],lows=[];
  for(let i=2*pivot;i<confirmed.length;i++){
    const candidate=confirmed[i-pivot];
    const around=confirmed.slice(i-2*pivot,i+1).filter(c=>c!==candidate);
    if(around.every(c=>candidate.high>c.high))highs.push(candidate);
    if(around.every(c=>candidate.low<c.low))lows.push(candidate);
  }
  const h=highs.slice(-2),l=lows.slice(-2);
  const hi=h.length===2?(h[1].high>h[0].high?'HH':'LH'):null;
  const lo=l.length===2?(l[1].low>l[0].low?'HL':'LL'):null;
  const regime=hi==='HH'&&lo==='HL'?'Bullish structure':
    hi==='LH'&&lo==='LL'?'Bearish structure':
    hi&&lo?'Mixed / range':'Insufficient pivots';
  return {high:hi,low:lo,regime,lastHigh:highs.at(-1)?.high,
    lastLow:lows.at(-1)?.low,highCount:highs.length,lowCount:lows.length,
    confirmedBars:confirmed.length};
}

export function evaluateTrades(orders=[]){
  const closed=orders.filter(o=>o.status==='closed'&&Number.isFinite(Number(o.pnl)));
  const realized=[...closed].sort((a,b)=>(a.exit_ms||0)-(b.exit_ms||0));
  let equity=0,peak=0,maxDrawdown=0;
  const points=realized.map(o=>{
    equity+=Number(o.pnl);peak=Math.max(peak,equity);
    maxDrawdown=Math.max(maxDrawdown,peak-equity);return equity;
  });
  const wins=closed.filter(o=>o.pnl>0),losses=closed.filter(o=>o.pnl<0);
  const sum=a=>a.reduce((v,x)=>v+Number(x.pnl),0);
  const grossProfit=sum(wins),grossLoss=-sum(losses);
  return {count:closed.length,wins:wins.length,losses:losses.length,
    breakeven:closed.length-wins.length-losses.length,
    winRate:closed.length?100*wins.length/closed.length:null,
    grossPnl:sum(closed),grossProfit,grossLoss,
    profitFactor:grossLoss>0?grossProfit/grossLoss:null,
    expectancy:closed.length?sum(closed)/closed.length:null,
    avgWin:wins.length?grossProfit/wins.length:null,
    avgLoss:losses.length?grossLoss/losses.length:null,
    maxDrawdown,equity:points,unrealized:orders.filter(o=>o.status==='open')
      .reduce((v,o)=>v+(Number.isFinite(o.pnl)?o.pnl:0),0),
    bySide:['long','short'].map(side=>{
      const group=closed.filter(o=>o.side===side);
      return {side,n:group.length,pnl:sum(group),wr:group.length?100*group.filter(o=>o.pnl>0).length/group.length:null};
    })};
}

function zoneReport(d,candles){
  const low=Math.min(d.price,d.end_price),high=Math.max(d.price,d.end_price);
  let touches=0,rejectAbove=0,rejectBelow=0,breakAbove=0,breakBelow=0,fakeout=0;
  let previous=null;
  let pendingBreak=null;
  for(let i=0;i<candles.length;i++){
    const c=candles[i];
    if(pendingBreak && i-pendingBreak.index<=3 &&
      c.close>=low&&c.close<=high){fakeout++;pendingBreak=null;}
    else if(pendingBreak && i-pendingBreak.index>3)pendingBreak=null;
    const touched=c.high>=low&&c.low<=high;
    if(touched){
      touches++;
      if(c.close>high)rejectAbove++;
      if(c.close<low)rejectBelow++;
    }
    if(previous!==null){
      if(previous<=high&&c.close>high){
        breakAbove++;pendingBreak={index:i,side:'up'};
      }
      if(previous>=low&&c.close<low){
        breakBelow++;pendingBreak={index:i,side:'down'};
      }
    }
    previous=c.close;
  }
  return {touches,rejectAbove,rejectBelow,breakAbove,breakBelow,fakeout,
    label:'Zone / S&R',detail:`${touches} touches · ${breakAbove} break ↑ · ${breakBelow} break ↓ · ${fakeout} fakeout (≤3 bars)`,
    status:touches?'Observed':'No touches yet',strength:null};
}
function planReport(d,candles){
  const entry=d.price,stop=d.end_price,tp=d.take_profit,long=d.kind==='long_position';
  let filled=false,hit=null,ambiguous=false;
  for(const c of candles){
    if(!filled){
      if(c.low>entry||c.high<entry)continue;
      filled=true;
      if((long?c.low<=stop:c.high>=stop)||(long?c.high>=tp:c.low<=tp)){
        ambiguous=true;hit='Entry and exit level touched in one candle';break;
      }
      continue;
    }
    const s=long?c.low<=stop:c.high>=stop;
    const t=long?c.high>=tp:c.low<=tp;
    if(s&&t){hit='Stop-first (ambiguous bar)';ambiguous=true;break;}
    if(s){hit='Stop level touched';break;}
    if(t){hit='Target level touched';break;}
  }
  const rr=Math.abs(entry-stop)>0?Math.abs(tp-entry)/Math.abs(entry-stop):null;
  return {label:long?'Long R:R plan':'Short R:R plan',
    detail:`R:R ${rr?.toFixed(2)||'—'} · ${hit||(!filled?'entry not touched':'levels not hit')}`,
    status:ambiguous?'Ambiguous OHLC':hit?'Observed':'Pending',rr,
    warning:'Planning probe only; not an executed trade or validated win'};
}
function fibReport(d,last){
  const levels=FIB_LEVELS.map(r=>({r,price:d.price+(d.end_price-d.price)*r}));
  const nearest=last?levels.reduce((a,b)=>Math.abs(last.close-a.price)<Math.abs(last.close-b.price)?a:b):null;
  return {label:'Fibonacci retracement',
    detail:nearest?`Nearest ${(nearest.r*100).toFixed(1)}% · ${nearest.price.toFixed(5)}`:'No candle',
    status:'Reference levels',levels};
}
function lineReport(d,candles){
  const price=d.price,limit=Math.max(price*.001,1e-8);
  const touch=candles.filter(c=>c.low-limit<=price&&c.high+limit>=price).length;
  return {label:d.kind==='horizontal'?'Horizontal level':'Line / structure',
    detail:`${touch} near-level interactions after drawing`,
    status:'Descriptive only'};
}
export function analyzeDrawings(drawings=[],candles=[]){
  const last=candles.at(-1);
  return drawings.map(d=>{
    // Exclude the creation candle and all historical candles already visible when drawn.
    const after=candles.filter(c=>c.time>d.created_at_ts);
    const analysis=d.kind==='rectangle'?zoneReport(d,after):
      ['long_position','short_position'].includes(d.kind)?planReport(d,after):
      d.kind==='fib'?fibReport(d,last):lineReport(d,after);
    return {id:d.id,color:d.color||'#f0c266',kind:d.kind,seen:after.length,
      created:d.created_at_ts,...analysis};
  });
}
