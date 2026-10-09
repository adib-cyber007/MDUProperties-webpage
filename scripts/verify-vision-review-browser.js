'use strict';
// Synthetic reviewer responses exercise the shared editor; they prove no model accuracy.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'), work=path.join(root,'work');
fs.mkdirSync(work,{recursive:true});
const dir=fs.mkdtempSync(path.join(work,'vision-browser-'));
fs.cpSync(path.join(root,'public'),path.join(dir,'public'),{recursive:true});
for(const file of ['server.js', 'seo.js','telegram-bot.js','floor-plan-recognition.js'])fs.copyFileSync(path.join(root,file),path.join(dir,file));
for(const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','VERCEL','TELEGRAM_BOT_TOKEN','AI_DESIGN_API_KEY','OPENAI_API_KEY'])delete process.env[key];
process.env.NODE_ENV='production';process.env.ADMIN_PASSWORD='vision-browser-test';
const walls=[{kind:'wall',a:[.15,.25],b:[.85,.25]}, {kind:'wall',a:[.85,.25],b:[.85,.85]},
  {kind:'wall',a:[.85,.85],b:[.15,.85]}, {kind:'wall',a:[.15,.85],b:[.15,.25]},
  {kind:'wall',a:[.3,.12],b:[.7,.12]}];
const flag=(wall,real)=>({a:wall.a,b:wall.b,cropBounds:real?[.05,.15,.95,.4]:[.2,.04,.8,.2],
  classification:real?'description-box':'measurement-line',score:null,reason:real?'Scripted mistake on a genuine wall':'Scripted dimension rail',
  evidence:{connected:real,thickSupport:real,coloredSupport:false},decision:'pending'});
const requests=[];
let failReview=false;
const recognizer=http.createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.url==='/health')return res.end(JSON.stringify({ready:true,engine:'cubicasa5k',visionReview:{enabled:true,provider:'ollama'}}));
  if(req.url!=='/analyze'){res.statusCode=404;return res.end('{}');}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const body=JSON.parse(Buffer.concat(chunks));requests.push(body);
  res.end(JSON.stringify({engine:'cubicasa5k',walls,furniture:[],rooms:[],inferenceMs:1,
    ...(body.visionReview?{visionReview:{state:failReview?'unavailable':'complete',provider:'ollama',model:'scripted-test',
      reviewed:failReview?0:2,totalCandidates:2,items:failReview?[]:[flag(walls[0],true),flag(walls[4],false)],automaticRemovals:0}}:{})}));
});

