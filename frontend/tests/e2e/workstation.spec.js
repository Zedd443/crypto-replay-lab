import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{
  await page.goto('/');
  await expect(page.getByLabel('Interactive replay candlestick chart')).toBeVisible();
  await expect(page.locator('.chart-area canvas').first()).toBeVisible();
  await expect(page.getByRole('button',{name:'Shortcut Rectangle'})).toBeEnabled();
});
const at=async page=>{
  const box=await page.locator('.chart-area').boundingBox();
  if(!box)throw Error('chart area missing');
  return {x:box.x+box.width*.45,y:box.y+box.height*.36,w:box.width,h:box.height};
};
test('rectangle can be drag-created, then selected and deselected by clicking background',async({page})=>{
  await page.getByRole('button',{name:'Shortcut Rectangle'}).click();
  const p=await at(page);
  await page.mouse.move(p.x,p.y);
  await page.mouse.down();
  await page.mouse.move(p.x+95,p.y+66,{steps:6});
  await page.mouse.up();
  await expect(page.locator('.chart-shape-rectangle')).toHaveCount(1);
  const shape=page.locator('.chart-shape-rectangle');
  await expect(shape).toBeVisible();
  await shape.click({position:{x:10,y:10}});
  await expect(shape).toHaveClass(/selected/);
  await page.mouse.click(p.x-80,p.y-90);
  await expect(shape).not.toHaveClass(/selected/);
});
test('long plan can be created by a single chart click without opening trade order',async({page})=>{
  await page.getByRole('button',{name:/Shortcut Long R:R drawing/}).click();
  const p=await at(page);
  await page.mouse.click(p.x,p.y);
  await expect(page.locator('.chart-shape-long_position')).toHaveCount(1);
  await expect(page.locator('.plan-level.plan-entry')).toBeVisible();
});
test('indicator options and pattern reader are accessible',async({page})=>{
  await page.getByRole('button',{name:/Indicators/}).click();
  await expect(page.locator('.indicator-params input').first()).toBeVisible();
  await page.locator('.indicator-params input').first().fill('21');
  await expect(page.locator('.indicator-params input').first()).toHaveValue('21');
  await page.getByRole('button',{name:'Drawing & pattern reader'}).click();
  await expect(page.getByText('MARKET STRUCTURE')).toBeVisible();
});
test('rectangle move and resize persist updated time/price coordinates',async({page})=>{
  await page.getByRole('button',{name:'Shortcut Rectangle'}).click();
  const p=await at(page);
  await page.mouse.move(p.x,p.y);
  await page.mouse.down();
  await page.mouse.move(p.x+105,p.y+67,{steps:8});
  await page.mouse.up();
  const shape=page.locator('.chart-shape-rectangle');
  await expect(shape).toBeVisible();
  const sid=await page.evaluate(()=>localStorage.getItem('crl-session'));
  const url=`/api/sessions/${sid}/drawings`;
  const find=async()=>{
    const response=await page.request.get(url);
    return (await response.json()).find(x=>x.kind==='rectangle');
  };
  const initial=await find();
  const box=await shape.boundingBox();
  if(!box)throw Error('rectangle missing bounding box');
  const x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x+30,y+19,{steps:6});
  await page.mouse.up();
  await expect.poll(async()=> (await find())?.anchor_start).not.toBe(initial.anchor_start);
  const moved=await find();
  const handle=shape.locator('[data-handle="end"]');
  await expect(handle).toBeVisible();
  const hand=await handle.boundingBox();
  if(!hand)throw Error('resize handle not visible');
  const hx=hand.x+hand.width/2,hy=hand.y+hand.height/2;
  await page.mouse.move(hx,hy);
  await page.mouse.down();
  await page.mouse.move(hx+24,hy+19,{steps:5});
  await page.mouse.up();
  await expect.poll(async()=> (await find())?.end_price).not.toBe(moved.end_price);
});
test('Fibonacci drawing renders multiple retracement levels',async({page})=>{
  await page.getByRole('button',{name:'Shortcut Fibonacci retracement'}).click();
  const p=await at(page);
  await page.mouse.move(p.x,p.y);
  await page.mouse.down();
  await page.mouse.move(p.x+130,p.y+95,{steps:5});
  await page.mouse.up();
  const shape=page.locator('.chart-shape-fib');
  await expect(shape).toBeVisible();
  await expect(shape.locator('.fib-level')).toHaveCount(10);
});

