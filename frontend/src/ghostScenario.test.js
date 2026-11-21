import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {futureSlots,ghostScenario,FUTURE_SPACE_BARS} from './ghostScenario.js';
test('future canvas slots are correctly spaced per active timeframe',()=>{
  assert.equal(futureSlots(3600000,'1h',2)[0],7200000);
  assert.deepEqual(futureSlots(60000,'1m',2),[120000,180000]);
  assert.equal(futureSlots(60000,'1m').length,FUTURE_SPACE_BARS);
});
test('ghost OHLC uses only final visible candle and configurable scenario',()=>{
  const candles=[{time:60000,close:100},{time:120000,close:100}];
  const result=ghostScenario(candles,'1m',{count:4,movePct:-4,wickPct:.2});
  assert.equal(result.length,4);
  assert.equal(result[0].time,180);
  assert.equal(result.at(-1).close,96);
  assert.equal(result[0].open,100);
  assert.ok(result.every(c=>c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close)));
  assert.deepEqual(ghostScenario(candles,'1m',{count:4,movePct:-4,wickPct:.2}),result);
});
test('ghost values are capped and never read unrevealed candles',()=>{
 const bars=[{time:60000,close:100}];
 assert.equal(ghostScenario(bars,'1m',{count:999,movePct:999}).length,20);
 assert.equal(ghostScenario(bars,'1m',{count:2,movePct:2}).at(-1).close,102);
 assert.equal(ghostScenario([],'1m').length,0);
});
