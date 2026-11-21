// All calculations read the visible prefix at or before the plotted candle.
export const INDICATORS = [
  ['sma','SMA 20','overlay'], ['ema','EMA 50','overlay'],
  ['bands','Bollinger Bands 20 / 2','overlay'], ['donchian','Donchian 20','overlay'],
  ['vwma','VWMA 20','overlay'], ['rsi','RSI 14','pane'], ['atr','ATR 14','pane'],
  ['macd','MACD 12 / 26 / 9','pane'], ['adx','ADX 14','pane'],
  ['obv','On-Balance Volume','pane'], ['stochastic','Stochastic 14 / 3','pane'],
  ['bos','Structure break (confirmed)','marker'], ['fvg','Three-candle FVG','marker'],
  ['sweep','Pivot liquidity sweep','marker'], ['displacement','ATR displacement','marker'],
  ['confluence','Sweep + displacement + FVG (proxy)','marker'],
];

export const INDICATOR_SETTINGS={
  sma:[['length','Period',20,2,400]],ema:[['length','Period',50,2,400]],
  bands:[['length','Period',20,2,400],['deviation','Standard deviation',2,0.2,6]],
  donchian:[['length','Period',20,2,400]],vwma:[['length','Period',20,2,400]],
  rsi:[['length','Period',14,2,100]],atr:[['length','Period',14,2,100]],
  macd:[['fast','Fast EMA',12,2,100],['slow','Slow EMA',26,3,200],['signal','Signal',9,2,100]],
  adx:[['length','Period',14,2,100]],
  stochastic:[['length','Lookback',14,2,100],['smooth','Signal smoothing',3,2,40]],
  bos:[['pivot','Pivot right/left bars',2,1,12]],
  fvg:[['minGap','Minimum gap (percent)',0,0,10]],
  sweep:[['pivot','Pivot confirmation bars',2,1,12]],
  displacement:[['length','ATR period',14,2,100],['threshold','Body / ATR threshold',1.2,0.2,8]],
  confluence:[['pivot','Pivot confirmation bars',2,1,12],['length','ATR period',14,2,100],
    ['threshold','Displacement / ATR',1.2,0.2,8],['window','Window (bars)',8,1,80]],
};
export const DEFAULT_INDICATOR_OPTIONS=Object.fromEntries(Object.entries(INDICATOR_SETTINGS).map(
  ([id,defs])=>[id,Object.fromEntries(defs.map(([key,,value])=>[key,value]))]));
const mean = values => values.reduce((total,value)=>total+value,0)/values.length;
const rolling = (values,length,calculate) => values.map((_,i)=>{
  if(i+1<length)return null;
  const window=values.slice(i+1-length,i+1);
  return window.every(Number.isFinite)?calculate(window,i):null;
});

function smooth(values, length, alpha) {
  let previous = null;
  const seed = [];
  return values.map(value=>{
    if(!Number.isFinite(value))return null;
    if(previous===null){
      seed.push(value);
      if(seed.length<length)return null;
      previous=mean(seed);
    }else{
      previous+=alpha*(value-previous);
    }
    return previous;
  });
}

const ema = (values,length) => smooth(values,length,2/(length+1));
const wilder = (values,length) => smooth(values,length,1/length);

function range(candles){
  return candles.map((c,i)=>i===0?null:Math.max(c.high-c.low,
    Math.abs(c.high-candles[i-1].close),Math.abs(c.low-candles[i-1].close)));
}

function marker(c,bull,text){
  return {time:c.time/1000,position:bull?'belowBar':'aboveBar',
    shape:bull?'arrowUp':'arrowDown',color:bull?'#4fd3ac':'#f59186',text};
}

