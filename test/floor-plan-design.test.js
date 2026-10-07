'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const D=require('../public/floor-plan-design'),G=require('../public/floor-plan-geometry'),F=require('../public/floor-plan-finishes');
const {createDesigner}=require('../floor-plan-ai');
const image='data:image/png;base64,AAAA';
const floor=()=>({version:1,image,width:30,depth:40,height:10,thickness:.5,openingDetectionVersion:4,walls:[{kind:'wall',a:[.1,.1],b:[.9,.1]},{kind:'wall',a:[.9,.1],b:[.9,.9]},{kind:'door',a:[.3,.1],b:[.4,.1],hinge:'a',swing:1},{kind:'wall',a:[.9,.9],b:[.1,.9]},{kind:'wall',a:[.1,.9],b:[.1,.1]},{kind:'wall',a:[.5,.1],b:[.5,.9]}],furniture:[{type:'bed',center:[.5,.5],width:5,depth:6.5,rotation:0}]});
const house=()=>G.validate({version:2,floors:[{plan:floor()},{plan:floor(),offsetX:2},{plan:null}]});
const request=(model=house(),extra={})=>D.validateRequest({context:D.context(model),style:'surprise',wallLook:'mixed',brief:'',...extra});

test('local designs coordinate every populated floor, preserve geometry and optional individual finishes',()=>{
  const model=house();model.floors[0].plan.walls[0].finish=F.PRESETS.wall[5].finish;
  for(const style of Object.keys(D.STYLES))for(const wallLook of ['mixed','paint','wallpaper']) {
    const req=request(model,{style,wallLook}),design=D.localDesign(req,()=>.5),next=D.applyDesign(model,design);
    assert.ok(next.floors[0].plan.finishes.floor);assert.deepEqual(next.floors[0].plan.finishes,next.floors[1].plan.finishes);
    assert.deepEqual(next.floors[0].plan.walls[0].finish,model.floors[0].plan.walls[0].finish);
    assert.equal(next.floors[2].plan,null);
    const strip=value=>value.floors.map(f=>f.plan?{...f.plan,finishes:undefined,walls:f.plan.walls.map(({finish,exteriorFinish,...wall})=>wall)}:null);
    assert.deepEqual(strip(next),strip(model));
    const again=D.localDesign({...req,previous:design.title},()=>.5);assert.notEqual(again.title,design.title);
  }
  const design=D.localDesign(request(model),()=>0),next=D.applyDesign(model,design,{keepOverrides:false});
  assert.notDeepEqual(next.floors[0].plan.walls[0].finish,model.floors[0].plan.walls[0].finish);
  assert.deepEqual(model.floors[0].plan.walls[0].finish,F.PRESETS.wall[5].finish,'applying a design does not mutate the undo snapshot');
});

test('invalid input, unsupported surface patterns and nonexistent AI accent walls are rejected',()=>{
  const req=request(),design=D.localDesign(req,()=>0);
  for(const bad of [{...req,style:'unknown'},{...req,brief:'x'.repeat(241)},{...req,context:{floors:[]}},{...req,context:{floors:[{...req.context.floors[0],walls:[{index:0,a:[-1,0],b:[1,0]}]}]}}])assert.throws(()=>D.validateRequest(bad),{status:400});
  for(const bad of [{...design,accents:[{...design.accents[0],wallIndex:249}]},{...design,finishes:{...design.finishes,floor:{...design.finishes.floor,pattern:'botanical'}}},{...design,finishes:{...design.finishes,wall:{...design.finishes.wall,color:'red'}}},{...design,accents:[design.accents[0],design.accents[0]]}])assert.throws(()=>D.validateDesign(bad,req),{status:400});
});

test('missing provider key uses honestly labeled local palettes without making an external request',async()=>{
  const result=await createDesigner({apiKey:'',fetchImpl:()=>assert.fail('no provider request expected')}).generate(request());
  assert.equal(result.source,'local');assert.ok(result.design.finishes.wall);
});

