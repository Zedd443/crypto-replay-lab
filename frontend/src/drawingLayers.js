/** Pure chart visibility policy: only executed & closed plans become archived.
 * Unexecuted drawings remain editable hypotheses; history is never deleted.
 */
export const isPositionDrawing=d=>d?.kind==='long_position'||d?.kind==='short_position';
export function archivedDrawingIds(orders=[]){
  return new Set(orders.filter(o=>o.drawing_id&&o.status==='closed').map(o=>o.drawing_id));
}
export function visibleChartDrawings(drawings=[],orders=[],showArchived=false){
  const archived=archivedDrawingIds(orders);
  return drawings.filter(d=>!isPositionDrawing(d)||showArchived||!archived.has(d.id));
}
export function visibleTradeMarkers(orders=[],showClosed=true){
  return orders.filter(o=>o.status!=='closed'||showClosed);
}
