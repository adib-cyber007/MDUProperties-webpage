'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const G = require('../public/floor-plan-geometry');
const Detection = require('../public/floor-plan-detection');
const Openings = require('../public/floor-plan-openings');
const Furniture = require('../public/floor-plan-furniture');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=';
const fixture = () => ({ version: 1, image: pixel, width: 30, depth: 40, height: 10, thickness: .5, published: false, walls: [{ kind: 'wall', a: [.1, .1], b: [.9, .1] }] });

test('automatic detection finds long wall lines and ignores short labels', () => {
  const width = 600, height = 800, data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([255, 255, 255, 255], i);
  const paint = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const offset = (y * width + x) * 4; data.set([130, 145, 164, 255], offset);
    }
  };
  for (const y of [60, 400, 740]) paint(60, y - 1, 540, y + 1);
  for (const x of [60, 540]) paint(x - 1, 60, x + 1, 740);
  paint(299, 60, 301, 400);
  paint(100, 150, 125, 153); // A short drawing label is not a wall.
  const walls = Detection.detect({ width, height, data });
  assert.equal(walls.length, 6);
  const browserLikeImage = Object.create({ width, height, data });
  assert.deepEqual(Detection.detect(browserLikeImage), walls, 'ImageData prototype dimensions must survive mask conversion');
  assert.ok(walls.some(wall => Math.abs(wall.a[1] - 60 / height) < .01 && Math.abs(wall.b[0] - 540 / width) < .01));
  assert.ok(walls.every(wall => wall.kind === 'wall'));
  assert.deepEqual(G.validate({ ...fixture(), walls, scaleConfirmed: false }).walls, walls);
  assert.throws(() => G.validate({ ...fixture(), walls, scaleConfirmed: false, published: true }), /Confirm the actual drawing width/);
  assert.equal(Detection.detect({ width: 100, height: 100, data: new Uint8ClampedArray(100 * 100 * 4) }).length, 0);
});

test('detached measurement guides and furniture outlines do not become walls', () => {
  const width = 600, height = 800, data = new Uint8ClampedArray(width * height * 4).fill(255);
  const line = (x0, y0, x1, y1, color = [70, 70, 70]) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data.set([...color, 255], (y * width + x) * 4);
  };
  // The building has a connected perimeter and two interior partitions.
  line(100, 150, 500, 152); line(100, 648, 500, 650);
  line(100, 150, 102, 650); line(498, 150, 500, 650);
  line(290, 150, 292, 420); line(290, 418, 500, 420);
  // Dimension guides sit outside the building, like the uploaded example.
  line(75, 75, 525, 76); line(75, 725, 525, 726);
  line(42, 130, 43, 670); line(555, 130, 556, 670);
  // A colored bed outline has a small break, so the conservative furniture
  // detector does not classify it as an isolated closed symbol.
  const blue = [48, 83, 159];
  line(345, 490, 440, 492, blue); line(345, 600, 440, 602, blue);
  line(345, 490, 347, 602, blue); line(438, 490, 440, 555, blue); line(438, 560, 440, 602, blue);
  const walls = Detection.detect({ width, height, data });
  assert.ok(walls.length >= 6, 'structural perimeter and partitions remain');
  assert.ok(walls.every(wall => [wall.a, wall.b].every(([x, y]) => x * width >= 90 && x * width <= 510 && y * height >= 140 && y * height <= 660)), `guides outside the building are removed: ${JSON.stringify(walls)}`);
  assert.ok(!walls.some(wall => [wall.a, wall.b].every(([x, y]) => x * width >= 335 && x * width <= 450 && y * height >= 480 && y * height <= 610)), 'detached bed outline is not modeled as a wall');
});

