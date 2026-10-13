'use strict';
// Isolated local demonstration and regression checks; never reads the owner store.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { realismFloor, drawingImage } = require('./helpers/realism-fixture');
const root = path.resolve(__dirname, '..'), work = path.join(root, 'work');
fs.mkdirSync(work, { recursive: true });
const dir = fs.mkdtempSync(path.join(work, 'presentation-test-'));
fs.cpSync(path.join(root, 'public'), path.join(dir, 'public'), { recursive: true });
for (const file of ['server.js', 'seo.js', 'telegram-bot.js', 'floor-plan-recognition.js']) fs.copyFileSync(path.join(root, file), path.join(dir, file));
for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_OWNER_CHAT_IDS', 'TELEGRAM_OWNER_CHAT_ID', 'AI_DESIGN_API_KEY', 'OPENAI_API_KEY', 'FLOORPLAN_RECOGNITION_URL']) delete process.env[key];
process.env.NODE_ENV = 'production'; process.env.ADMIN_PASSWORD = 'realism-preview';
const server = require(path.join(dir, 'server.js'));
const serve = process.argv.includes('--serve');
async function run() {
  let browser, page;
  const checks = [], errors = [];
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(serve ? 43822 : 0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true, reducedMotion: 'reduce' });
    page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    const floor = realismFloor(); floor.image = await drawingImage(page, floor);
    await page.goto(base + '/admin');
    await page.getByLabel('Password', { exact: true }).fill(process.env.ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Open dashboard' }).click();
    await page.getByRole('heading', { name: 'Owner dashboard', exact: true }).waitFor();
    const create = async(endpoint, data, key) => { const response = await context.request.post(base + endpoint, { data }); assert.equal(response.status(),201,await response.text()); return (await response.json())[key]; };
    const building = { version: 2, published: true, floors: [{ plan: floor }] };
    const model = await create('/api/admin/models', { title: 'Realism preview — furnished home', location: 'Local demonstration · Madurai', description: 'Review the new furnishings, architectural details and guided room views. This synthetic example is not a property for sale.', floorPlan: building }, 'model');
    const modelUrl = base + '/3d-project/' + model.id;
    if (serve) {
      await browser.close(); browser = null;
      console.log(JSON.stringify({ base, modelUrl, adminUrl: base + '/admin', localOnly: true, demonstrationStore: true }));
      fs.writeFileSync(path.join(work,'realism-preview.json'),JSON.stringify({base,modelUrl,adminUrl:base+'/admin'},null,2));
      const shutdown = () => { server.close(); clean(); process.exit(0); };
      process.on('SIGINT',shutdown); process.on('SIGTERM',shutdown);
      await new Promise(() => {}); return;
    }
    await page.addInitScript(() => { let factory; Object.defineProperty(window,'FloorPlanRenderer',{configurable:true,get:()=>factory,set(value){factory=(...args)=>{const viewer=value(...args); window.__presentationViewer=viewer;return viewer;};}}); });
    const viewer = () => page.locator('#project-floor-plan');
    const state = () => page.evaluate(() => window.__presentationViewer.getViewState());
    const stats = () => page.evaluate(() => window.__presentationViewer.getStats());
    await page.goto(modelUrl); await viewer().locator('canvas[data-engine="three"]').waitFor();
    await viewer().scrollIntoViewIfNeeded(); await page.waitForFunction(() => window.__presentationViewer.getStats().renderCount > 0);
    assert.equal(await viewer().locator('[data-room-view]').count(),5);
    const drawStats = await stats();
    assert.ok(drawStats.meshCount < 60, `furniture subparts are merged into material batches: ${drawStats.meshCount} meshes`);
    assert.equal(drawStats.ambientOcclusion,true);
    await viewer().getByRole('button',{name:'Show cutaway walls',exact:true}).click();
    await viewer().screenshot({path:path.join(work,'realism-overview.png')});
    for (const name of ['Entrance','Living room','Kitchen','Bedroom','Balcony']) {
      await viewer().getByRole('button',{name,exact:true}).click();
      assert.equal((await state()).walking,true);
      assert.match(await viewer().locator('.fp-room-notes').innerText(),new RegExp(name));
      if (name === 'Living room') await viewer().screenshot({path:path.join(work,'realism-living-room.png')});
      if (name === 'Kitchen') await viewer().screenshot({path:path.join(work,'realism-kitchen.png')});
      if (name === 'Bedroom') await viewer().screenshot({path:path.join(work,'realism-bedroom.png')});
    }
    checks.push('all five room buttons enter a clear eye-level view with room notes');
    await viewer().getByLabel('Preview lighting').selectOption('evening'); assert.equal((await state()).lighting,'evening');
    await viewer().getByRole('button',{name:'Living room',exact:true}).click();
    await viewer().screenshot({path:path.join(work,'realism-evening.png')});
    await viewer().getByRole('button',{name:'Exit walkthrough',exact:true}).click();
    assert.equal((await state()).walking,false); assert.equal((await state()).fullWalls,false);
    const before = (await stats()).cameraPosition;
    const blocked = await page.evaluate(saved => { const viewer = window.__presentationViewer, plan = window.FloorPlanGeometry.validate(saved); plan.floors[0].plan.presentation.views[0].center = [.15,.6]; viewer.update(plan); return viewer.focusView(0,0); }, building);
    assert.equal(blocked,false); assert.deepEqual((await stats()).cameraPosition,before);
    checks.push('lighting changes, walking exit and restored overview');
    await page.goto(base+'/admin'); await page.locator('[data-admin-tab="models"]').click(); await page.locator(`[data-edit-model="${model.id}"]`).click();
    await page.locator('.fp-preview-panel canvas[data-engine="three"]').waitFor();
    const tab = name => page.getByRole('tablist',{name:'Floor editor tools'}).getByRole('tab',{name,exact:true});
    await tab('Architecture & tour').click();
    await page.locator('[data-detail="roof"]').selectOption('pitched'); await page.locator('[data-architecture-save]').click();
    await page.locator('[data-tour-selected]').selectOption('1'); await page.locator('[data-tour="notes"]').fill('Reviewed wood flooring and upholstered seating.');
    await page.locator('[data-tour-save]').click();
    await tab('Furniture').click(); await page.locator('#fp-items').selectOption('17');
    await page.locator('#fp-item-height').fill('9.5'); await page.getByRole('button',{name:'Update selected item',exact:true}).click();
    await page.getByRole('button',{name:'Save 3D project',exact:true}).click(); await page.locator(`[data-edit-model="${model.id}"]`).waitFor();
    const data = await (await context.request.get(base+'/api/admin/data')).json(), saved = data.models.find(m=>m.id===model.id).floorPlan.floors[0].plan;
    assert.equal(saved.presentation.roof,'pitched'); assert.equal(saved.presentation.views[1].notes,'Reviewed wood flooring and upholstered seating.'); assert.equal(saved.furniture[17].height,9.5);
    await page.locator(`[data-edit-model="${model.id}"]`).click(); await tab('Architecture & tour').click();
    assert.equal(await page.locator('[data-detail="roof"]').inputValue(),'pitched'); await page.locator('[data-tour-selected]').selectOption('1'); assert.equal(await page.locator('[data-tour="notes"]').inputValue(),saved.presentation.views[1].notes);
    checks.push('architecture, viewpoints and stair rise save through the API and reopen in the editor');
    const preview = page.locator('.fp-preview-panel'); await preview.locator('.fp-view-options > summary').click();
    const download = page.waitForEvent('download'); await preview.getByRole('button',{name:'Download detailed 3D (.glb)',exact:true}).click();
    const file = await download, glbPath = path.join(work,'realism-model.glb'); await file.saveAs(glbPath);
    const glb = fs.readFileSync(glbPath), json = JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString());
    assert.ok(json.materials.some(m=>m.normalTexture), 'surface detail survives GLB export');
    assert.ok(json.nodes.some(n=>n.name==='Roof and parapets')); assert.ok(json.nodes.some(n=>/Skirting/.test(n.name)));
    checks.push('detailed GLB includes roof, joinery and normal textures');
    await page.goto(modelUrl); await viewer().locator('canvas[data-engine="three"]').waitFor();
    await page.setViewportSize({width:390,height:844}); await viewer().getByRole('button',{name:'Bedroom',exact:true}).click();
    assert.equal((await state()).walking,true); assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await viewer().screenshot({path:path.join(work,'realism-mobile.png')}); checks.push('guided room tour fits a mobile screen');
    assert.deepEqual(errors,[]); const report={pass:true,checks,browserErrors:errors}; fs.writeFileSync(path.join(work,'presentation-browser-report.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
  } catch(error) { if(page) await page.screenshot({path:path.join(work,'realism-failure.png')}).catch(()=>{}); console.error(JSON.stringify({checks,errors})); throw error; }
  finally { await browser?.close(); if(!serve) { await new Promise(resolve=>server.close(resolve)); clean(); } }
}
function clean() { const resolved=path.resolve(dir); if(!resolved.startsWith(work+path.sep)||!path.basename(resolved).startsWith('presentation-test-')) throw Error('Unexpected cleanup path'); fs.rmSync(resolved,{recursive:true,force:true}); }
run().catch(error=>{console.error(error);server.close();process.exitCode=1;});
