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