test('floor-plan validation rejects unsafe images, invalid scale, excessive and zero-length geometry', () => {
  assert.equal(G.validate(undefined), null);
  for (const input of [
    { ...fixture(), image: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { ...fixture(), image: 'https://example.com/plan.png' },
    { ...fixture(), version: 2 }, { ...fixture(), width: Infinity }, { ...fixture(), height: 0 },
    { ...fixture(), width: '30' }, { ...fixture(), walls: [{ kind: 'wall', a: [0, 0], b: [2, 1] }] },
    { ...fixture(), walls: [{ kind: 'wall', a: [0, 0], b: [0, 0] }] },
    { ...fixture(), walls: Array(251).fill(fixture().walls[0]) },
    { ...fixture(), published: true, walls: [] }
  ]) assert.throws(() => G.validate(input), { status: 400 });
  const saved = G.validate(fixture()); assert.deepEqual(saved.walls, fixture().walls); assert.equal(saved.unit, 'ft');
});

test('outlined wall edges become one centreline and door gaps remain open', () => {
  const width = 600, height = 600, data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const [start, end] of [[60, 250], [310, 540]]) for (const y of [100, 112]) {
    for (let x = start; x <= end; x++) for (let offset = 0; offset < 2; offset++) data.set([180,180,180,255], ((y+offset)*width+x)*4);
  }
  const walls = Detection.detect({ width, height, data });
  assert.equal(walls.length, 2, 'two wall sections, not four outline edges');
  for (const wall of walls) assert.ok(Math.abs(wall.a[1]*height-106.5) < 1);
  assert.ok(walls.every(wall => Math.max(wall.a[0], wall.b[0])*width <= 251 || Math.min(wall.a[0], wall.b[0])*width >= 309));
});

test('door arcs and glazed wall strips become 3D openings', () => {
  const width = 400, height = 400, data = new Uint8ClampedArray(width * height * 4).fill(255);
  const paint = (x, y, shade) => data.set([shade, shade, shade, 255], (y * width + x) * 4);
  for (let x = 40; x <= 360; x++) {
    if (x < 120 || x > 150) paint(x, 100, 30);
    for (let y = 247; y <= 253; y++) paint(x, y, y === 247 || y === 253 ? 25 : 165);
  }
  for (let y = 100; y <= 130; y++) paint(120, y, 25);
  for (let degree = 0; degree <= 90; degree++) {
    const angle = degree * Math.PI / 180;
    paint(Math.round(120 + 30 * Math.cos(angle)), Math.round(100 + 30 * Math.sin(angle)), 25);
  }
  for (let x = 230; x <= 300; x++) for (let y = 248; y <= 252; y++) paint(x, y, y === 248 || y === 252 ? 25 : 255);
  const walls = [100, 250].map(y => ({ kind: 'wall', a: [40 / width, y / height], b: [360 / width, y / height] }));
  const openings = Openings.detect({ width, height, data }, walls);
  assert.ok(openings.some(o => o.kind === 'door' && Math.abs(o.a[0] * width - 120) < 6 && Math.abs(o.b[0] * width - 150) < 6), JSON.stringify(openings));
  assert.ok(openings.some(o => o.kind === 'window' && o.a[0] * width <= 235 && o.b[0] * width >= 295));
  assert.ok(!openings.some(o => o.kind === 'window' && o.a[1] * height < 240));
  const plan = { ...fixture(), width: 40, depth: 40, walls: [...walls, ...openings] };
  const boxes = G.boxes(plan);
  assert.ok(boxes.some(box => box.material === 'door' && box.height > 6));
  assert.ok(boxes.some(box => box.material === 'glass' && box.height === 3.5));
  assert.match(G.toOBJ(plan), /o door_/);
  assert.match(G.toOBJ(plan), /o glass_/);
  assert.ok(boxes.some(box => box.material === 'frame'), 'glazing has a visible frame in the 3D model');
});

test('doors drawn in real wall gaps are recognized at different image scales', () => {
  for (const scale of [.5, 2]) {
    const width = 400 * scale, height = 400 * scale;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    const paint = (x, y) => data.set([25, 25, 25, 255], (Math.round(y) * width + Math.round(x)) * 4);
    for (let x = 40 * scale; x <= 360 * scale; x++) if (x <= 120 * scale || x >= 150 * scale) paint(x, 100 * scale);
    for (let y = 100 * scale; y <= 130 * scale; y++) paint(120 * scale, y);
    for (let degree = 0; degree <= 90; degree += .25) {
      const angle = degree * Math.PI / 180;
      paint((120 + 30 * Math.cos(angle)) * scale, (100 + 30 * Math.sin(angle)) * scale);
    }
    const walls = [[40, 120], [150, 360]].map(([a, b]) => ({ kind: 'wall', a: [a / 400, .25], b: [b / 400, .25] }));
    const doors = Openings.detect({ width, height, data }, walls).filter(o => o.kind === 'door');
    assert.ok(doors.some(o => Math.abs(o.a[0] - .3) < .02 && Math.abs(o.b[0] - .375) < .02), `door in gap at scale ${scale}: ${JSON.stringify(doors)}`);
  }
});

