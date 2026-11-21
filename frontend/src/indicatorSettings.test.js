import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {calculateIndicator,DEFAULT_INDICATOR_OPTIONS} from './indicators.js';
const bars=Array.from({length:180},(_,i)=>({time:(i+1)*60000,open:100+i*.3,
 high:101+i*.3,low:99+i*.3,close:100.5+i*.3,volume:10,complete:true}));
test('configurable moving average and RSI periods',()=>{
 const a=calculateIndicator('sma',bars,{length:5}).series[0].points;
 const b=calculateIndicator('sma',bars,{length:20}).series[0].points;
 assert.ok(a.length>b.length);assert.equal(a[0].time,bars[4].time/1000);
 const r=calculateIndicator('rsi',bars,{length:7});
 assert.ok(r.series[0].points.length>0);
 assert.equal(DEFAULT_INDICATOR_OPTIONS.rsi.length,14);
});
test('candidate detectors do not read future candles',()=>{
 for(const id of ['sweep','displacement','confluence']){
   const early=calculateIndicator(id,bars.slice(0,80)).markers;
   const later=calculateIndicator(id,bars.slice(0,81)).markers;
   assert.deepEqual(later.filter(m=>m.time<=bars[79].time/1000),early);
 }
});