async function run(){
  let site,browser,page;
  const errors=[],checks=[];
  try{
    await new Promise(resolve=>recognizer.listen(0,'127.0.0.1',resolve));
    process.env.FLOORPLAN_RECOGNITION_URL=`http://127.0.0.1:${recognizer.address().port}`;
    site=require(path.join(dir,'server.js'));
    await new Promise(resolve=>site.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${site.address().port}`;
    browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?
      {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:process.platform==='win32'?{channel:'msedge'}:{})});
    page=await browser.newPage({viewport:{width:1440,height:1000}});
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.addInitScript(()=>{
      let api;
      Object.defineProperty(window,'FloorPlanUI',{configurable:true,get:()=>api,set:value=>{
        const original=value.createEditor;
        value.createEditor=(...args)=>{const editor=original(...args);window.__visionEditor=editor;return editor;};api=value;
      }});
    });
    await page.goto(base+'/admin');await page.locator('#owner-password').fill('vision-browser-test');
    await page.getByRole('button',{name:'Open dashboard'}).click();
    await page.locator('[data-admin-tab="models"]').click();await page.locator('#add-model').click();
    await page.locator('#model-title').fill('Local vision review verification');
    await page.getByRole('tablist',{name:'Property editor sections'}).getByRole('tab',{name:'Floor plan & 3D',exact:true}).click();
    await page.locator('[data-recognition-status]').filter({hasText:'Pretrained recognition is ready'}).waitFor();
    const drawing=await page.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=400;canvas.height=300;
      const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,400,300);
      context.strokeStyle='#555';context.lineWidth=9;context.strokeRect(60,75,280,180);
      context.lineWidth=1;context.beginPath();context.moveTo(120,36);context.lineTo(280,36);context.stroke();
      context.fillStyle='#111';context.font='12px sans-serif';context.fillText('12 ft',180,30);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.locator('#fp-upload').setInputFiles({name:'synthetic-plan.png',mimeType:'image/png',buffer:Buffer.from(drawing,'base64')});
    await page.locator('.fp-status').filter({hasText:'Pretrained model recognition.'}).waitFor();
    await page.getByRole('tablist',{name:'Floor editor tools'}).getByRole('tab',{name:'Walls & openings',exact:true}).click();
    const layout=()=>page.evaluate(()=>window.__visionEditor.getValue());
    const baseline=await layout();
    assert.equal(requests.length,1);assert.equal(requests[0].visionReview,undefined);
    assert.equal(await page.locator('[data-vision-review]').isVisible(),false);
    await page.locator('.fp-source-settings > summary').click();
    await page.locator('.fp-source-settings > .workspace-disclosure > summary').click();
    await page.locator('[data-vision-enabled]').check();
    await page.locator('[data-action="detect"]').click();
    await page.locator('[data-vision-summary]').filter({hasText:'2 flags awaiting your review'}).waitFor();
    assert.deepEqual((await layout()).walls,baseline.walls);
    assert.equal(requests[1].visionReview,true);
    checks.push('opt-in adds flags while preserving original geometry');
    assert.equal(await page.locator('.fp-vision-crop').count(),2);
    assert.ok(await page.locator('.fp-vision-crop').first().evaluate(canvas=>canvas.width>0 && canvas.height>0));
    await page.locator('[data-vision-items]').getByRole('button',{name:'Keep wall',exact:true}).first().click();
    assert.deepEqual((await layout()).walls,baseline.walls);
    assert.equal((await layout()).recognition.visionReview.items[0].decision,'kept');
    checks.push('genuine wall survives a deliberately wrong reviewer judgment');
    await page.locator('[data-vision-items]').getByRole('button',{name:'Remove wall',exact:true}).click();
    assert.equal((await layout()).walls.length,baseline.walls.length-1);
    await page.locator('[data-action="undo"]').click();
    assert.deepEqual((await layout()).walls,baseline.walls);
    assert.equal((await layout()).recognition.visionReview.items[1].decision,'pending');
    checks.push('manual removal and undo preserve the review state');
    await page.getByRole('button',{name:'Save 3D project',exact:true}).click();
    await page.getByRole('heading',{name:'3D Projects',exact:true}).waitFor();
    await page.locator('[data-edit-model]').first().click();
    await page.getByRole('tablist',{name:'Floor editor tools'}).getByRole('tab',{name:'Walls & openings',exact:true}).click();
    await page.locator('[data-vision-items]').getByRole('button',{name:'Remove wall',exact:true}).waitFor();
    assert.equal((await layout()).recognition.visionReview.items[0].decision,'kept');
    checks.push('saved review decisions and contextual crops reopen');
    await page.setViewportSize({width:390,height:844});
    await page.locator('[data-vision-review]').scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:path.join(work,'vision-review-mobile.png')});
    checks.push('review controls fit mobile');
    failReview=true;
    await page.locator('.fp-source-settings > summary').click();
    await page.locator('.fp-source-settings > .workspace-disclosure > summary').click();
    await page.locator('[data-vision-enabled]').check();await page.locator('[data-action="detect"]').click();
    await page.locator('[data-vision-summary]').filter({hasText:'reviewer was unavailable'}).waitFor();
    assert.deepEqual((await layout()).walls,baseline.walls);
    checks.push('unavailable reviewer leaves valid extraction intact');
    assert.deepEqual(errors,[]);
    const report={pass:true,synthetic:true,checks,browserErrors:errors,accuracyValidated:false};
    fs.writeFileSync(path.join(work,'vision-review-browser-report.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  }catch(error){if(page)await page.screenshot({path:path.join(work,'vision-review-failure.png')}).catch(()=>{});throw error;}
  finally{
    await browser?.close();
    if(site?.listening)await new Promise(resolve=>site.close(resolve));
    if(recognizer.listening)await new Promise(resolve=>recognizer.close(resolve));
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
