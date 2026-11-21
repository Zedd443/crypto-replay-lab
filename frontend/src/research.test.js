import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {evaluateTrades,analyzeDrawings} from './research.js';

test('statistics use only closed PnL and no fabricated trades',()=>{
  const empty=evaluateTrades([]);
  assert.equal(empty.count,0);assert.equal(empty.winRate,null);
  const x=evaluateTrades([{status:'closed',side:'long',pnl:20,exit_ms:1},
    {status:'closed',side:'short',pnl:-10,exit_ms:2},{status:'open',side:'long',pnl:100}]);
  assert.equal(x.count,2);assert.equal(x.winRate,50);assert.equal(x.profitFactor,2);
  assert.equal(x.grossPnl,10);assert.equal(x.maxDrawdown,10);
});
test('drawing reader does not inspect candles before drawing creation',()=>{
  const drawing={id:'a',kind:'rectangle',price:95,end_price:105,
    created_at_ts:120000};
  const c=[{time:60000,high:110,low:90,close:100},
    {time:120000,high:110,low:90,close:100},
    {time:180000,high:103,low:98,close:101}];
  assert.equal(analyzeDrawings([drawing],c)[0].touches,1);
});