test('regeneration preserves individual, floor-wide, inherited and uploaded locked finishes across floors',()=>{
  const model=house(),ground=model.floors[0].plan,upper=model.floors[1].plan;
  const custom={...F.DEFAULTS.floor,pattern:'custom',texture:image,color:'#123456',scale:2.5,rotation:45};
  ground.finishes={wall:F.PRESETS.wall[5].finish,floor:custom,ceiling:F.PRESETS.ceiling[6].finish};
  ground.finishLocks={floor:true,ceiling:true};ground.walls[0].finishLocked=true;
  upper.finishes={wall:F.PRESETS.wall[7].finish};upper.finishLocks={wall:true};
  upper.walls[0].finish={...custom,color:'#789abc'};
  const req=request(model),design=D.localDesign(req,()=>0),next=D.applyDesign(model,design,{keepOverrides:false});
  assert.ok(!design.accents.some(a=>a.floorIndex===0&&a.wallIndex===0));assert.ok(!design.accents.some(a=>a.floorIndex===1));
  assert.deepEqual(next.floors[0].plan.finishes.floor,custom);assert.deepEqual(next.floors[0].plan.finishes.ceiling,ground.finishes.ceiling);
  assert.deepEqual(next.floors[0].plan.walls[0].finish,ground.finishes.wall,'a locked inherited wall keeps its old effective finish');
  assert.deepEqual(next.floors[0].plan.walls[0].exteriorFinish,F.DEFAULTS.exterior,'the same wall lock also preserves its outdoor face');
  assert.notDeepEqual(next.floors[0].plan.finishes.wall,ground.finishes.wall,'other wall designs regenerate');
  assert.deepEqual(next.floors[1].plan.finishes.wall,upper.finishes.wall);assert.deepEqual(next.floors[1].plan.walls,upper.walls);
  assert.ok(next.floors[1].plan.finishes.floor);assert.deepEqual(next.floors[0].plan.finishLocks,ground.finishLocks);
  assert.equal(next.floors[0].plan.walls[0].finishLocked,true);
  const wire=JSON.stringify(req);assert.doesNotMatch(wire,/data:image|texture/);assert.match(wire,/lockedFinish/);
  const unlocked=structuredClone(next);unlocked.floors[0].plan.finishLocks.floor=false;unlocked.floors[0].plan.walls[0].finishLocked=false;
  const second=D.applyDesign(unlocked,D.localDesign(request(unlocked,{previous:design.title}),()=>0),{keepOverrides:false});
  assert.notDeepEqual(second.floors[0].plan.finishes.floor,custom);assert.notDeepEqual(second.floors[0].plan.walls[0].finish,next.floors[0].plan.walls[0].finish);
});

test('lock validation rejects malformed flags, prevents locked AI accents, and handles all-protected houses',()=>{
  const model=house();model.floors[0].plan.walls[0].finishLocked=true;
  const req=request(model),design=D.localDesign(req,()=>0);
  assert.throws(()=>D.validateDesign({...design,accents:[{floorIndex:0,wallIndex:0,finish:design.finishes.wall}]},req),/locked wall/);
  for(const value of ['true',1,null]) {
    assert.throws(()=>G.validate({...floor(),finishLocks:{floor:value}}),{status:400});
    const input=floor();input.walls[0].finishLocked=value;assert.throws(()=>G.validate(input),{status:400});
  }
  const door=floor();door.walls[2].finishLocked=true;assert.throws(()=>G.validate(door),{status:400});
  model.floors.filter(f=>f.plan).forEach(f=>{f.plan.finishLocks={wall:true,floor:true,ceiling:true};});
  assert.equal(D.lockState(model).unlocked,false);assert.throws(()=>request(model),/Unlock at least/);
  model.floors[1].plan.finishLocks.floor=false;assert.equal(D.lockState(model).unlocked,true);assert.doesNotThrow(()=>request(model));
});

test('compatible providers receive bounded geometry summaries and validated JSON applies as an AI design',async()=>{
  const req=request(),design=D.localDesign(req,()=>0);let sent;
  const designer=createDesigner({apiKey:'test-key',baseUrl:'https://provider.example/v1/',model:'provider-model',fetchImpl:async(url,init)=>{
    sent={url,...init,body:JSON.parse(init.body)};
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(design)}}]}));
  }});
  const response=await designer.generate(req);assert.equal(response.source,'ai');assert.deepEqual(response.design,design);
  assert.equal(sent.url,'https://provider.example/v1/chat/completions');assert.equal(sent.headers.authorization,'Bearer test-key');
  assert.equal(sent.body.model,'provider-model');assert.equal(sent.body.response_format.type,'json_object');
  assert.doesNotMatch(sent.body.messages[1].content,/data:image|texture/,'drawing images and uploaded wallpapers are not transmitted');
  const invalid=createDesigner({apiKey:'test-key',baseUrl:'http://provider.example/v1',fetchImpl:()=>assert.fail('insecure endpoint cannot receive credentials')});
  await assert.rejects(invalid.generate(req),{status:503});
});

