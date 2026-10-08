'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../public/floor-plan-geometry');
const {createRecognizer} = require('../floor-plan-recognition');
const wall = {kind:'wall',a:[.2,.2],b:[.8,.2]};
const body = {image:'data:image/png;base64,AAAA',width:30,depth:40};
const item = {a:wall.a,b:wall.b,cropBounds:[.1,.1,.9,.3],classification:'measurement-line',reason:'Tick marks',score:null,
  evidence:{connected:true,thickSupport:true,coloredSupport:false},decision:'pending'};
const review = {state:'complete',provider:'ollama',model:'qwen3-vl:4b',items:[item],automaticRemovals:0};
const plan = () => G.validate({version:1,...body,height:10,thickness:.5,walls:[wall],recognition:{engine:'cubicasa5k',regions:[],visionReview:review}});

test('vision flags survive save/reopen and require a manual decision to alter walls', () => {
  const original = plan(), before = JSON.stringify(original);
  const reopened = G.validate(JSON.parse(before));
  assert.deepEqual(reopened,original);
  const kept = G.resolveVisionReview(original,0,'kept');
  assert.deepEqual(kept.walls,original.walls);
  assert.equal(kept.recognition.visionReview.items[0].decision,'kept');
  const removed = G.resolveVisionReview(original,0,'removed');
  assert.equal(removed.walls.length,0);
  assert.equal(removed.recognition.visionReview.items[0].decision,'removed');
  assert.equal(JSON.stringify(original),before,'immutable update preserves undo state');
  assert.throws(()=>G.resolveVisionReview(kept,0,'removed'),/already been reviewed/);
});

test('review decisions match endpoints after segment reorder and refuse edited shapes', () => {
  const original = plan();
  original.walls.unshift({kind:'wall',a:[.1,.1],b:[.1,.9]});
  assert.equal(G.visionWallIndex(original,item),1);
  const removed = G.resolveVisionReview(original,0,'removed');
  assert.equal(removed.walls.length,1);
  assert.deepEqual(removed.walls[0].a,[.1,.1]);
  original.walls[1].a=[.3,.2];
  assert.throws(()=>G.resolveVisionReview(original,0,'removed'),/edited or removed/);
});

test('review metadata rejects destructive modes, malformed coordinates and unbounded output', () => {
  for(const invalid of [{...review,automaticRemovals:1},{...review,mode:'auto'},
    {...review,items:Array(7).fill(item)},{...review,items:[{...item,a:[NaN,.2]}]},
    {...review,items:[{...item,classification:'new-wall'}]},{...review,items:[{...item,cropBounds:[.9,.1,.1,.3]}]}])
    assert.throws(()=>G.validateVisionReview(invalid));
});

test('proxy passes opt-in and preserves the original geometry for both engines', async () => {
  for(const engine of ['cubicasa5k','color-walls']){
    let sent;
    const recognizer = createRecognizer({baseUrl:'http://localhost:8765',fetchImpl:async(_,init)=>{
      sent=JSON.parse(init.body);
      return new Response(JSON.stringify({engine,walls:[wall],furniture:[],rooms:[],visionReview:review}));
    }});
    const plain=await recognizer.analyze(body);
    assert.equal(sent.visionReview,undefined);
    assert.equal(plain.visionReview,undefined);
    const reviewed=await recognizer.analyze({...body,visionReview:true});
    assert.equal(sent.visionReview,true);
    assert.deepEqual(reviewed.walls,plain.walls);
    assert.equal(reviewed.visionReview.items.length,1);
    await assert.rejects(recognizer.analyze({...body,visionReview:'yes'}),{status:400});
  }
});

test('malformed optional reviewer output never discards valid extracted walls', async () => {
  const recognizer=createRecognizer({baseUrl:'http://localhost:8765',fetchImpl:async()=>new Response(JSON.stringify({
    engine:'cubicasa5k',walls:[wall],furniture:[],rooms:[],visionReview:{...review,automaticRemovals:1}}))});
  const result=await recognizer.analyze({...body,visionReview:true});
  assert.deepEqual(result.walls,[wall]);
  assert.equal(result.visionReview.state,'unavailable');
});
