'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../public/floor-plan-geometry'),D=require('../public/floor-plan-design'),F=require('../public/floor-plan-finishes');
const image='data:image/png;base64,AAAA';
const wall=(a,b)=>({kind:'wall',a,b});
const rectangle=()=>G.validate({version:1,image,width:30,depth:40,height:10,thickness:.5,walls:[
  wall([.1,.1],[.9,.1]),wall([.9,.1],[.9,.9]),wall([.9,.9],[.1,.9]),wall([.1,.9],[.1,.1]),wall([.5,.1],[.5,.9])
]});
const request=p=>D.validateRequest({context:D.context(p),style:'natural',wallLook:'wallpaper',brief:''});

test('envelope faces differ from interior partitions, including concave and rotated layouts',()=>{
  const plan=rectangle();assert.deepEqual(G.wallSurfaces(plan).map(s=>s.outside),['right','right','right','right','none']);
  plan.walls[0]={...plan.walls[0],a:[.9,.1],b:[.1,.1]};assert.equal(G.wallSurfaces(plan)[0].outside,'left','reversing a wall reverses its outside face');
  // A notch in the boundary must not be treated as a room by a convex hull.
  const points=[[.1,.1],[.9,.1],[.9,.4],[.5,.4],[.5,.9],[.1,.9]];
  const concave={...plan,width:40,depth:40,walls:points.map((p,i)=>wall(p,points[(i+1)%points.length]))};
  assert.ok(G.wallSurfaces(concave).every(s=>s.outside==='right'&&!s.uncertain));
  const angle=.38,rotate=p=>[.5+(p[0]-.5)*Math.cos(angle)-(p[1]-.5)*Math.sin(angle),.5+(p[0]-.5)*Math.sin(angle)+(p[1]-.5)*Math.cos(angle)];
  const rotated={...concave,walls:concave.walls.map(w=>({...w,a:rotate(w.a),b:rotate(w.b)}))};
  assert.ok(G.wallSurfaces(rotated).every(s=>s.outside==='right'&&!s.uncertain));
});

test('door/window gaps close only surface analysis; incomplete envelopes are reviewable and overrides persist',()=>{
  const plan=rectangle();plan.walls.splice(0,1,wall([.1,.1],[.3,.1]),{kind:'door',a:[.3,.1],b:[.4,.1]},wall([.4,.1],[.9,.1]));
  plan.walls.push({kind:'window',a:[.9,.3],b:[.9,.6]});
  assert.equal(G.wallSurfaces(plan).at(-2).outside,'none');
  assert.ok(G.wallSurfaces(plan).slice(0,3).every(s=>s.outside==='right'));
  assert.equal(G.boxes(plan).filter(b=>b.material==='door').length,1,'analysis never seals the rendered doorway');
  const open={...rectangle(),walls:rectangle().walls.slice(0,2)};assert.ok(G.wallSurfaces(open).every(s=>s.uncertain));
  open.walls[0].outside='none';open.walls[1].outside='left';const saved=G.validate(open);
  assert.deepEqual(G.wallSurfaces(saved).map(s=>s.outside),['none','left']);assert.ok(G.wallSurfaces(saved).every(s=>s.source==='manual'));
  for(const outside of ['invalid',false,null])assert.throws(()=>G.validate({...open,walls:[{...open.walls[0],outside}]}),{status:400});
  assert.throws(()=>G.validate({...open,walls:[{kind:'door',a:[.1,.1],b:[.2,.1],outside:'left'}]}),{status:400});
});

test('inside wallpaper and exterior cladding survive cut walls and surround openings on their correct faces',()=>{
  const plan=rectangle(),inside=F.PRESETS.wall[16].finish,outside=F.PRESETS.exterior[6].finish;
  plan.finishes={wall:inside,exterior:outside};plan.walls[0].exteriorFinish=F.PRESETS.exterior[7].finish;
  plan.walls.push({kind:'window',a:[.3,.1],b:[.4,.1]});
  const saved=G.validate(plan),boxes=G.boxes(saved).filter(b=>b.material==='wall');
  assert.ok(boxes.every(b=>b.finish===saved.finishes.wall));
  assert.ok(boxes.filter(b=>Math.abs(b.z+16)<.01).every(b=>b.outside==='right'&&b.exteriorFinish===saved.walls[0].exteriorFinish));
  assert.ok(boxes.some(b=>b.outside==='none'),'partition has no outside material face');
  assert.ok(G.cutWalls(saved).filter(w=>w.kind==='wall'&&w.a[1]===.1&&w.b[1]===.1).every(w=>w.exteriorFinish===saved.walls[0].exteriorFinish));
});

test('Surprise me separates the facade, rejects exterior wallpaper, and preserves outside-only locks',()=>{
  const plan=rectangle();plan.finishes={exterior:F.PRESETS.exterior[7].finish};plan.finishLocks={exterior:true};
  const req=request(plan),design=D.localDesign(req,()=>0),next=D.applyDesign(plan,design,{keepOverrides:false});
  assert.equal(next.finishes.wall.pattern,'botanical');assert.deepEqual(next.finishes.exterior,plan.finishes.exterior);
  assert.notDeepEqual(design.finishes.wall,design.finishes.exterior);assert.ok(D.EXTERIOR_PATTERNS.includes(design.finishes.exterior.pattern));
  assert.throws(()=>D.validateDesign({...design,finishes:{...design.finishes,exterior:design.finishes.wall}},req),/unsuitable surface/);
  assert.equal(req.context.floors[0].walls[4].outside,'none');assert.deepEqual(req.context.floors[0].lockedFinishes.exterior,plan.finishes.exterior);
  plan.walls[0].finishLocked=true;plan.walls[0].exteriorFinish={...F.DEFAULTS.exterior,pattern:'custom',texture:image};
  const nextLocked=D.applyDesign(plan,D.localDesign(request(plan),()=>0),{keepOverrides:false});
  assert.deepEqual(nextLocked.walls[0].exteriorFinish,plan.walls[0].exteriorFinish);assert.doesNotMatch(JSON.stringify(request(plan)),/data:image|texture/);
  const exposed={...plan,walls:plan.walls.map(w=>({...w,outside:'both',finishLocked:false})),finishLocks:{}};
  const exposedReq=request(exposed),exposedDesign=D.localDesign(exposedReq,()=>0);assert.equal(exposedDesign.accents.length,0);
  assert.throws(()=>D.validateDesign({...exposedDesign,accents:[{floorIndex:0,wallIndex:0,finish:design.finishes.wall}]},exposedReq),/inside face/);
});