test('AI failures, refusals, truncation and unsafe designs leave the existing model untouched',async()=>{
  const model=house(),before=JSON.stringify(model),req=request(model),design=D.localDesign(req,()=>0);
  for(const payload of [
    {choices:[{finish_reason:'length',message:{content:JSON.stringify(design)}}]},
    {choices:[{finish_reason:'stop',message:{refusal:'No',content:''}}]},
    {choices:[{finish_reason:'stop',message:{content:'not JSON'}}]},
    {choices:[{finish_reason:'stop',message:{content:JSON.stringify({...design,accents:[{floorIndex:99,wallIndex:99,finish:design.finishes.wall}]})}}]}
  ])await assert.rejects(createDesigner({apiKey:'test-key',fetchImpl:async()=>new Response(JSON.stringify(payload))}).generate(req),{status:502});
  await assert.rejects(createDesigner({apiKey:'test-key',fetchImpl:async()=>new Response('private token info',{status:401})}).generate(req),e=>e.status===502&&!e.message.includes('private'));
  const result=await createDesigner({apiKey:'test-key',protocol:'responses',fetchImpl:async(url,init)=>{
    assert.match(url,/\/responses$/);assert.equal(JSON.parse(init.body).text.format.type,'json_schema');
    return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(design)}]}]}));
  }}).generate(req);
  assert.equal(result.source,'ai');assert.equal(JSON.stringify(model),before);
});

test('the designer endpoint requires owner access and does not save or publish a generated design',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mdu-design-'));fs.mkdirSync(path.join(dir,'public'));
  for(const file of ['server.js','telegram-bot.js','floor-plan-ai.js','public/floor-plan-design.js','public/floor-plan-geometry.js','public/floor-plan-finishes.js'])fs.copyFileSync(path.join(__dirname,'..',file),path.join(dir,file));
  const keys=['ADMIN_PASSWORD','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','VERCEL','OPENAI_API_KEY','AI_DESIGN_API_KEY'];const env=Object.fromEntries(keys.map(k=>[k,process.env[k]]));keys.forEach(k=>delete process.env[k]);process.env.ADMIN_PASSWORD='design-test';
  const server=require(path.join(dir,'server.js'));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));keys.forEach(k=>env[k]===undefined?delete process.env[k]:process.env[k]=env[k]);fs.rmSync(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`,body=JSON.stringify(request());
  assert.equal((await fetch(base+'/api/admin/design-surprise',{method:'POST',body})).status,401);
  const login=await fetch(base+'/api/login',{method:'POST',body:JSON.stringify({password:'design-test'})}),cookie=login.headers.get('set-cookie').split(';')[0];
  const headers={cookie,'content-type':'application/json'};
  const before=await(await fetch(base+'/api/admin/data',{headers})).json();
  const result=await fetch(base+'/api/admin/design-surprise',{method:'POST',headers,body});assert.equal(result.status,200);assert.equal((await result.json()).source,'local');
  const after=await(await fetch(base+'/api/admin/data',{headers})).json();assert.deepEqual(after,before);
  const invalid=await fetch(base+'/api/admin/design-surprise',{method:'POST',headers,body:JSON.stringify({style:'surprise'})});assert.equal(invalid.status,400);
  const dense=floor();dense.walls=Array.from({length:250},(_,i)=>({...dense.walls[0],outside:'none',finish:F.DEFAULTS.wall,exteriorFinish:F.DEFAULTS.exterior,finishLocked:true}));
  const full=G.validate({version:2,floors:Array.from({length:8},()=>({plan:dense}))}),fullBody=JSON.stringify(request(full));
  assert.ok(Buffer.byteLength(fullBody)>80000,'multi-floor protected face summaries exceed the old body limit');
  const large=await fetch(base+'/api/admin/design-surprise',{method:'POST',headers,body:fullBody});assert.equal(large.status,200);assert.equal((await large.json()).source,'local');
  const locked=house();locked.floors[0].plan.finishLocks={floor:true};locked.floors[0].plan.walls[0].finishLocked=true;
  const saved=await fetch(base+'/api/admin/models',{method:'POST',headers,body:JSON.stringify({title:'Persistent locks',floorPlan:locked})});
  assert.equal(saved.status,201);const record=(await saved.json()).model;
  assert.deepEqual(record.floorPlan.floors[0].plan.finishLocks,{floor:true});assert.equal(record.floorPlan.floors[0].plan.walls[0].finishLocked,true);
  const reopened=await(await fetch(base+'/api/admin/data',{headers})).json();assert.deepEqual(reopened.models.find(m=>m.id===record.id).floorPlan,record.floorPlan);
});
