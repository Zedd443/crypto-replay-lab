import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {structureSnapshot,analyzeDrawings} from './research.js';
const c=(time,high,low,close)=>({time,high,low,close,complete:true});
test('structure reader remains causal when adding a future bar',()=>{
  const bars=[c(1,10,7,9),c(2,12,8,11),c(3,15,10,14),
    c(4,13,8,10),c(5,12,9,11),c(6,14,10,12),c(7,16,12,15),
    c(8,15,11,12),c(9,14,10,11)];
  const current=structureSnapshot(bars);
  const later=structureSnapshot([...bars,c(10,17,11,16)]);
  assert.ok(current.confirmedBars<later.confirmedBars);
  assert.ok(typeof current.regime==='string');
});
test('fakeout requires a subsequent visible close back inside zone',()=>{
  const d={id:'a',kind:'rectangle',price:100,end_price:110,created_at_ts:0};
  const bars=[c(1,108,104,108),c(2,113,109,112),c(3,109,105,107)];
  const a=analyzeDrawings([d],bars.slice(0,2))[0],b=analyzeDrawings([d],bars)[0];
  assert.equal(a.fakeout,0);assert.equal(b.fakeout,1);
});
