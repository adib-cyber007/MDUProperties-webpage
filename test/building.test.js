const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const G = require('../public/floor-plan-geometry');
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=';
const plan = height => ({ version: 1, image, width: 30, depth: 40, height, thickness: .5, scaleConfirmed: true, walls: [{ kind: 'wall', a: [.1, .1], b: [.9, .1] }] });
const building = published => ({ version: 2, published, floors: [{ plan: plan(10), slabThickness: .5 }, { plan: plan(9), slabThickness: .75, offsetX: 2, offsetZ: -1 }] });

test('floors stack ground-up with actual heights, slabs and independent alignment', () => {
  const model = G.validate(building(true));
  const floors = G.floorsOf(model);
  assert.deepEqual(floors.map(f => f.elevation), [0, 10.75]);
  assert.deepEqual(floors.map(f => f.name), ['Ground floor', 'First floor']);
  const walls = G.boxes(model).filter(b => b.material === 'wall');
  assert.equal(walls[0].y - walls[0].height / 2, 0);
  assert.equal(walls[1].y - walls[1].height / 2, 10.75);
  assert.equal(walls[1].x - walls[0].x, 2);
  assert.equal(walls[1].z - walls[0].z, -1);
  const slabs = G.boxes(model).filter(b => b.material === 'floor');
  assert.equal(slabs[1].y - slabs[1].height / 2, 10);
  assert.doesNotMatch(G.toOBJ(model), /NaN|Infinity/);
  assert.equal(G.validate(plan(10)).version, 1, 'old models remain readable');
});

test('incomplete floors can be saved privately but cannot be published', () => {
  const draft = building(false); draft.floors[1].plan = null;
  assert.equal(G.validate(draft).floors[1].plan, null);
  assert.throws(() => G.validate({ ...draft, published: true }), /First floor/);
  draft.floors[1].plan = { ...plan(10), scaleConfirmed: false };
  assert.throws(() => G.validate({ ...draft, published: true }), /Confirm/);
  draft.floors[1].plan = { ...plan(10), walls: [] };
  assert.throws(() => G.validate({ ...draft, published: true }), /wall/);
  for (const floors of [[], Array(9).fill({ plan: plan(10) }), [null], [{ plan: building(false) }]]) assert.throws(() => G.validate({ version: 2, floors }));
  assert.throws(() => G.validate({ version: 2, floors: [{ plan: plan(10), offsetX: Infinity }] }));
  assert.throws(() => G.validate({ version: 2, floors: [{ plan: plan(10), slabThickness: -1 }] }));
});

test('buildings persist and remain isolated/private for listings, portfolio and standalone models', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdu-building-test-'));
  fs.mkdirSync(path.join(dir, 'public'));
  for (const file of ['server.js', 'telegram-bot.js', 'public/floor-plan-geometry.js']) fs.copyFileSync(path.join(__dirname, '..', file), path.join(dir, file));
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL', 'TELEGRAM_BOT_TOKEN']) delete process.env[key];
  process.env.ADMIN_PASSWORD = 'building-test';
  const server = require(path.join(dir, 'server.js'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ password: 'building-test' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const call = (url, method = 'GET', body, auth = true) => fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(auth ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  for (const [collection, key] of [['listings', 'listing'], ['projects', 'project'], ['models', 'model']]) {
    const body = { title: `Building ${collection}`, mainImage: image, price: 100000, floorPlan: building(false) };
    assert.equal((await call(`/api/admin/${collection}`, 'POST', body, false)).status, 401);
    const response = await call(`/api/admin/${collection}`, 'POST', body); assert.equal(response.status, 201);
    const record = (await response.json())[key];
    const admin = `/api/admin/${collection}/${record.id}`, publicPath = `/api/${collection}/${record.id}`;
    const read = async () => (await (await call(publicPath)).json())[key];
    if (collection === 'models') assert.equal((await call(publicPath)).status, 404);
    else assert.equal((await read()).floorPlan, null);
    const saved = (await (await call('/api/admin/data')).json())[collection].find(r => r.id === record.id);
    assert.equal(saved.floorPlan.floors.length, 2);
    assert.equal((await call(admin, 'PUT', { floorPlan: building(true) })).status, 200);
    assert.equal((await read()).floorPlan.floors[1].plan.height, 9);
    await call(admin, 'PUT', { location: 'Updated location' });
    assert.equal((await read()).floorPlan.floors.length, 2, 'unrelated edits preserve floors');
    assert.equal((await call(admin, 'PUT', { floorPlan: { version: 2, published: true, floors: [{ plan: null }] } })).status, 400);
    assert.equal((await read()).floorPlan.published, true, 'invalid save preserves prior model');
    await call(admin, 'PUT', { floorPlan: building(false) });
    if (collection === 'models') assert.equal((await call(publicPath)).status, 404);
    else assert.equal((await read()).floorPlan, null);
    const second = await call(`/api/admin/${collection}`, 'POST', { ...body, title: 'No model', floorPlan: null });
    assert.equal((await second.json())[key].floorPlan, null);
    await call(admin, 'PUT', { floorPlan: null });
    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'data/store.json'), 'utf8'));
    assert.equal(disk[collection].find(r => r.id === record.id).floorPlan, null);
  }
});
