'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRecognizer } = require('../floor-plan-recognition');
const image = 'data:image/png;base64,AAAA';
const body = { image, width: 30, depth: 40 };
const result = { engine: 'cubicasa5k', walls: [{kind:'wall',a:[.1,.1],b:[.9,.1]}, {kind:'wall',a:[.9,.1],b:[.9,.9]},
  {kind:'wall',a:[.9,.9],b:[.1,.9]}, {kind:'wall',a:[.1,.9],b:[.1,.1]}, {kind:'door',a:[.4,.1],b:[.5,.1]}],
  furniture: [{type:'sink',center:[.5,.5],width:2,depth:2,rotation:0,source:'detected',label:'Sink',confidence:.91}], rooms: [], inferenceMs: 50 };

test('recognizer validates input and produces editable geometry without exposing credentials', async () => {
  let sent;
  const model = createRecognizer({baseUrl:'http://127.0.0.1:8765',token:'test-token',fetchImpl:async(url,init)=>{
    sent={url,...init}; return new Response(JSON.stringify(result)); }});
  const output=await model.analyze(body);
  assert.equal(output.engine,'cubicasa5k'); assert.deepEqual(output.walls,result.walls);
  assert.equal(output.furniture[0].confidence,.91); assert.equal(output.furniture[0].detector,'cubicasa5k');
  assert.equal(sent.headers.authorization,'Bearer test-token'); assert.equal(sent.redirect,'error');
  assert.deepEqual(JSON.parse(sent.body),body); assert.doesNotMatch(JSON.stringify(output),/test-token/);
  for (const invalid of [{...body,image:'https://image.example/plan.png'}, {...body,width:0}]) await assert.rejects(model.analyze(invalid),{status:400});
});

test('unavailable services, unsafe URLs, oversized responses and invalid geometry fail explicitly', async () => {
  assert.deepEqual(await createRecognizer({baseUrl:''}).status(),{configured:false,ready:false,engine:'cubicasa5k'});
  for (const url of ['http://remote.example','https://user:secret@remote.example','https://remote.example?token=a']) {
    await assert.rejects(createRecognizer({baseUrl:url,fetchImpl:()=>assert.fail('no connection')}).analyze(body),{status:503});
  }
  for (const payload of [{...result,walls:[{kind:'wall',a:[-1,0],b:[1,0]}]}, {...result,engine:'unknown'}, {...result,furniture:[{...result.furniture[0],width:100}]}]) {
    await assert.rejects(createRecognizer({baseUrl:'http://localhost:8765',fetchImpl:async()=>new Response(JSON.stringify(payload))}).analyze(body),{status:502});
  }
  await assert.rejects(createRecognizer({baseUrl:'http://localhost:8765',fetchImpl:async()=>new Response('x'.repeat(1024*1024+1))}).analyze(body),/too large/);
  await assert.rejects(createRecognizer({baseUrl:'http://localhost:8765',fetchImpl:async()=>new Response('internal secret',{status:500})}).analyze(body),e=>e.status===502&&!e.message.includes('secret'));
  await assert.rejects(createRecognizer({baseUrl:'http://localhost:8765',fetchImpl:async()=>new Response('{}',{status:429})}).analyze(body),{status:429});
});

test('recognition route requires owner access and same-origin writes, and leaves stored projects unchanged', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mdu-recognition-')); fs.mkdirSync(path.join(dir,'public'));
  for(const file of ['server.js','telegram-bot.js','floor-plan-recognition.js','public/floor-plan-geometry.js']) fs.copyFileSync(path.join(__dirname,'..',file),path.join(dir,file));
  const keys=['ADMIN_PASSWORD','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','VERCEL','FLOORPLAN_RECOGNITION_URL'];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]])); keys.forEach(k=>delete process.env[k]); process.env.ADMIN_PASSWORD='recognition-test';
  const server=require(path.join(dir,'server.js')); await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));keys.forEach(k=>saved[k]===undefined?delete process.env[k]:process.env[k]=saved[k]);fs.rmSync(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`,url=base+'/api/admin/floor-plan-recognition';
  assert.equal((await fetch(url)).status,401); assert.equal((await fetch(url,{method:'POST',body:JSON.stringify(body)})).status,401);
  const login=await fetch(base+'/api/login',{method:'POST',body:JSON.stringify({password:'recognition-test'})});const cookie=login.headers.get('set-cookie').split(';')[0];
  const headers={cookie,'content-type':'application/json'};
  const before=await(await fetch(base+'/api/admin/data',{headers})).json();
  const status=await fetch(url,{headers});assert.equal(status.status,200);assert.equal((await status.json()).ready,false);
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,origin:'https://attacker.example'},body:JSON.stringify(body)})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({...body,width:0})})).status,400);
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(body)})).status,503);
  assert.equal((await fetch(url,{method:'PUT',headers})).status,405);
  assert.deepEqual(await(await fetch(base+'/api/admin/data',{headers})).json(),before);
});
