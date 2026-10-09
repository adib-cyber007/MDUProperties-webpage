'use strict';
// Real inference + browser upload + accepted furniture + persistence + mesh exports.
// The website uses a temporary store; no real listing/project is changed.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const G = require('../public/floor-plan-geometry');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const fixture = path.resolve(process.argv[2] || path.join(root, 'work/reference-floorplan.png'));
const work = path.join(root, 'work'); fs.mkdirSync(work, { recursive: true });
const dir = fs.mkdtempSync(path.join(work, 'browser-test-'));
if (!fs.existsSync(fixture)) throw new Error('Pass a PNG/JPEG/WebP floor plan to this test. See services/floorplan/README.md.');
fs.cpSync(path.join(root, 'public'), path.join(dir, 'public'), { recursive: true });
for (const file of ['server.js', 'seo.js', 'telegram-bot.js', 'floor-plan-recognition.js']) fs.copyFileSync(path.join(root, file), path.join(dir, file));
for (const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','VERCEL','TELEGRAM_BOT_TOKEN','AI_DESIGN_API_KEY','OPENAI_API_KEY']) delete process.env[key];
process.env.ADMIN_PASSWORD = 'floorplan-browser-test';
process.env.FLOORPLAN_RECOGNITION_URL ||= 'http://127.0.0.1:8765';
const server = require(path.join(dir, 'server.js'));

(async () => {
  let browser;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const legacyRequests = []; page.on('request', request => {
      if (/\/floor-plan-(detection|openings)\.js$/.test(new URL(request.url()).pathname)) legacyRequests.push(request.url());
    });
    const analyses = []; page.on('response', response => {
      if (response.url().endsWith('/api/admin/floor-plan-recognition') && response.request().method() === 'POST') analyses.push(response);
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' }); await page.locator('.hero').first().waitFor();
    await page.goto(base + '/admin'); await page.locator('#owner-password').fill('floorplan-browser-test');
    await page.getByRole('button', { name: 'Open dashboard' }).click();
    await page.locator('[data-admin-tab="models"]').click(); await page.locator('#add-model').click();
    await page.locator('#model-title').fill('Floor plan inference verification');
    const section = name => page.getByRole('tablist', {name:'Property editor sections'}).getByRole('tab', {name,exact:true}).click();
    const tools = name => page.getByRole('tablist', {name:'Floor editor tools'}).getByRole('tab', {name,exact:true}).click();
    await section('Floor plan & 3D');
    await page.locator('[data-recognition-status]').filter({ hasText: 'Pretrained recognition is ready' }).waitFor({ timeout: 15000 });
    await page.locator('#fp-upload').setInputFiles(fixture);
    await page.locator('.fp-status').filter({ hasText: 'Pretrained model recognition.' }).waitFor({ timeout: 95000 });
    assert.equal(analyses.length, 1); assert.equal(analyses[0].status(), 200);
    const result = await analyses[0].json();
    assert.equal(result.engine, 'cubicasa5k'); assert.ok(result.walls.length>0);
    for(const kind of ['wall','door','window']) assert.ok(result.walls.some(w=>w.kind===kind),`automatic FLRplanner recognition detects ${kind}`);
    assert.deepEqual(result.sources,{walls:'cubicasa5k',openings:'cubicasa5k',furniture:'cubicasa5k'});
    assert.ok(result.furniture.length>0); assert.ok(result.rooms.length>0);
    assert.ok(await page.locator('.fp-suggestion').count()>0,'furniture suggestions appear automatically');
    await tools('Walls & openings');
    assert.equal(await page.locator('[data-wall-review]').isVisible(), false, 'FLRplanner output does not show MitUNet wall review');
    await page.locator('[data-room-summary]').filter({hasText:'predicted room region'}).waitFor();
    const overlayBefore = await page.locator('.fp-trace-canvas').evaluate(canvas => canvas.toDataURL());
    await page.getByLabel('Show predicted rooms', {exact:true}).uncheck();
    assert.notEqual(await page.locator('.fp-trace-canvas').evaluate(canvas => canvas.toDataURL()), overlayBefore, 'predicted room overlay renders on the drawing');
    await page.getByLabel('Show predicted rooms', {exact:true}).check();
    const initial = await page.locator('#fp-segments option').count();
    assert.equal(initial, result.walls.length + 1);
    assert.equal(await page.locator('#fp-scale-confirmed').isChecked(), false, 'large initial size is provisional');
    await tools('Furniture');
    await page.locator('.fp-suggestion button:not(:disabled)').filter({hasText:'Add to model'}).first().waitFor();
    await page.locator('.fp-suggestion button:not(:disabled)').filter({ hasText: 'Add to model' }).first().click();
    await tools('Drawing & scale');
    await page.locator('#fp-scale-confirmed').check();
    await page.locator('.fp-preview-panel .fp-view-options > summary').click();
    await page.locator('.fp-preview-panel').getByRole('button', { name: 'Show full walls', exact: true }).click();
    await page.locator('.fp-preview-panel canvas[data-engine="three"]').waitFor();
    const preview = page.locator('.fp-preview-panel'); await preview.scrollIntoViewIfNeeded();
    assert.ok(await preview.locator('canvas[data-engine="three"]').evaluate(canvas => canvas.clientHeight >= 300 && canvas.clientWidth > 300), 'preview has useful space beside the editor tools');
    await preview.getByRole('button', { name: 'Expand 3D view', exact: true }).click();
    assert.ok(await preview.locator('canvas[data-engine="three"]').evaluate(canvas => canvas.clientWidth > innerWidth * .9), 'large view fills the screen');
    await page.keyboard.press('Escape'); assert.equal(await page.locator('.fp-view-expanded').count(), 0);
    await preview.getByRole('button',{name:'Walk through',exact:true}).click();
    await preview.getByRole('button',{name:'Exit walkthrough',exact:true}).waitFor();
    await preview.screenshot({path:path.join(work,'flrplanner-walkthrough.png')});
    await preview.getByRole('button',{name:'Exit walkthrough',exact:true}).click();
    await preview.getByRole('button',{name:'Walk through',exact:true}).waitFor();
    await preview.screenshot({ path: path.join(work, 'model-recognition-3d.png') });
    assert.ok(await page.locator('.fp-preview-panel canvas[data-engine="three"]').evaluate(canvas => {
      const gl = canvas.getContext('webgl2'); return gl && !gl.isContextLost() && gl.getError() === gl.NO_ERROR;
    }));
    await preview.locator('.fp-exports > summary').click();
    for (const [name, ext] of [['Download 3D model (.obj)','obj'],['Download detailed 3D (.glb)','glb'],['Download layout (.json)','json']]) {
      const download = page.waitForEvent('download'); await page.locator('.fp-preview-panel').getByRole('button', { name, exact: true }).click();
      const received = await download; const output = path.join(work, `model-recognition.${ext}`); await received.saveAs(output);
      const bytes = fs.readFileSync(output);
      if (ext === 'obj') { for(const kind of ['wall','door','glass']) assert.match(bytes.toString(),new RegExp(`o ${kind}_`)); }
      else if (ext === 'json') { const layout=JSON.parse(bytes.toString());assert.equal(layout.unit,'ft');assert.equal(layout.walls.length,result.walls.length);assert.equal(layout.furniture.length,1);
        assert.match(layout.image, /^data:image\/png;base64,/, 'crisp drawings keep their lossless PNG pixels');
        assert.equal(layout.recognition.engine, 'cubicasa5k', 'layout exports retain the restored recognition engine');
        assert.deepEqual(layout.recognition.regions, result.rooms, 'FLRplanner room classifications survive export');
        const span=G.wallSpan(layout);assert.ok(Math.abs(Math.max(span.width,span.depth)-60)<.01, 'building occupies 60 feet regardless of page margins'); }
      else { assert.equal(bytes.readUInt32LE(0), 0x46546c67); assert.equal(bytes.readUInt32LE(8), bytes.length);
        const jsonLength = bytes.readUInt32LE(12); const gltf = JSON.parse(bytes.subarray(20,20+jsonLength).toString());
        assert.ok(gltf.meshes.length > 0); assert.ok(gltf.materials.length > 0); }
    }
    assert.deepEqual(await page.locator('#model-form input').evaluateAll(inputs=>inputs.filter(input=>!input.validity.valid).map(input=>({id:input.id,problem:input.validationMessage}))), [], 'calculated drawing dimensions are accepted by the form');
    await page.getByRole('button', { name: 'Save 3D project', exact: true }).click();
    await page.getByRole('heading', { name: '3D Projects', exact: true }).waitFor();
    assert.equal((await page.evaluate(async () => (await (await fetch('/api/models')).json()).models)).length, 0, 'draft stays private');
    await page.locator('[data-edit-model]').click();
    assert.equal(await page.locator('#fp-segments option').count(), initial);
    assert.equal(await page.locator('#fp-items option').count(), 2);
    assert.equal(await page.locator('[data-wall-review]').isVisible(), false, 'restored FLRplanner output stays outside MitUNet wall review after reopening');
    assert.match(await page.locator('[data-room-summary]').innerText(), /predicted room region/, 'predicted rooms survive saving and reopening');
    const current = await page.locator('#fp-segments option').allTextContents();
    // A disconnected model never replaces a reviewed tracing with local guesses.
    await page.route('**/api/admin/floor-plan-recognition', route => route.request().method() === 'POST'
      ? route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Recognition service unavailable for failure test.'})}) : route.continue());
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Detect walls again', exact: true }).click();
    await page.locator('.fp-status').filter({ hasText: 'Recognition service unavailable for failure test.' }).waitFor();
    assert.deepEqual(await page.locator('#fp-segments option').allTextContents(), current);
    await page.unroute('**/api/admin/floor-plan-recognition');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.fp-source-settings > summary').click();
    await page.locator('.fp-recognition-pipeline').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(work, 'model-recognition-mobile.png') });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile page fits its viewport');
    await page.setViewportSize({ width: 1440, height: 1080 });
    // Restore an exported tracing without losing edits or making another model request.
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#fp-upload').setInputFiles(path.join(work,'model-recognition.json'));
    await page.locator('.fp-status').filter({ hasText: 'Reviewed layout restored.' }).waitFor();
    assert.deepEqual(await page.locator('#fp-segments option').allTextContents(), current);
    const importedCount = analyses.length;
    assert.equal(importedCount, 2, 'JSON import does not run recognition');
    // Previous projects > Edit uses the same real model, large preview and size controls.
    const portfolio = await page.evaluate(async () => {
      const response = await fetch('/api/admin/projects', { method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({title:'Previous project scale verification',completedYear:2025,mainImage:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0XcAAAAASUVORK5CYII='}) });
      if(!response.ok)throw new Error('Could not create isolated portfolio fixture'); return (await response.json()).project;
    });
    await page.reload();
    await page.locator('[data-admin-tab="portfolio"]').click();
    await page.locator(`[data-edit-project="${portfolio.id}"]`).click();
    await section('Floor plan & 3D');
    await page.getByRole('heading',{name:'Floor plan & 3D workspace',exact:true}).waitFor();
    await page.locator('[data-recognition-status]').filter({hasText:'Pretrained recognition is ready'}).waitFor();
    await page.locator('#fp-upload').setInputFiles(fixture);
    await page.locator('.fp-status').filter({hasText:'Pretrained model recognition.'}).waitFor({timeout:95000});
    assert.equal(analyses.length, importedCount+1); assert.equal(analyses.at(-1).status(),200);
    await page.locator('#fp-building-width').fill('80'); await page.locator('#fp-building-width').press('Tab');
    await page.getByRole('button',{name:'Apply building size',exact:true}).click();
    assert.match(await page.locator('[data-building-size-note]').innerText(),/Building: 80\.0/);
    await page.locator('.fp-preview-panel canvas[data-engine="three"]').waitFor();
    await page.locator('.fp-preview-panel').scrollIntoViewIfNeeded();
    await page.locator('.fp-preview-panel').screenshot({path:path.join(work,'portfolio-large-3d.png')});
    await page.getByRole('button',{name:'Save project',exact:true}).click();
    await page.getByRole('heading',{name:'Previous projects',exact:true}).waitFor();
    await page.locator(`[data-edit-project="${portfolio.id}"]`).click();
    await section('Floor plan & 3D');
    await tools('Drawing & scale');
    assert.ok(Math.abs(Number(await page.locator('#fp-building-width').inputValue())-80)<.01, 'portfolio scale persists');
    assert.equal(await page.locator('#fp-recognition').count(), 0, 'legacy structural detection is no longer selectable');
    async function exportLayout(file){
      await page.locator('.fp-exports').evaluate(details=>{details.open=true;});
      const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download layout (.json)',exact:true}).click();
      await(await download).saveAs(path.join(work,file));return JSON.parse(fs.readFileSync(path.join(work,file),'utf8'));
    }
    const wallsBeforeOpenings=(await exportLayout('opening-tool-before.json')).walls.filter(w=>w.kind==='wall');
    await tools('Walls & openings');
    const openingResponse = page.waitForResponse(r => r.url().endsWith('/api/admin/floor-plan-recognition') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Find doors & windows', exact: true }).click();
    assert.equal((await openingResponse).status(), 200, 'opening detection uses the model service');
    await page.locator('.fp-status').filter({ hasText: /Added |No new clear/ }).waitFor();
    assert.deepEqual((await exportLayout('opening-tool-after.json')).walls.filter(w=>w.kind==='wall'),wallsBeforeOpenings,'opening tool preserves exact wall coordinates and metadata');
    assert.deepEqual(legacyRequests, [], 'the live editor never loads legacy structural recognition');
    const stored=await page.evaluate(async id=>(await(await fetch('/api/projects/'+id)).json()).project,portfolio.id);
    assert.equal(stored.floorPlan, null, 'unpublished floor-plan draft is not exposed to visitors');
    // Explicit synthetic review fixture tests acceptance, exclusion and undo;
    // all recognition/extraction/export checks above used the actual checkpoint.
    const review=JSON.parse(fs.readFileSync(path.join(work,'model-recognition.json'),'utf8'));
    review.recognition.engine='mitunet';
    review.recognition.candidates=[{kind:'wall',a:[.32,.54],b:[.52,.54],confidence:.7,reason:'Low wall confidence'}];
    review.recognition.annotations=[{type:'measurement-text',text:'12 ft',confidence:.9,polygon:[[.05,.05],[.15,.05],[.15,.09],[.05,.09]]}];
    review.recognition.summary={textRegions:1,dimensionLines:0,symbolRegions:0,removedPixels:0,reviewSegments:1};
    const reviewPath=path.join(work,'wall-review-browser.json');fs.writeFileSync(reviewPath,JSON.stringify(review));
    page.once('dialog',dialog=>dialog.accept());await page.locator('#fp-upload').setInputFiles(reviewPath);
    await page.locator('.fp-status').filter({hasText:'Reviewed layout restored.'}).waitFor();
    assert.equal(await page.locator('[data-wall-review]').isVisible(), true, 'saved MitUNet projects retain their review controls');
    const annotationBefore=await page.locator('.fp-trace-canvas').evaluate(canvas=>canvas.toDataURL());
    await page.getByLabel('Show ignored measurements and text',{exact:true}).check();
    assert.notEqual(await page.locator('.fp-trace-canvas').evaluate(canvas=>canvas.toDataURL()),annotationBefore,'saved MitUNet annotation review still renders');
    await page.getByLabel('Show ignored measurements and text',{exact:true}).uncheck();
    const reviewCount=await page.locator('#fp-segments option').count();
    assert.equal(await page.getByRole('button',{name:'Add reviewed wall',exact:true}).count(),1);
    const candidateBefore=await page.locator('.fp-trace-canvas').evaluate(canvas=>canvas.toDataURL());
    await page.getByLabel('Show uncertain walls',{exact:true}).uncheck();
    assert.notEqual(await page.locator('.fp-trace-canvas').evaluate(canvas=>canvas.toDataURL()),candidateBefore);
    await page.getByRole('button',{name:'Add reviewed wall',exact:true}).click();
    assert.equal(await page.locator('#fp-segments option').count(),reviewCount+1);
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    assert.equal(await page.locator('#fp-segments option').count(),reviewCount);
    assert.equal(await page.getByRole('button',{name:'Add reviewed wall',exact:true}).count(),1);
    assert.deepEqual(errors, []);
    const summary = { pass: true, engine: result.engine, counts: {
      walls: result.walls.filter(w=>w.kind==='wall').length, doors: result.walls.filter(w=>w.kind==='door').length,
      windows: result.walls.filter(w=>w.kind==='window').length, fixtures: result.furniture.length, rooms: result.rooms.length },
      inferenceMs: result.inferenceMs, exports: ['OBJ','GLB','JSON'], draftReopened: true, serviceFailurePreservedEdits: true, largePreview: true,
      initialBuildingLongSideFeet:60, layoutImportPreservedEdits:true, previousProjectModelRecognition:true, previousProjectScalePersisted:true,
      losslessDrawing:true, flrplannerAutomaticImport:true, predictedRoomOverlayRendered:true, predictedRoomsPersisted:true,
      savedMitUNetAnnotationOverlayRendered:true, savedMitUNetReviewPreserved:true,
      uncertainWallAcceptanceAndUndo:true, automaticFurnitureSuggestions:true, browserErrors: errors };
    summary.recognizedModelWalkthrough=true;
    fs.writeFileSync(path.join(work, 'browser-verification.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary));
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
    // Restrict cleanup to this harness's freshly created workspace directory.
    if (!dir.startsWith(work + path.sep) || path.dirname(dir) !== work) throw new Error('Unsafe cleanup path.');
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
