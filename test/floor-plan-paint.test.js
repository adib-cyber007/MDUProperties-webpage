'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../public/floor-plan-geometry');
const F = require('../public/floor-plan-finishes');
const P = require('../public/floor-plan-paint');
const catalogue = require('../public/asian-paints-shades.json');
const image = 'data:image/png;base64,AAAA';
const floor = () => G.validate({ version: 1, image, width: 30, depth: 40, height: 10, thickness: .5,
  walls: [{ kind: 'wall', a: [.1,.1], b: [.9,.1], finish: F.PRESETS.wall[16].finish, exteriorFinish: F.PRESETS.exterior[7].finish, finishLocked: true },
    { kind: 'door', a: [.3,.1], b: [.4,.1] }], furniture: [{ type: 'sofa', center: [.5,.5], width: 6, depth: 3, rotation: 0 }],
  finishes: { floor: F.DEFAULTS.floor, ceiling: F.DEFAULTS.ceiling }, finishLocks: { wall: true } });

test('official shade catalogue resolves names, codes and aliases without guessing partial or unknown names', () => {
  assert.equal(P.validateCatalogue(catalogue).shades.length, 2200);
  for (const input of ['Buttercup', ' buttercup-N ', '0336', 'Buttercup-N (0336)']) {
    assert.deepEqual(P.resolve(catalogue,input), { name: 'Buttercup-N', code: '0336', color: '#debc97' });
  }
  assert.deepEqual(P.resolve(catalogue,'Apricot'), { name: 'Apricot-N', code: '0501', color: '#c9a995' });
  for (const input of ['', 'Butter', 'Apricottt', '#ffffff', '<script>']) assert.equal(P.resolve(catalogue,input), null);
  assert.ok(P.search(catalogue,'Apricot').some(shade => shade.code === '0501'));
  const duplicate = { ...catalogue, shades: [{ code: '0001', name: 'Example', color: '#ffffff' }, { code: '0002', name: 'Example', color: '#000000' }] };
  assert.equal(P.resolve(duplicate,'Example'),null);
  assert.equal(P.resolve(duplicate,'0002').color,'#000000');
  for (const shade of catalogue.shades) {
    const painted = P.applyPaint(floor(), 'wall', shade);
    assert.equal(painted.finishes.wall.paint.code, shade.code);
    assert.equal(painted.finishes.wall.color, shade.color);
  }
});

test('interior and exterior paint replace only their own face overrides and retain model content', () => {
  const original = floor(), snapshot = structuredClone(original);
  const interior = P.applyPaint(original,'wall',P.resolve(catalogue,'Buttercup'));
  assert.equal(interior.finishes.wall.color,'#debc97');
  assert.equal(interior.walls[0].finish,undefined,'explicit repaint replaces earlier individual wallpaper');
  assert.deepEqual(interior.walls[0].exteriorFinish,original.walls[0].exteriorFinish);
  const exterior = P.applyPaint(interior,'exterior',P.resolve(catalogue,'Apricot'));
  assert.equal(exterior.walls[0].exteriorFinish,undefined);
  assert.deepEqual(exterior.finishes.wall,interior.finishes.wall);
  assert.equal(exterior.finishes.exterior.paint.name,'Apricot-N');
  for (const key of ['image','width','depth','height','thickness','furniture','finishLocks']) assert.deepEqual(exterior[key],original[key]);
  assert.deepEqual(exterior.finishes.floor,original.finishes.floor);
  assert.deepEqual(exterior.finishes.ceiling,original.finishes.ceiling);
  assert.deepEqual(original,snapshot,'applying paint does not mutate saved or undo snapshots');
  const box = G.boxes(exterior).find(item => item.material === 'wall');
  assert.equal(box.finish.paint.code,'0336'); assert.equal(box.exteriorFinish.paint.code,'0501');
  const building = G.validate({ version: 2, floors: [{ plan: exterior }, { plan: null }, { plan: floor(), offsetX: 2 }] });
  const saved = G.validate(JSON.parse(JSON.stringify(building)));
  assert.equal(saved.floors[0].plan.finishes.exterior.paint.code,'0501');
  assert.equal(saved.floors[2].plan.finishes.wall,undefined,'other floors remain independent');
});

test('invalid paint metadata and catalogue entries are rejected while legacy finishes stay readable', () => {
  const valid = P.applyPaint(floor(),'wall',P.resolve(catalogue,'Buttercup')).finishes.wall;
  for (const paint of [null, {}, { ...valid.paint, brand: 'Unknown' }, { ...valid.paint, code: '<script>' }, { ...valid.paint, code: 1234 }, { ...valid.paint, name: 'x'.repeat(81) }]) {
    assert.throws(() => G.validateFinish({ ...valid, paint }), { status: 400 });
  }
  assert.throws(() => G.validateFinish({ ...valid, pattern: 'plaster' }), { status: 400 });
  assert.throws(() => P.applyPaint(floor(),'ceiling',P.resolve(catalogue,'Buttercup')));
  assert.throws(() => P.validateCatalogue({ brand: 'Asian Paints', shades: [{ code: 'bad', name: 'Fake', color: '#123' }] }));
  assert.deepEqual(G.validateFinish(F.DEFAULTS.wall),F.DEFAULTS.wall);
});