test('long diagonal walls are detected on a shaded scan', () => {
  const width = 400, height = 400, data = new Uint8ClampedArray(width*height*4);
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const shade = 220 + Math.round(x/20); data.set([shade,shade,shade,255], (y*width+x)*4);
  }
  for (let x=50;x<=350;x++) for (let d=-1;d<=1;d++) data.set([160,160,160,255], ((x+d)*width+x)*4);
  const walls = Detection.detect({width,height,data});
  assert.ok(walls.some(w => Math.hypot((w.a[0]-w.b[0])*width,(w.a[1]-w.b[1])*height)>380 && Math.abs(w.a[0]-w.a[1])<.02 && Math.abs(w.b[0]-w.b[1])<.02));
  assert.ok(walls.length <= 2, 'avoid repeated diagonal edges');
});

test('reference calibration preserves aspect ratio and includes drawing margins', () => {
  const plan = G.calibrate(fixture(), [.1,.2], [.9,.2], 24, 600, 800);
  assert.equal(plan.width,30); assert.equal(plan.depth,40);
  assert.equal(plan.scaleConfirmed,true); assert.equal(plan.published,false);
  assert.throws(() => G.calibrate(fixture(), [.1,.2], [.1,.2], 24, 600, 800), /farther apart/);
  assert.throws(() => G.calibrate(fixture(), [.1,.2], [.9,.2], 0, 600, 800), /Reference distance/);
});

test('presentation slab follows structural walls rather than image whitespace', () => {
  const plan = { ...fixture(), walls: [
    { kind: 'wall', a: [.25, .2], b: [.75, .2] },
    { kind: 'wall', a: [.75, .2], b: [.75, .8] },
    { kind: 'wall', a: [.75, .8], b: [.25, .8] },
    { kind: 'wall', a: [.25, .8], b: [.25, .2] },
    { kind: 'door', a: [.05, .05], b: [.15, .05] }
  ] };
  const base = G.footprint(plan);
  assert.equal(base.width, 16); assert.equal(base.depth, 25);
  assert.ok(Math.abs(base.x) < 1e-10 && Math.abs(base.z) < 1e-10);
  assert.deepEqual(G.boxes(plan)[0], { ...base, y: -.15, height: .3, angle: 0, material: 'floor' });
  assert.ok(G.boxes(plan)[0].width < plan.width && G.boxes(plan)[0].depth < plan.depth);
  const shifted = { ...plan, walls: plan.walls.filter(w => w.kind === 'wall').map(w => ({ ...w,
    a: [w.a[0] + .1, w.a[1]], b: [w.b[0] + .1, w.b[1]] })) };
  assert.ok(Math.abs(G.footprint(shifted).x - 3) < 1e-10, 'an off-centre building stays off-centre in image coordinates');
  assert.equal(G.footprint({ ...plan, walls: [] }).width, plan.width, 'empty drafts keep a safe fallback');
});

test('openings cut continuous detected walls and leave unrelated walls intact', () => {
  const plan = fixture();
  plan.walls.push({kind:'door',a:[.3,.1],b:[.4,.1]}, {kind:'window',a:[.7,.1],b:[.5,.1]}, {kind:'wall',a:[.1,.5],b:[.9,.5]});
  const solid = G.boxes(plan).filter(b => b.material === 'wall' && b.height === plan.height);
  assert.equal(solid.length,4);
  const top = solid.filter(b => Math.abs(b.z+16)<1e-8);
  assert.ok(Math.abs(top.reduce((sum,b)=>sum+b.width,0)-15)<1e-8);
  assert.ok(solid.some(b => Math.abs(b.width-24)<1e-8 && b.z===0));
  // Perpendicular openings must not cut this wall.
  const crossing = fixture(); crossing.walls.push({kind:'door',a:[.5,0],b:[.5,.2]});
  assert.equal(G.cutWalls(crossing).filter(w=>w.kind==='wall').length,1);
});

test('wall geometry uses real drawing dimensions and models doorway/window openings', () => {
  const plan = fixture();
  plan.walls.push({ kind: 'door', a: [.2, .3], b: [.3, .3] }, { kind: 'window', a: [.4, .3], b: [.6, .3] });
  const boxes = G.boxes(plan);
  assert.equal(boxes[1].width, 24); assert.equal(boxes[1].height, 10);
  assert.ok(Math.abs(boxes[2].y - boxes[2].height / 2 - 6.8) < 1e-8);
  assert.equal(boxes.find(box => box.material === 'glass').height, 3.5);
  const obj = G.toOBJ(plan);
  assert.equal(obj.match(/^v /gm).length, boxes.length * 8);
  assert.equal(obj.match(/^f /gm).length, boxes.length * 6);
  assert.doesNotMatch(obj, /NaN|Infinity/);
});

