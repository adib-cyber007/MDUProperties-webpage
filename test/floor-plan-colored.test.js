'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const G=require('../public/floor-plan-geometry');
const {createRecognizer}=require('../floor-plan-recognition');
const body={image:'data:image/png;base64,AAAA',width:30,depth:40};
const walls=[{kind:'wall',a:[.2,.2],b:[.8,.2]},{kind:'wall',a:[.2,.2],b:[.2,.8]},
  {kind:'window',a:[.4,.2],b:[.5,.2]}];

test('coloured profile is explicit, validated and supports persistent geometry and exports',async()=>{
  let request;
  const service=createRecognizer({baseUrl:'http://localhost:8765',fetchImpl:async(_,init)=>{
    request=JSON.parse(init.body);return new Response(JSON.stringify({engine:'color-walls',walls,furniture:[],rooms:[],inferenceMs:100}));}});
  const result=await service.analyze({...body,profile:'colored'});
  assert.equal(request.profile,'colored');assert.equal(result.engine,'color-walls');
  assert.equal(result.sources.walls,'color-geometry');
  const plan=G.validate({version:1,...body,height:10,thickness:.5,walls:result.walls,recognition:{engine:result.engine,regions:[]}});
  assert.equal(G.validate(JSON.parse(JSON.stringify(plan))).recognition.engine,'color-walls');
  assert.match(G.toOBJ(plan),/o glass_/);
  await assert.rejects(service.analyze({...body,profile:'unknown'}),{status:400});
});

test('forcing original FLRplanner preserves its existing wall and detail handling',async()=>{
  let request;
  const service=createRecognizer({baseUrl:'http://localhost:8765',fetchImpl:async(_,init)=>{
    request=JSON.parse(init.body);return new Response(JSON.stringify({engine:'cubicasa5k',walls,furniture:[],rooms:[],inferenceMs:100}));}});
  const original=await service.analyze({...body,profile:'standard'});
  assert.equal(request.profile,'standard');
  assert.deepEqual(original.walls,G.surroundOpenings(walls,body.width,body.depth));
  assert.equal(original.engine,'cubicasa5k');
});
