'use strict';
// Actual supplied images, actual recognition service, isolated test store.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const [first,second]=process.argv.slice(2).map(file=>path.resolve(file));
if(!first||!second||![first,second].every(fs.existsSync))throw new Error('Pass both floor-plan image paths.');
const work=path.join(root,'work');fs.mkdirSync(work,{recursive:true});
const dir=fs.mkdtempSync(path.join(work,'colored-browser-'));
fs.cpSync(path.join(root,'public'),path.join(dir,'public'),{recursive:true});
for(const file of ['server.js','telegram-bot.js','floor-plan-recognition.js'])fs.copyFileSync(path.join(root,file),path.join(dir,file));
for(const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','VERCEL','TELEGRAM_BOT_TOKEN','AI_DESIGN_API_KEY','OPENAI_API_KEY'])delete process.env[key];
process.env.ADMIN_PASSWORD='colored-browser-test';
process.env.FLOORPLAN_RECOGNITION_URL||='http://127.0.0.1:8765';
const server=require(path.join(dir,'server.js'));

(async()=>{
  let browser;
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    browser=await chromium.launch({...process.platform==='win32'?{channel:'msedge'}:{},headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1080},acceptDownloads:true});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/admin');await page.locator('#owner-password').fill('colored-browser-test');
    await page.getByRole('button',{name:'Open dashboard'}).click();
    await page.locator('[data-admin-tab="models"]').click();await page.locator('#add-model').click();
    await page.locator('#model-title').fill('Two-path recognition verification');
    await page.getByRole('tablist',{name:'Property editor sections'}).getByRole('tab',{name:'Floor plan & 3D',exact:true}).click();
    await page.locator('[data-recognition-status]').filter({hasText:'Pretrained recognition is ready'}).waitFor();
    const recognition=()=>page.waitForResponse(r=>r.url().endsWith('/api/admin/floor-plan-recognition')&&r.request().method()==='POST');
    let response=recognition();await page.locator('#fp-upload').setInputFiles(first);
    let received=await response;assert.equal(received.status(),200);const originalAuto=await received.json();
    await page.locator('.fp-status').filter({hasText:'Pretrained model recognition.'}).waitFor({timeout:95000});
    assert.equal(originalAuto.engine,'cubicasa5k');
    const sent=JSON.parse(received.request().postData());
    const forcedOriginal=await page.evaluate(async body=>{
      const r=await fetch('/api/admin/floor-plan-recognition',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,profile:'standard'})});
      if(!r.ok)throw new Error('Original comparison failed');return r.json();
    },sent);
    for(const key of ['engine','walls','furniture','rooms'])assert.deepEqual(originalAuto[key],forcedOriginal[key],`first image ${key} unchanged`);
    assert.ok(await page.locator('.fp-suggestion').count()>0,'original fixture/furniture proposals remain');

    page.once('dialog',dialog=>dialog.accept());
    response=recognition();await page.locator('#fp-upload').setInputFiles(second);
    received=await response;assert.equal(received.status(),200);const colored=await received.json();
    await page.locator('.fp-status').filter({hasText:'Coloured wall recognition.'}).waitFor({timeout:95000});
    assert.equal(colored.engine,'color-walls');assert.equal(colored.sources.walls,'color-geometry');
    const counts=Object.fromEntries(['wall','door','window'].map(kind=>[kind,colored.walls.filter(w=>w.kind===kind).length]));
    assert.ok(counts.wall>=20);assert.ok(counts.door>0);assert.ok(counts.window>0);
    for(const wall of colored.walls){
      assert.ok(Math.abs(wall.a[0]-wall.b[0])<1e-6||Math.abs(wall.a[1]-wall.b[1])<1e-6,'coloured geometry stays straight');
      assert.ok([wall.a,wall.b].every(p=>p[0]>.26&&p[0]<.76&&p[1]>.21&&p[1]<.625),'phone UI, frame and dimension margins excluded');
    }
    await page.getByRole('tablist',{name:'Floor editor tools'}).getByRole('tab',{name:'Drawing & scale',exact:true}).click();
    await page.locator('#fp-scale-confirmed').check();
    const preview=page.locator('.fp-preview-panel');await preview.locator('canvas[data-engine="three"]').waitFor();
    await preview.locator('.fp-view-options > summary').click();
    await preview.locator('.fp-exports > summary').click();
    await preview.getByRole('button',{name:'Show full walls',exact:true}).click();
    await preview.scrollIntoViewIfNeeded();await preview.screenshot({path:path.join(work,'colored-wall-3d.png')});
    await preview.getByRole('button',{name:'Walk through',exact:true}).click();
    await preview.getByRole('button',{name:'Exit walkthrough',exact:true}).waitFor();
    await preview.getByRole('button',{name:'Exit walkthrough',exact:true}).click();
    let exported;
    for(const [name,ext] of [['Download layout (.json)','json'],['Download 3D model (.obj)','obj'],['Download detailed 3D (.glb)','glb']]){
      const download=page.waitForEvent('download');await preview.getByRole('button',{name,exact:true}).click();
      const file=path.join(work,`colored-wall-model.${ext}`);await(await download).saveAs(file);
      const bytes=fs.readFileSync(file);
      if(ext==='json'){exported=JSON.parse(bytes.toString());assert.equal(exported.recognition.engine,'color-walls');assert.deepEqual(exported.walls,colored.walls);}
      else if(ext==='obj'){for(const kind of ['wall','door','glass'])assert.match(bytes.toString(),new RegExp(`o ${kind}_`));}
      else {assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(8),bytes.length);}
    }
    await page.getByRole('button',{name:'Save 3D project',exact:true}).click();
    await page.getByRole('heading',{name:'3D Projects',exact:true}).waitFor();await page.locator('[data-edit-model]').click();
    assert.equal(await page.locator('#fp-segments option').count(),colored.walls.length+1);
    await page.setViewportSize({width:390,height:844});
    await page.locator('.fp-source-settings > summary').click();
    await page.locator('.fp-source-settings > .workspace-disclosure > summary').click();
    await page.locator('#fp-recognition-method').scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:path.join(work,'colored-wall-mobile.png')});
    await page.setViewportSize({width:1440,height:1080});
    const stored=await page.evaluate(async()=>{
      const r=await fetch('/api/admin/data');return (await r.json()).models;
    });
    const saved=stored[0].floorPlan.version===2?stored[0].floorPlan.floors[0].plan:stored[0].floorPlan;
    assert.equal(saved.recognition.engine,'color-walls');
    assert.deepEqual(saved.walls,exported.walls);
    assert.deepEqual(errors,[]);
    const report={pass:true,firstImageOutputUnchanged:true,automaticProfileRouting:true,secondImageEngine:colored.engine,
      secondImageCounts:counts,straightGeometry:true,annotationMarginsExcluded:true,exports:['JSON','OBJ','GLB'],
      recognizedModelWalkthrough:true,draftReopened:true,mobileFits:true,browserErrors:errors};
    fs.writeFileSync(path.join(work,'colored-browser-verification.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  }finally{
    await browser?.close();await new Promise(resolve=>server.close(resolve));
    if(path.dirname(dir)!==work||!dir.startsWith(work+path.sep))throw new Error('Unsafe cleanup path');
    fs.rmSync(dir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