test('isolated furniture symbols are proposed, while wall outlines and labels are ignored', () => {
  const width=400,height=400,data=new Uint8ClampedArray(width*height*4).fill(255);
  const stroke=(x0,y0,x1,y1)=>{for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)data.set([80,80,80,255],(y*width+x)*4);};
  stroke(95,140,165,141);stroke(95,210,165,211);stroke(95,140,96,211);stroke(164,140,165,211); // isolated bed outline
  stroke(10,10,350,12);stroke(10,10,12,350); // structural lines
  stroke(220,180,235,183); // small label
  const found=Furniture.suggest({width,height,data},{...fixture(),width:30,depth:40,furniture:[]});
  assert.equal(found.length,1); assert.equal(found[0].type,'bed');
  assert.deepEqual(Furniture.suggest({width,height,data},{...fixture(),width:30,depth:40,furniture:found}),[]);
});

test('solid colored furniture is suggested without promoting its edges to walls', () => {
  const width=600,height=800,data=new Uint8ClampedArray(width*height*4).fill(255);
  const paint=(x0,y0,x1,y1,color)=>{for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)data.set([...color,255],(y*width+x)*4);};
  const gray=[85,85,85],green=[175,205,139],purple=[150,125,171];
  paint(90,120,510,123,gray);paint(90,650,510,653,gray);
  paint(90,120,93,653,gray);paint(507,120,510,653,gray);
  paint(300,120,303,400,gray);paint(300,397,510,400,gray);
  paint(370,490,445,552,green); // filled bed
  paint(185,455,211,520,purple); // filled sofa
  paint(220,230,268,276,green); // colored dining table
  const pixels={width,height,data};
  const found=Furniture.suggest(pixels,{...fixture(),width:30,depth:40,furniture:[]});
  assert.ok(found.some(item=>item.type==='bed' && Math.abs(item.center[0]*width-407)<5));
  assert.ok(found.some(item=>Math.abs(item.center[0]*width-198)<5));
  assert.ok(found.some(item=>Math.abs(item.center[0]*width-244)<5));
  const walls=Detection.detect(pixels);
  assert.ok(walls.length>=6);
  assert.ok(walls.every(w=>[w.a,w.b].every(([x,y])=>x*width<360 || x*width>455 || y*height<480 || y*height>560)), 'bed geometry stays out of wall model');
});

test('furniture is validated, persists in floor plan data, and contributes to 3D and OBJ geometry', () => {
  const item={type:'sofa',center:[.5,.6],width:6,depth:2.8,rotation:90,source:'manual'};
  const plan=G.validate({...fixture(),furniture:[item]});
  assert.deepEqual(plan.furniture,[item]);
  assert.ok(G.boxes(plan).some(box=>box.material==='fabric' && box.angle===Math.PI/2));
  assert.match(G.toOBJ(plan),/o fabric_/);
  assert.deepEqual(G.validate(fixture()).furniture,[]);
  for(const bad of [{...item,type:'unknown'},{...item,center:[2,.5]},{...item,width:Infinity},{...item,rotation:400}]) assert.throws(()=>G.validate({...fixture(),furniture:[bad]}),{status:400});
  assert.throws(()=>G.validate({...fixture(),furniture:Array(101).fill(item)}),{status:400});
});

