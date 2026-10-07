'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const G=require('../public/floor-plan-geometry');
const {createRecognizer}=require('../floor-plan-recognition');
const body={image:'data:image/png;base64,AAAA',width:30,depth:40};
const candidate={kind:'wall',a:[.2,.5],b:[.8,.5],confidence:.7,reason:'Low wall confidence'};
const result={engine:'mitunet',walls:[{kind:'wall',a:[.1,.1],b:[.9,.1],confidence:.99},{kind:'door',a:[.4,.1],b:[.5,.1]}],
  furniture:[],rooms:[],candidates:[candidate],annotations:[{type:'measurement-text',text:'3000',confidence:.95,polygon:[[.2,.2],[.3,.2],[.3,.3],[.2,.3]]}],
  summary:{textRegions:1,dimensionLines:0,symbolRegions:0,removedPixels:23,reviewSegments:1},inferenceMs:100};

test('wall-only proxy excludes openings and keeps uncertain lines separate from 3D geometry',async()=>{
  let request;
  const service=createRecognizer({baseUrl:'http://localhost:8765',fetchImpl:async(_,init)=>{request=JSON.parse(init.body);return new Response(JSON.stringify(result));}});
  const response=await service.analyze({...body,mode:'walls'});
  assert.equal(request.mode,'walls');assert.equal(response.engine,'mitunet');assert.equal(response.walls.length,1);
  assert.deepEqual(response.candidates,[candidate]);assert.deepEqual(response.annotations,result.annotations);assert.deepEqual(response.summary,result.summary);
  const plan=G.validate({version:1,...body,height:10,thickness:.5,walls:response.walls,recognition:{engine:response.engine,regions:[],...response}});
  assert.equal(G.boxes(plan).filter(box=>box.material==='wall').length,1,'candidate cannot be extruded');
  assert.deepEqual(G.validate(JSON.parse(JSON.stringify(plan))).recognition,plan.recognition,'review metadata persists');
});

test('explicit openings survive without inventing missing wall surrounds',async()=>{
  const service=createRecognizer({baseUrl:'http://localhost:8765',fetchImpl:async()=>new Response(JSON.stringify(result))});
  const response=await service.analyze({...body,mode:'openings'});
  assert.deepEqual(response.walls,result.walls);
  await assert.rejects(service.analyze({...body,mode:'anything'}),{status:400});
});

test('default combined recognition retains details while preserving MitUNet walls and review',async()=>{
  const fixture={type:'sink',center:[.5,.1],width:2,depth:2,rotation:0,label:'Sink',confidence:.9};
  const service=createRecognizer({baseUrl:'http://localhost:8765',fetchImpl:async()=>new Response(JSON.stringify({...result,furniture:[fixture]}))});
  const response=await service.analyze(body);
  assert.deepEqual(response.walls,result.walls);
  assert.equal(response.furniture.length,1);assert.equal(response.furniture[0].detector,'cubicasa5k');
  assert.deepEqual(response.candidates,[candidate]);
  assert.deepEqual(response.sources,{walls:'mitunet',openings:'cubicasa5k',furniture:'cubicasa5k'});
});

test('annotation and candidate coordinates are bounded on import',()=>{
  const base={version:1,...body,height:10,thickness:.5,walls:[],recognition:{engine:'mitunet',regions:[],candidates:[candidate],annotations:result.annotations}};
  assert.equal(G.validate(base).recognition.candidates.length,1);
  assert.throws(()=>G.validate({...base,recognition:{...base.recognition,candidates:[{...candidate,a:[-1,.5]}]}}));
  assert.throws(()=>G.validate({...base,recognition:{...base.recognition,annotations:[{...result.annotations[0],polygon:[[2,0],[1,0],[1,1],[0,1]]}]}}));
  assert.throws(()=>G.validate({...base,recognition:{...base.recognition,candidates:[{...candidate,kind:'door'}]}}));
});
