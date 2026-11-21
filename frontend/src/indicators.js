// All calculations read the visible prefix at or before the plotted candle.
export const INDICATORS = [
  ['sma','SMA 20','overlay'], ['ema','EMA 50','overlay'],
  ['bands','Bollinger Bands 20 / 2','overlay'], ['donchian','Donchian 20','overlay'],
  ['vwma','VWMA 20','overlay'], ['rsi','RSI 14','pane'], ['atr','ATR 14','pane'],
  ['macd','MACD 12 / 26 / 9','pane'], ['adx','ADX 14','pane'],
  ['obv','On-Balance Volume','pane'], ['stochastic','Stochastic 14 / 3','pane'],
  ['bos','SMC Break of Structure','marker'], ['fvg','ICT Fair Value Gap','marker'],
];

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

function structure(candles){
  let high=null,low=null;
  const markers=[];
  for(let i=4;i<candles.length;i++){
    const current=candles[i];
    if(!current.complete)continue;
    const pivot=candles[i-2];
    const neighbors=[candles[i-4],candles[i-3],candles[i-1],current];
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

function gaps(candles){
  const markers=[];
  for(let i=2;i<candles.length;i++){
    const current=candles[i], first=candles[i-2];
    if(!current.complete)continue;
    if(current.low>first.high)markers.push(marker(current,true,'FVG'));
    if(current.high<first.low)markers.push(marker(current,false,'FVG'));
  }
  return markers;
}

export function calculateIndicator(id,candles){
  if(id==='bos')return {markers:structure(candles)};
  if(id==='fvg')return {markers:gaps(candles)};

  const close=candles.map(c=>c.close);
  const changes=()=>close.map((value,i)=>i===0?null:value-close[i-1]);
  const limits=()=>rolling(candles.map(c=>c.high),20,(highs,i)=>[
    Math.max(...highs),Math.min(...candles.slice(i-19,i+1).map(c=>c.low)),
  ]);
  const series=(label,values,color='#7cbbff',kind='line')=>({label,color,kind,points:values.flatMap((value,i)=>
    Number.isFinite(value)?[{time:candles[i].time/1000,value}]:[])});
  switch(id){
    case 'sma':return {series:[series('SMA 20',rolling(close,20,mean))]};
    case 'ema':return {series:[series('EMA 50',ema(close,50),'#f5ba67')]};
    case 'bands':{
      const average=rolling(close,20,mean);
      const deviation=rolling(close,20,(values,i)=>Math.sqrt(mean(values.map(x=>(x-average[i])**2))));
      return {series:[series('BB upper',average.map((v,i)=>v===null?null:v+2*deviation[i]),'#9a9bf5'),
        series('BB basis',average,'#7577bd'),
        series('BB lower',average.map((v,i)=>v===null?null:v-2*deviation[i]),'#9a9bf5')]};
    }
    case 'donchian':{
      const bounds=limits();
      return {series:[series('Donchian high',bounds.map(v=>v?.[0]),'#74c7b6'),
        series('Donchian low',bounds.map(v=>v?.[1]),'#74c7b6')]};
    }
    case 'vwma':return {series:[series('VWMA 20',rolling(close,20,(values,i)=>{
      const volumes=candles.slice(i-19,i+1).map(c=>c.volume);
      const volume=mean(volumes);
      return volume?mean(values.map((value,j)=>value*volumes[j]))/volume:null;
    }),'#e3a4eb')]};
    case 'rsi':{
      const delta=changes();
      const gain=wilder(delta.map(v=>v===null?null:Math.max(v,0)),14);
      const loss=wilder(delta.map(v=>v===null?null:Math.max(-v,0)),14);
      return {series:[series('RSI 14',gain.map((g,i)=>g===null?null:
        loss[i]===0?(g===0?50:100):100-100/(1+g/loss[i])))]};
    }
    case 'atr':return {series:[series('ATR 14',wilder(range(candles),14))]};
    case 'macd':{
      const fast=ema(close,12),slow=ema(close,26);
      const macd=slow.map((v,i)=>v===null?null:fast[i]-v);
      const signal=ema(macd,9);
      return {series:[series('MACD',macd),series('Signal',signal,'#f5ba67'),
        series('Histogram',signal.map((v,i)=>v===null?null:macd[i]-v),'#508988','histogram')]};
    }
    case 'adx':{
      const tr=wilder(range(candles),14);
      const movement=candles.map((c,i)=>{
        if(i===0)return [null,null];
        const up=c.high-candles[i-1].high,down=candles[i-1].low-c.low;
        return [up>Math.max(0,down)?up:0,down>Math.max(0,up)?down:0];
      });
      const plus=wilder(movement.map(v=>v[0]),14);
      const minus=wilder(movement.map(v=>v[1]),14);
      const positive=tr.map((value,i)=>value===null?null:value?100*plus[i]/value:0);
      const negative=tr.map((value,i)=>value===null?null:value?100*minus[i]/value:0);
      const dx=positive.map((value,i)=>value===null?null:value+negative[i]?
        100*Math.abs(value-negative[i])/(value+negative[i]):0);
      return {series:[series('ADX',wilder(dx,14)),series('+DI',positive,'#4fd3ac'),series('-DI',negative,'#f59186')]};
    }
    case 'obv':{
      let total=0;
      return {series:[series('OBV',changes().map((change,i)=>{
        if(change!==null)total+=Math.sign(change)*candles[i].volume;
        return total;
      }))]};
    }
    case 'stochastic':{
      const k=rolling(close,14,(values,i)=>{
        const window=candles.slice(i-13,i+1);
        const high=Math.max(...window.map(c=>c.high)),low=Math.min(...window.map(c=>c.low));
        return high===low?50:100*(values.at(-1)-low)/(high-low);
      });
      return {series:[series('%K',k),series('%D',rolling(k,3,mean),'#f5ba67')]};
    }
    default:return {series:[]};
  }
}