test('standalone 3D projects persist separately, support empty drafts, and respect publication', async t => {
  // Isolated fixture server: never touches the workspace store or a real Supabase project.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdu-floor-plan-test-'));
  fs.mkdirSync(path.join(dir, 'public'));
  for (const file of ['server.js', 'seo.js', 'public/page-seo.js', 'telegram-bot.js', 'public/floor-plan-geometry.js']) fs.copyFileSync(path.join(__dirname, '..', file), path.join(dir, file));
  const keys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL', 'ADMIN_PASSWORD'];
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  keys.forEach(key => { delete process.env[key]; }); process.env.ADMIN_PASSWORD = 'floor-plan-test';
  let server;
  try { server = require(path.join(dir, 'server.js')); }
  finally { keys.forEach(key => { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; }); }
  // Store selection also checks VERCEL at request time. Leave test process local.
  const vercel = process.env.VERCEL; delete process.env.VERCEL;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    if (vercel !== undefined) process.env.VERCEL = vercel;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'floor-plan-test' }) });
  assert.equal(auth.status, 200);
  const cookie = auth.headers.get('set-cookie').split(';')[0];
  const call = (url, method = 'GET', body, authenticated = true) => fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(authenticated ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const empty = await call('/api/admin/models', 'POST', { title: 'Upload later' });
  assert.equal(empty.status, 201); assert.equal((await empty.json()).model.floorPlan, null);
  const before = await (await call('/api/admin/data')).json();
  const furniture=[{type:'bed',center:[.4,.5],width:5,depth:6.5,rotation:0,source:'detected'}];
  const project = { title: 'Floor-plan test project', mainImage: pixel, completedYear: 2024, location: 'Madurai', floorPlan: {...fixture(),furniture} };
  assert.equal((await call('/api/admin/models', 'POST', project, false)).status, 401);
  const created = await call('/api/admin/models', 'POST', project); assert.equal(created.status, 201);
  const id = (await created.json()).model.id;
  const publicURL = `/api/models/${id}`, adminURL = `/api/admin/models/${id}`;
  assert.equal((await call(publicURL)).status, 404);
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'store.json'), 'utf8')).models[0];
  assert.deepEqual(stored.floorPlan.walls, project.floorPlan.walls);
  assert.deepEqual(stored.floorPlan.furniture,furniture);
  const published = await call(adminURL, 'PUT', { floorPlan: { ...fixture(), furniture, published: true } }); assert.equal(published.status, 200);
  const live = (await (await call(publicURL)).json()).model;
  assert.equal(live.floorPlan.published, true); assert.equal(live.location, project.location);
  assert.deepEqual(live.floorPlan.furniture,furniture);
  assert.equal((await call(adminURL, 'PUT', { floorPlan: { ...fixture(), width: -1 } })).status, 400);
  assert.equal((await (await call(publicURL)).json()).model.floorPlan.published, true);
  await call(adminURL, 'PUT', { floorPlan: { ...fixture(), published: false } });
  assert.deepEqual((await (await call('/api/models')).json()).models, []);
  assert.equal((await (await call('/api/admin/data')).json()).models[0].floorPlan.walls.length, 1);
  await call(adminURL, 'PUT', { floorPlan: null });
  assert.equal((await (await call('/api/admin/data')).json()).models[0].floorPlan, null);
  assert.equal((await call(adminURL, 'DELETE', null, false)).status, 401);
  assert.equal((await call(adminURL, 'DELETE')).status, 200);
  const after = await (await call('/api/admin/data')).json();
  assert.deepEqual(after.projects, before.projects); assert.deepEqual(after.listings, before.listings);
  assert.equal(after.models.length, 1);
  await t.test('portfolio models are optional, isolated per project, and private until published', async () => {
    const create = async title => {
      const response = await call('/api/admin/projects', 'POST', { title, mainImage: pixel, completedYear: 2024 });
      assert.equal(response.status, 201);
      return (await response.json()).project;
    };
    const first = await create('Completed home with model');
    const second = await create('Completed home without model');
    const adminPath = `/api/admin/projects/${first.id}`;
    const read = async id => (await (await call(`/api/projects/${id}`)).json()).project;
    assert.equal((await read(first.id)).floorPlan, null);
    assert.equal((await read(second.id)).floorPlan, null);
    assert.equal((await call(adminPath, 'PUT', { floorPlan: fixture() }, false)).status, 401);
    assert.equal((await call(adminPath, 'PUT', { floorPlan: fixture() })).status, 200);
    assert.equal((await read(first.id)).floorPlan, null);
    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'store.json'), 'utf8'));
    assert.deepEqual(disk.projects.find(p => p.id === first.id).floorPlan.walls, fixture().walls);
    assert.equal((await call(adminPath, 'PUT', { floorPlan: { ...fixture(), published: true } })).status, 200);
    assert.equal((await read(first.id)).floorPlan.published, true);
    assert.equal((await read(second.id)).floorPlan, null);
    assert.equal((await call(adminPath, 'PUT', { location: 'Madurai' })).status, 200);
    assert.equal((await read(first.id)).floorPlan.published, true);
    assert.equal((await call(adminPath, 'PUT', { floorPlan: { ...fixture(), width: -2 } })).status, 400);
    assert.equal((await read(first.id)).floorPlan.width, 30);
    await call(adminPath, 'PUT', { floorPlan: { ...fixture(), published: false } });
    assert.equal((await (await call('/api/projects')).json()).projects.find(p => p.id === first.id).floorPlan, null);
    await call(adminPath, 'PUT', { floorPlan: null });
    assert.equal((await read(first.id)).floorPlan, null);
    assert.equal((await (await call('/api/admin/data')).json()).models.length, 1);
  });
});