test('click-click drawing shows live preview from the first anchor',async({page})=>{
  await page.getByRole('button',{name:'Shortcut Rectangle'}).click();
  const p=await at(page);
  await page.mouse.click(p.x,p.y);
  await expect(page.getByText(/Move cursor to preview/)).toBeVisible();
  await page.mouse.move(p.x+90,p.y+70,{steps:5});
  await expect(page.locator('.chart-shape-rectangle.draft')).toBeVisible();
  await page.mouse.click(p.x+90,p.y+70);
  await expect(page.locator('.chart-shape-rectangle:not(.draft)')).toHaveCount(1);
});
test('selected drawings can be removed using Delete keyboard shortcut',async({page})=>{
  await page.getByRole('button',{name:'Shortcut Rectangle'}).click();
  const p=await at(page);
  await page.mouse.move(p.x,p.y);await page.mouse.down();
  await page.mouse.move(p.x+110,p.y+70,{steps:5});await page.mouse.up();
  const shape=page.locator('.chart-shape-rectangle');
  await expect(shape).toHaveCount(1);
  await page.keyboard.press('Delete');
  await expect(shape).toHaveCount(0);
});
test('trendline previews after first click before being committed',async({page})=>{
  await page.getByRole('button',{name:'Shortcut Trendline'}).click();
  const p=await at(page);
  await page.mouse.click(p.x,p.y);
  await page.mouse.move(p.x+110,p.y-70,{steps:5});
  await expect(page.locator('.chart-shape-trendline.draft')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.chart-shape-trendline.draft')).toHaveCount(0);
});
test('selected chart plan controls paper order and execution links drawing',async({page})=>{
  const sid=await page.evaluate(()=>localStorage.getItem('crl-session'));
  const base='/api/sessions/'+sid;
  const state=await (await page.request.get(base)).json();
  const candles=(await (await page.request.get(base+'/candles?tf=1h')).json()).candles;
  const last=candles.at(-1),first=candles.at(-3),price=last.close;
  const drawing={
    kind:'long_position',timeframe:'1h',price, end_price:price*.99,
    take_profit:price*1.02,anchor_start:first.time,anchor_end:candles.at(-2).time
  };
  const response=await page.request.post(base+'/drawings',{data:drawing});
  expect(response.status()).toBe(201);
  const id=(await response.json()).id;
  await page.reload();
  await page.getByRole('button',{name:/Drawings \(/}).click();
  await page.getByRole('button',{name:/long_position/}).first().click();
  const panel=page.getByRole('form',{name:/Selected chart plan/});
  await expect(page.getByText('LONG · Selected chart plan')).toBeVisible();
  await expect(page.getByRole('button',{name:'Execute Paper Long'})).toBeEnabled();
  await page.getByRole('button',{name:'Execute Paper Long'}).click();
  await expect.poll(async()=>{
    const result=await (await page.request.get(base+'/orders')).json();
    return result.some(o=>o.drawing_id===id&&o.status==='open');
  }).toBe(true);
  await expect(page.locator('tr.linked-order')).toHaveCount(1);
});
test('signal lab calculates holding-period rows without mock numbers',async({page})=>{
  await page.getByRole('button',{name:'Signal backtest'}).click();
  await expect(page.getByLabel('Backtest signal')).toBeVisible();
  await expect(page.getByText('Holding period comparison')).toBeVisible();
  await expect(page.locator('.signal-table tbody tr')).toHaveCount(6);
  await page.getByLabel('Holding period').fill('10');
  await expect(page.locator('.signal-table tbody tr.active td').first()).toHaveText('10 candles');
});

test('future plotting slots show and persist a drawing beyond latest replay candle',async({page})=>{
  const sid=await page.evaluate(()=>localStorage.getItem('crl-session'));
  const base='/api/sessions/'+sid;
  const before=await (await page.request.get(base)).json();
  const last=(await (await page.request.get(base+'/candles?tf=1h')).json()).candles.at(-1);
  const result=await page.request.post(base+'/drawings',{data:{
    kind:'rectangle',timeframe:'1h',price:last.close*.97,end_price:last.close*1.03,
    anchor_start:last.time+3600000,anchor_end:last.time+3600000*10
  }});
  expect(result.status()).toBe(201);
  const drawingId=(await result.json()).id;
  await page.reload();
  await page.getByRole('button',{name:'Reset'}).click();
  await expect(page.locator('.chart-shape-rectangle[data-drawing-id="'+drawingId+'"]')).toBeVisible();
  const saved=(await (await page.request.get(base+'/drawings')).json()).find(x=>x.id===drawingId);
  expect(saved.anchor_end).toBeGreaterThan(before.clock_ms);
});
test('Ghost Feed is a chart drawing with live preview, editable historical/future anchors',async({page})=>{
  await page.getByRole('button',{name:'Shortcut Ghost Feed drawing'}).click();
  await page.getByLabel('Ghost avg range percent').fill('0.6');
  const p=await at(page);
  await page.mouse.click(p.x,p.y);
  await page.mouse.move(p.x+110,p.y-60,{steps:7});
  await expect(page.locator('.chart-shape-ghost_feed.draft')).toBeVisible();
  await expect(page.locator('.chart-shape-ghost_feed.draft [data-ghost-bar]').first()).toBeVisible();
  await page.mouse.click(p.x+110,p.y-60);
  const shape=page.locator('.chart-shape-ghost_feed:not(.draft)');
  await expect(shape).toHaveCount(1);
  await expect(shape.locator('[data-ghost-bar]').first()).toBeVisible();
  const sid=await page.evaluate(()=>localStorage.getItem('crl-session'));
  const saved=(await (await page.request.get('/api/sessions/'+sid+'/drawings')).json());
  const ghost=saved.find(x=>x.kind==='ghost_feed');
  expect(ghost.ghost_range).toBe(.6);
  await page.reload();
  await expect(page.locator('.chart-shape-ghost_feed')).toHaveCount(1);
  await page.getByRole('button',{name:/Drawings/}).click();
  await page.getByRole('button',{name:/^Ghost Feed drawing /}).click();
  await expect(shape).toHaveClass(/selected/);
  await page.keyboard.press('Delete');
  await expect(page.locator('.chart-shape-ghost_feed')).toHaveCount(0);
});
test('Snap Entry to Market keeps R:R distances and enables paper execution',async({page})=>{
  const sid=await page.evaluate(()=>localStorage.getItem('crl-session'));
  const base='/api/sessions/'+sid;
  const candles=(await (await page.request.get(base+'/candles?tf=1h')).json()).candles;
  const market=candles.at(-1).close,entry=market*.97,stop=market*.95,target=market*1.01;
  const create=await page.request.post(base+'/drawings',{data:{
    kind:'long_position',timeframe:'1h',price:entry,end_price:stop,take_profit:target,
    anchor_start:candles.at(-3).time,anchor_end:candles.at(-2).time
  }});
  expect(create.status()).toBe(201);
  const id=(await create.json()).id;
  await page.reload();
  await page.getByRole('button',{name:/Drawings \(/}).click();
  await page.getByRole('button',{name:/long_position/}).first().click();
  const button=page.getByRole('button',{name:/Snap Entry to Market/});
  await expect(button).toBeVisible();
  await button.click();
  await expect.poll(async()=>{
    const x=(await (await page.request.get(base+'/drawings')).json()).find(x=>x.id===id);
    return x?.price;
  }).toBeCloseTo(market,4);
  const drawn=(await (await page.request.get(base+'/drawings')).json()).find(x=>x.id===id);
  expect(drawn.price-drawn.end_price).toBeCloseTo(entry-stop,4);
  expect(drawn.take_profit-drawn.price).toBeCloseTo(target-entry,4);
  await expect(page.getByRole('button',{name:'Execute Paper Long'})).toBeEnabled();
});

test('drawing hypothesis can be locked and evaluated without paper order',async({page})=>{
  await page.getByRole('button',{name:'Shortcut Rectangle'}).click();
  const p=await at(page);
  await page.mouse.move(p.x,p.y);
  await page.mouse.down();
  await page.mouse.move(p.x+105,p.y+75,{steps:6});
  await page.mouse.up();
  await expect(page.locator('.chart-shape-rectangle')).toHaveCount(1);
  const sid=await page.evaluate(()=>localStorage.getItem('crl-session'));
  const base='/api/sessions/'+sid;
  await page.getByRole('button',{name:'Drawing assessments'}).click();
  await expect(page.getByLabel('Assessment drawing')).toBeVisible();
  await expect(page.getByRole('button',{name:'Lock hypothesis'})).toBeEnabled();
  await page.getByLabel('Assessment horizon').fill('3');
  await page.getByRole('button',{name:'Lock hypothesis'}).click();
  await expect(page.getByText(/Hypothesis locked at cursor/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Already locked'})).toBeDisabled();
  const result=(await (await page.request.get(base+'/assessments')).json());
  expect(result.summary.locked).toBe(1);
  expect(result.items[0].status).toBe('PENDING');
  const orders=(await (await page.request.get(base+'/orders')).json());
  expect(orders).toHaveLength(0);
  await page.getByRole('button',{name:'+1 ▶'}).click();
  await expect.poll(async()=>{
    const response=await page.request.get(base+'/assessments');
    const payload=await response.json();
    return payload.items[0].observed;
  }).toBeGreaterThanOrEqual(0);
  await expect(page.getByText('Hypothesis accuracy')).toBeVisible();
});
test('rewind audit prevents creating scored hypotheses from known future',async({page})=>{
  await page.getByRole('button',{name:'Shortcut Rectangle'}).click();
  const p=await at(page);
  await page.mouse.move(p.x,p.y);await page.mouse.down();
  await page.mouse.move(p.x+110,p.y+75,{steps:5});await page.mouse.up();
  await page.getByRole('button',{name:'Drawing assessments'}).click();
  await page.getByRole('button',{name:'Lock hypothesis'}).click();
  await expect(page.getByText(/Hypothesis locked at cursor/)).toBeVisible();
  const sid=await page.evaluate(()=>localStorage.getItem('crl-session'));
  const initialLockCursor=(await (await page.request.get('/api/sessions/'+sid+'/assessments')).json()).items[0].locked_cursor;
  await page.getByRole('button',{name:'+1 ▶'}).click();
  await page.getByRole('button',{name:'◀ −1'}).click();
  await expect(page.getByText(/Rewind audit: this session/)).toBeVisible();
  const state=(await (await page.request.get('/api/sessions/'+sid)).json());
  const after=(await (await page.request.get('/api/sessions/'+sid+'/assessments')).json());
  // A TF step backwards may land before the original lock cursor. That lock
  // must then be hidden to prevent future knowledge from appearing on screen.
  if(state.cursor<initialLockCursor)expect(after.items).toHaveLength(0);
  else expect(after.items).toHaveLength(1);
  // Rewinding before the drawing creation removes the form's submit button
  // altogether; rewinding only before its lock keeps a disabled button.
  const submit=page.locator('.assessment-form button[type="submit"]');
  if(await submit.count())await expect(submit).toBeDisabled();
  else await expect(page.getByLabel('Assessment drawing')).toHaveValue('');
});
