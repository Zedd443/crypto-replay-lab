import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {backtestSignal,compareHoldingPeriods} from './signalBacktest.js';
const c=(time,open,high,low,close,complete=true)=>({time,open,high,low,close,volume:10,complete});
test('entry occurs after confirmed signal, not on its candle',()=>{
 const candles=[c(60000,100,105,95,100),c(120000,100,104,99,103),
 c(180000,103,108,102,107),c(240000,107,109,106,108)];
 const markers=[{time:60,position:'belowBar'}];
 const r=backtestSignal(candles,markers,{holding:2,feePct:0,slippagePct:0});
 assert.equal(r.trades.length,1);
 assert.equal(r.trades[0].entryTime,120000);
 assert.equal(r.trades[0].exitTime,180000);
});
test('incomplete holding periods are pending, no future-bar leakage',()=>{
 const candles=[c(60000,100,101,99,100),c(120000,100,101,99,100),
 c(180000,100,101,99,100),c(240000,100,101,99,100)];
 const markers=[{time:180,position:'belowBar'}];
 const r=backtestSignal(candles,markers,{holding:3});
 assert.equal(r.summary.count,0);assert.equal(r.pending,1);
});
test('ambiguous target+stop intrabar is stop-first',()=>{
 const candles=[c(60000,100,101,99,100),c(120000,100,104,96,100),
 c(180000,100,102,98,100)];
 const markers=[{time:60,position:'belowBar'}];
 const r=backtestSignal(candles,markers,{holding:2,stopPct:1,targetPct:1,feePct:0,slippagePct:0});
 assert.equal(r.trades[0].reason,'ambiguous-stop-first');
 assert.ok(r.trades[0].netPct<0);
});
test('visible partial candles cannot become execution candles',()=>{
 const candles=[c(60000,100,101,99,100),c(120000,100,101,99,100,false)];
 const r=backtestSignal(candles,[{time:60,position:'belowBar'}],{holding:1});
 assert.equal(r.summary.count,0);assert.equal(r.pending,1);
});
test('comparison returns all horizons without selecting a winner',()=>{
 const candles=Array.from({length:70},(_,i)=>c((i+1)*60000,100+i*.1,101+i*.1,99+i*.1,100.1+i*.1));
 const results=compareHoldingPeriods(candles,'fvg',{}, {},[1,3,10]);
 assert.deepEqual(results.map(x=>x.holding),[1,3,10]);
});
