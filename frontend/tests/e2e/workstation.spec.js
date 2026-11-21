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
