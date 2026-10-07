'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const G = require('../public/floor-plan-geometry');
const F = require('../public/floor-plan-finishes');
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=';
const plan = () => ({version:1,image,width:30,depth:40,height:10,thickness:.5,walls:[{kind:'wall',a:[.1,.1],b:[.9,.1]}]});
const custom = {...F.DEFAULTS.wall,pattern:'custom',color:'#ffffff',texture:image,scale:2.5,rotation:45};

test('all color and material presets can be saved as valid surface finishes', () => {
  assert.ok(F.COLORS.length>=60);assert.ok(Object.values(F.PRESETS).flat().length>=50);
  for(const {color} of F.COLORS) assert.equal(G.validateFinish({...F.DEFAULTS.wall,color}).color,color);
  for(const presets of Object.values(F.PRESETS))for(const {finish} of presets)assert.deepEqual(G.validateFinish(finish),finish);
  assert.equal(G.validate(plan()).finishes,undefined,'older plans use renderer defaults without rewriting stored data');
});

test('wall overrides, custom uploads and per-floor finishes survive validation and wall cutting', () => {
  const input={...plan(),finishes:{wall:custom,floor:F.PRESETS.floor[15].finish,ceiling:F.PRESETS.ceiling[6].finish}};
  input.walls[0].finish=F.PRESETS.wall[17].finish;
  input.walls.push({kind:'door',a:[.3,.1],b:[.4,.1]});
  const saved=G.validate(input);
  assert.deepEqual(saved.finishes,input.finishes);assert.deepEqual(saved.walls[0].finish,input.walls[0].finish);
  assert.equal(G.cutWalls(saved).filter(w=>w.kind==='wall').length,2);
  assert.ok(G.cutWalls(saved).filter(w=>w.kind==='wall').every(w=>w.finish===saved.walls[0].finish));
  assert.ok(G.boxes(saved).filter(b=>b.material==='wall'&&b.height===10).every(b=>b.finish===saved.walls[0].finish));
  const upper={...plan(),finishes:{floor:F.PRESETS.floor[12].finish,ceiling:custom}};
  const building=G.validate({version:2,floors:[{plan:saved},{plan:upper}]});
  assert.deepEqual(building.floors[1].plan.finishes,upper.finishes);
  assert.notDeepEqual(building.floors[0].plan.finishes,building.floors[1].plan.finishes);
  assert.doesNotMatch(G.toOBJ(building),/NaN|Infinity/);
});

test('unsafe texture sources, malformed colors and excessive image budgets are rejected', () => {
  for(const finish of [
    {...custom,texture:'https://example.com/paper.png'}, {...custom,texture:'data:image/svg+xml;base64,PHN2Zz4='},
    {...custom,texture:'data:text/html;base64,AAAA'}, {...custom,texture:'data:image/png;base64,'+'A'.repeat(700000)},
    {...custom,color:'red'}, {...custom,accent:'#abc'}, {...custom,scale:0}, {...custom,rotation:NaN},
    {...custom,pattern:'script'}, {...custom,scale:Infinity}, null
  ])assert.throws(()=>G.validate({...plan(),finishes:{wall:finish}}),{status:400});
  assert.throws(()=>G.validate({...plan(),walls:[{kind:'window',a:[.1,.1],b:[.2,.1],finish:custom}]}),/only.*walls/);
  const big={...custom,texture:'data:image/png;base64,'+'A'.repeat(650000)};
  const input={...plan(),walls:Array.from({length:8},(_,i)=>({kind:'wall',a:[.1,.1+i*.05],b:[.9,.1+i*.05],finish:big}))};
  assert.throws(()=>G.validate(input),/too many texture/);
});

test('saved finishes round-trip through private and public project APIs without changing other projects', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mdu-finishes-'));
  fs.mkdirSync(path.join(dir,'public'));
  for(const file of ['server.js','telegram-bot.js','public/floor-plan-geometry.js'])fs.copyFileSync(path.join(__dirname,'..',file),path.join(dir,file));
  const keys=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','VERCEL','ADMIN_PASSWORD'];
  const env=Object.fromEntries(keys.map(k=>[k,process.env[k]]));keys.forEach(k=>delete process.env[k]);process.env.ADMIN_PASSWORD='finish-test';
  const server=require(path.join(dir,'server.js'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));keys.forEach(k=>env[k]===undefined?delete process.env[k]:process.env[k]=env[k]);fs.rmSync(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const login=await fetch(base+'/api/login',{method:'POST',body:JSON.stringify({password:'finish-test'})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const call=(url,method='GET',body)=>fetch(base+url,{method,headers:{cookie,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const finishes={wall:custom,floor:F.PRESETS.floor[15].finish,ceiling:F.PRESETS.ceiling[6].finish};
  const first=await call('/api/admin/models','POST',{title:'Finish test',floorPlan:{...plan(),finishes,published:false}});
  assert.equal(first.status,201);const {model}=await first.json();
  assert.deepEqual(model.floorPlan.finishes,finishes);
  assert.equal((await call('/api/models/'+model.id)).status,404);
  const second=await call('/api/admin/models','POST',{title:'Separate model',floorPlan:plan()});const secondId=(await second.json()).model.id;
  const published=await call('/api/admin/models/'+model.id,'PUT',{floorPlan:{...plan(),finishes,published:true}});assert.equal(published.status,200);
  assert.deepEqual((await(await call('/api/models/'+model.id)).json()).model.floorPlan.finishes,finishes);
  const bad=await call('/api/admin/models/'+model.id,'PUT',{floorPlan:{...plan(),finishes:{floor:{...custom,texture:'javascript:alert(1)'}}}});
  assert.equal(bad.status,400);
  const saved=(await(await call('/api/admin/data')).json()).models;
  assert.equal(saved.find(m=>m.id===secondId).floorPlan.finishes,undefined);
  assert.deepEqual(saved.find(m=>m.id===model.id).floorPlan.finishes,finishes);
});
