/** Hypothetical manual scenario: NEVER use this as replay evidence or an indicator input. */
export const TF_MILLISECONDS={
  '1m':60000,'5m':300000,'15m':900000,'30m':1800000,
  '1h':3600000,'4h':14400000,'1d':86400000,'1w':604800000
};
export const FUTURE_SPACE_BARS=80;
export function futureSlots(lastTime,timeframe,count=FUTURE_SPACE_BARS){
  const width=TF_MILLISECONDS[timeframe];
  if(!Number.isFinite(lastTime)||!width)return [];
  return Array.from({length:count},(_,i)=>lastTime+(i+1)*width);
}
export function ghostScenario(candles,timeframe,{count=8,movePct=2,wickPct=.25}={}){
  const last=candles.at(-1);
  if(!last||!Number.isFinite(last.close)||last.close<=0)return [];
  const length=Math.max(1,Math.min(20,Math.round(Number(count)||1)));
  const move=Math.max(-25,Math.min(25,Number(movePct)||0))/100;
  const wick=Math.max(0,Math.min(5,Number(wickPct)||0))/100;
  const times=futureSlots(last.time,timeframe,length);
  let previous=last.close;
  return times.map((time,i)=>{
    // Deterministic linear path; final close = requested percent move, no future price consulted.
    const fraction=(i+1)/length;
    const close=Math.max(1e-10,last.close*(1+move*fraction));
    const open=previous;
    const spread=last.close*wick;
    const high=Math.max(open,close)+spread;
    const low=Math.max(1e-10,Math.min(open,close)-spread);
    previous=close;
    return {time:time/1000,open,high,low,close};
  });
}