function structure(candles,pivotLength=2){
  let high=null,low=null;
  const markers=[];
  for(let i=2*pivotLength;i<candles.length;i++){
    const current=candles[i];
    if(!current.complete)continue;
    const pivot=candles[i-pivotLength];
    const neighbors=candles.slice(i-2*pivotLength,i+1).filter(c=>c!==pivot);
    if(!neighbors.every(c=>c.complete))continue;
    if(neighbors.every(c=>pivot.high>c.high))high=pivot.high;
    if(neighbors.every(c=>pivot.low<c.low))low=pivot.low;
    if(high!==null && current.close>high){
      markers.push(marker(current,true,'BOS'));high=null;
    }else if(low!==null && current.close<low){
      markers.push(marker(current,false,'BOS'));low=null;
    }
  }
  return markers;
}

function gaps(candles,minGap=0){
  const markers=[];
  for(let i=2;i<candles.length;i++){
    const current=candles[i], first=candles[i-2];
    if(!current.complete)continue;
    if(current.low>first.high*(1+minGap/100))markers.push(marker(current,true,'FVG'));
    if(current.high<first.low*(1-minGap/100))markers.push(marker(current,false,'FVG'));
  }
  return markers;
}

function pivotSweeps(candles,left=2){
  const marks=[];let high=null,low=null;
  for(let i=2*left;i<candles.length;i++){
    const c=candles[i],pivot=candles[i-left];
    if(!c.complete)continue;
    const neighbors=candles.slice(i-2*left,i+1).filter(x=>x!==pivot);
    if(!neighbors.every(x=>x.complete))continue;
    if(neighbors.every(x=>pivot.high>x.high))high=pivot.high;
    if(neighbors.every(x=>pivot.low<x.low))low=pivot.low;
    // Wicks cross confirmed historical pivots, close returns inside.
    if(high!=null&&c.high>high&&c.close<high){
      marks.push(marker(c,false,'Sweep H'));high=null;
    }
    if(low!=null&&c.low<low&&c.close>low){
      marks.push(marker(c,true,'Sweep L'));low=null;
    }
  }
  return marks;
}
function displacements(candles,length=14,threshold=1.2){
  const tr=wilder(range(candles),length);const marks=[];
  candles.forEach((c,i)=>{
    if(!c.complete||!Number.isFinite(tr[i])||tr[i]<=0)return;
    if(Math.abs(c.close-c.open)/tr[i]>=threshold){
      marks.push(marker(c,c.close>c.open,'Disp'));
    }
  });
  return marks;
}
export function calculateIndicator(id,candles,options={}){
  const defaults=DEFAULT_INDICATOR_OPTIONS[id]||{};
  const p={...defaults,...options};
  for(const def of INDICATOR_SETTINGS[id]||[]){
    const [key,,base,min,max]=def, val=Number(p[key]);
    p[key]=Number.isFinite(val)?Math.min(max,Math.max(min,val)):base;
    if(!['deviation','minGap','threshold'].includes(key))p[key]=Math.round(p[key]);
  }
  if(id==='bos')return {markers:structure(candles,p.pivot)};
  if(id==='fvg')return {markers:gaps(candles,p.minGap)};
  if(id==='sweep')return {markers:pivotSweeps(candles,p.pivot)};
  if(id==='displacement')return {markers:displacements(candles,p.length,p.threshold)};
  if(id==='confluence'){
    const sweeps=pivotSweeps(candles,p.pivot),disp=displacements(candles,p.length,p.threshold);
    const fvg=gaps(candles);
    return {markers:disp.filter(d=>sweeps.some(s=>s.position===d.position &&
      d.time-s.time>0 && d.time-s.time<=p.window*(candles[1]?.time-candles[0]?.time)/1000) &&
      fvg.some(f=>f.time===d.time&&f.position===d.position))
      .map(d=>({...d,text:'Sweep+Disp+FVG'}))};
  }

  const close=candles.map(c=>c.close);
  const changes=()=>close.map((value,i)=>i===0?null:value-close[i-1]);
  const limits=()=>rolling(candles.map(c=>c.high),p.length,(highs,i)=>[
    Math.max(...highs),Math.min(...candles.slice(i+1-p.length,i+1).map(c=>c.low)),
  ]);
  const series=(label,values,color='#7cbbff',kind='line')=>({label,color,kind,points:values.flatMap((value,i)=>
    Number.isFinite(value)?[{time:candles[i].time/1000,value}]:[])});
  switch(id){
    case 'sma':return {series:[series('SMA '+p.length,rolling(close,p.length,mean))]};
    case 'ema':return {series:[series('EMA '+p.length,ema(close,p.length),'#f5ba67')]};
    case 'bands':{
      const average=rolling(close,p.length,mean);
      const deviation=rolling(close,p.length,(values,i)=>Math.sqrt(mean(values.map(x=>(x-average[i])**2))));
      return {series:[series('BB upper',average.map((v,i)=>v===null?null:v+p.deviation*deviation[i]),'#9a9bf5'),
        series('BB basis',average,'#7577bd'),
        series('BB lower',average.map((v,i)=>v===null?null:v-p.deviation*deviation[i]),'#9a9bf5')]};
    }
    case 'donchian':{
      const bounds=limits();
      return {series:[series('Donchian high',bounds.map(v=>v?.[0]),'#74c7b6'),
        series('Donchian low',bounds.map(v=>v?.[1]),'#74c7b6')]};
    }
    case 'vwma':return {series:[series('VWMA '+p.length,rolling(close,p.length,(values,i)=>{
      const volumes=candles.slice(i-19,i+1).map(c=>c.volume);
      const volume=mean(volumes);
      return volume?mean(values.map((value,j)=>value*volumes[j]))/volume:null;
    }),'#e3a4eb')]};
    case 'rsi':{
      const delta=changes();
      const gain=wilder(delta.map(v=>v===null?null:Math.max(v,0)),p.length);
      const loss=wilder(delta.map(v=>v===null?null:Math.max(-v,0)),p.length);
      return {series:[series('RSI '+p.length,gain.map((g,i)=>g===null?null:
        loss[i]===0?(g===0?50:100):100-100/(1+g/loss[i])))]};
    }
    case 'atr':return {series:[series('ATR '+p.length,wilder(range(candles),p.length))]};
    case 'macd':{
      const fast=ema(close,p.fast),slow=ema(close,p.slow);
      const macd=slow.map((v,i)=>v===null?null:fast[i]-v);
      const signal=ema(macd,p.signal);
      return {series:[series('MACD',macd),series('Signal',signal,'#f5ba67'),
        series('Histogram',signal.map((v,i)=>v===null?null:macd[i]-v),'#508988','histogram')]};
    }
    case 'adx':{
      const tr=wilder(range(candles),p.length);
      const movement=candles.map((c,i)=>{
        if(i===0)return [null,null];
        const up=c.high-candles[i-1].high,down=candles[i-1].low-c.low;
        return [up>Math.max(0,down)?up:0,down>Math.max(0,up)?down:0];
      });
      const plus=wilder(movement.map(v=>v[0]),p.length);
      const minus=wilder(movement.map(v=>v[1]),p.length);
      const positive=tr.map((value,i)=>value===null?null:value?100*plus[i]/value:0);
      const negative=tr.map((value,i)=>value===null?null:value?100*minus[i]/value:0);
      const dx=positive.map((value,i)=>value===null?null:value+negative[i]?
        100*Math.abs(value-negative[i])/(value+negative[i]):0);
      return {series:[series('ADX',wilder(dx,p.length)),series('+DI',positive,'#4fd3ac'),series('-DI',negative,'#f59186')]};
    }
    case 'obv':{
      let total=0;
      return {series:[series('OBV',changes().map((change,i)=>{
        if(change!==null)total+=Math.sign(change)*candles[i].volume;
        return total;
      }))]};
    }
    case 'stochastic':{
      const k=rolling(close,p.length,(values,i)=>{
        const window=candles.slice(i+1-p.length,i+1);
        const high=Math.max(...window.map(c=>c.high)),low=Math.min(...window.map(c=>c.low));
        return high===low?50:100*(values.at(-1)-low)/(high-low);
      });
      return {series:[series('%K',k),series('%D',rolling(k,p.smooth,mean),'#f5ba67')]};
    }
    default:return {series:[]};
  }
}
