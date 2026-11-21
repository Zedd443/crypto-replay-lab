import assert from 'node:assert/strict';
import test from 'node:test';
import {calculateIndicator, INDICATORS} from './indicators.js';

const candles=Array.from({length:100},(_,i)=>({
  time:i*900000,open:i+10,close:i+11,high:i+11.25,low:i+9.75,volume:10,complete:true,
}));

test('every indicator produces the same historical values when the visible prefix grows',()=>{
  const prefix=candles.slice(0,60);
  const last=prefix.at(-1).time/1000;
  for(const [id] of INDICATORS){
    const visible=calculateIndicator(id,prefix);
    const full=calculateIndicator(id,candles);
    if(full.markers){
      assert.deepEqual(full.markers.filter(marker=>marker.time<=last),visible.markers,id);
    }else{
      assert.deepEqual(full.series.map(s=>s.points.filter(point=>point.time<=last)),
        visible.series.map(s=>s.points),id);
      assert(full.series.every(s=>s.points.length>0),id);
    }
  }
});

test('moving indicators, flat RSI, and FVG confirmation',()=>{
  assert.equal(calculateIndicator('sma',candles).series[0].points[0].value,20.5);
  assert.equal(calculateIndicator('rsi',candles).series[0].points[0].value,100);
  const flat=candles.map(c=>({...c,open:10,close:10,high:10,low:10}));
  assert.equal(calculateIndicator('rsi',flat).series[0].points[0].value,50);
  const gap=candles.slice(0,3);
  assert.equal(calculateIndicator('fvg',gap).markers.length,1);
  assert.equal(calculateIndicator('fvg',[...gap.slice(0,2),{...gap[2],complete:false}]).markers.length,0);
});

test('BOS is stamped on the break candle, never on the confirmed pivot',()=>{
  const highs=[10,11,15,12,13,17];
  const visible=highs.map((high,i)=>({...candles[i],high,low:7,close:high-0.5}));
  assert.equal(calculateIndicator('bos',visible.slice(0,5)).markers.length,0);
  assert.equal(calculateIndicator('bos',visible).markers[0].time,visible[5].time/1000);
});
