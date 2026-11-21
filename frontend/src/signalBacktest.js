import {calculateIndicator, INDICATORS,DEFAULT_INDICATOR_OPTIONS} from './indicators.js';

export const SIGNALS=INDICATORS.filter(([, ,type])=>type==='marker').map(([id,label])=>({id,label}));
export const HOLDING_PERIODS=[1,3,5,10,20,50];

const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const wilson=(wins,n,z=1.96)=>{
  if(!n)return null;
  const p=wins/n,den=1+z*z/n;
  const middle=(p+z*z/(2*n))/den;
  const half=z*Math.sqrt((p*(1-p)+z*z/(4*n))/n)/den;
  return [100*Math.max(0,middle-half),100*Math.min(1,middle+half)];
};
export function backtestSignal(candles,markerEvents,{holding=5,feePct=.04,slippagePct=.02,
  stopPct=0,targetPct=0,side='both',split=.7}={}){
  const closedCandles=candles.filter(c=>c.complete);
  const byTime=new Map(closedCandles.map((c,i)=>[c.time/1000,i]));
  const trades=[],pending=[];
  const fee=Number(feePct)/100,slip=Number(slippagePct)/100;
  const amount=Math.max(1,Math.floor(Number(holding)||1));
  const exitModel=Number(stopPct)>0&&Number(targetPct)>0?'tp-sl':'time';
  for(const marker of markerEvents){
    const dir=marker.position==='belowBar'?1:marker.position==='aboveBar'?-1:0;
    if(!dir||(side==='long'&&dir<0)||(side==='short'&&dir>0))continue;
    const signalIndex=byTime.get(marker.time);
    if(signalIndex==null)continue;
    const entryIndex=signalIndex+1;
    const exitMax=entryIndex+amount-1;
    if(exitMax>=closedCandles.length){
      pending.push(marker);continue;
    }
    const entryBar=closedCandles[entryIndex];
    const entry=entryBar.open*(1+dir*slip);
    if(!(entry>0))continue;
    const stop=entry*(1-dir*Number(stopPct)/100);
    const target=entry*(1+dir*Number(targetPct)/100);
    if(exitModel==='tp-sl'&&!(stop>0&&target>0))continue;
    let exitBar=closedCandles[exitMax],exit=exitBar.close*(1-dir*slip),
      reason='holding',ambiguous=false;
    if(exitModel==='tp-sl'){
      for(let i=entryIndex;i<=exitMax;i++){
        const b=closedCandles[i];
        const s=dir===1?b.low<=stop:b.high>=stop;
        const t=dir===1?b.high>=target:b.low<=target;
        if(s||t){
          exitBar=b;ambiguous=s&&t;
          // Opening price gaps are not filled at the unreachable desired level.
          if(s){
            exit=dir===1?Math.min(b.open,stop):Math.max(b.open,stop);
            reason=ambiguous?'ambiguous-stop-first':'stop';
          }else{
            exit=dir===1?Math.max(b.open,target):Math.min(b.open,target);
            reason='target';
          }
          exit*=1-dir*slip;
          break;
        }
      }
    }
    const grossPct=100*dir*(exit/entry-1);
    // Conservative proportional round-trip costs on entry and exit notional.
    const costPct=100*(fee+(exit/entry)*fee);
    const netPct=grossPct-costPct;
    trades.push({signalTime:marker.time,entryTime:entryBar.time,
      exitTime:exitBar.time,signalIndex,entryIndex,
      exitIndex:byTime.get(exitBar.time/1000),
      direction:dir===1?'long':'short',entry,exit,grossPct,costPct,netPct,
      reason,ambiguous});
  }
  const summarize=list=>{
    const wins=list.filter(t=>t.netPct>0),losses=list.filter(t=>t.netPct<0);
    const returns=list.map(t=>t.netPct),sum=returns.reduce((a,b)=>a+b,0);
    let cumulative=0,peak=0,maxDrawdown=0;
    for(const t of list){
      cumulative+=t.netPct;peak=Math.max(peak,cumulative);
      maxDrawdown=Math.max(maxDrawdown,peak-cumulative);
    }
    const grossWin=wins.reduce((a,b)=>a+b.netPct,0);
    const grossLoss=-losses.reduce((a,b)=>a+b.netPct,0);
    return {count:list.length,wins:wins.length,losses:losses.length,
      winRate:list.length?100*wins.length/list.length:null,
      winRateCI:wilson(wins.length,list.length),expectancy:mean(returns),
      avgReturn:mean(returns),
      medianReturn:returns.length?[...returns].sort((a,b)=>a-b)[Math.floor(returns.length/2)]:null,
      profitFactor:grossLoss>0?grossWin/grossLoss:null,
      totalNetPct:sum,maxDrawdown,
      avgBars:mean(list.map(t=>t.exitIndex-t.entryIndex+1)),
      ambiguities:list.filter(t=>t.ambiguous).length};
  };
  // Split at 70% of completed candles; trades crossing boundary are excluded.
  const splitIndex=Math.floor(closedCandles.length*split);
  const insample=trades.filter(t=>t.exitIndex<splitIndex);
  const oos=trades.filter(t=>t.entryIndex>=splitIndex);
  return {trades,pending:pending.length,summary:summarize(trades),
    insample:summarize(insample),oos:summarize(oos),holding:amount,
    usedBars:closedCandles.length,exitModel,
    note:'Non-exclusive signal trades can overlap. Gross/net % ignore funding and liquidation.'};
}

export function backtestIndicator(candles,id,settings={},options={}){
  const output=calculateIndicator(id,candles,settings);
  return backtestSignal(candles,output.markers||[],options);
}
export function compareHoldingPeriods(candles,id,settings={},opts={},periods=HOLDING_PERIODS){
  // Same signal set for all holding horizons; no cherry-picking from the best.
  const markerEvents=calculateIndicator(id,candles,settings).markers||[];
  return periods.map(holding=>backtestSignal(candles,markerEvents,{...opts,holding}));
}
