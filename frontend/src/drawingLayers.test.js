import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {visibleChartDrawings,archivedDrawingIds,visibleTradeMarkers} from './drawingLayers.js';

test('closed executed plans archive by default, unexecuted plans survive',()=>{
  const ds=[{id:'long-a',kind:'long_position'},{id:'short-b',kind:'short_position'},
    {id:'zone',kind:'rectangle'},{id:'h',kind:'horizontal'}];
  const orders=[{drawing_id:'long-a',status:'closed',id:'trade1'}];
  assert.deepEqual([...archivedDrawingIds(orders)],['long-a']);
  assert.deepEqual(visibleChartDrawings(ds,orders).map(x=>x.id),['short-b','zone','h']);
  assert.equal(visibleChartDrawings(ds,orders,true).length,4);
  assert.equal(visibleChartDrawings(ds,[]).length,4);
});
test('only closed linked orders archive drawings; markers are independently toggleable',()=>{
  const ds=[{id:'x',kind:'long_position'}],orders=[
    {id:'open',drawing_id:'x',status:'open'},{id:'closed',status:'closed'}
  ];
  assert.equal(visibleChartDrawings(ds,orders).length,1);
  assert.deepEqual(visibleTradeMarkers(orders,false).map(x=>x.id),['open']);
  assert.equal(visibleTradeMarkers(orders).length,2);
});
