'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../public/floor-plan-geometry');
const { createWalkCollision } = require('../src/floor-plan-walkthrough.cjs');
const { realismFloor } = require('../scripts/helpers/realism-fixture');

test('presentation, room views and detailed fixtures survive building round trips', () => {
  const floor = realismFloor(), checked = G.validate(floor);
  assert.deepEqual(checked.presentation, floor.presentation);
  assert.equal(checked.furniture.find(i => i.type === 'stairs').height, 10);
  const building = G.validate({ version: 2, published: true, floors: [{ plan: floor }, { plan: { ...floor, presentation: { ...floor.presentation, roof: 'pitched', views: [] } } }] });
  assert.equal(building.floors[0].plan.presentation.views.length, 5);
  assert.equal(building.floors[1].plan.presentation.roof, 'pitched');
  assert.deepEqual(G.validate(JSON.parse(JSON.stringify(building))), building);
  assert.ok(G.toOBJ(checked).length > 1000);
  const legacy = { ...floor }; delete legacy.presentation;
  assert.equal(G.validate(legacy).presentation, undefined);
});

test('presentation rejects invalid or unbounded room and architecture data', () => {
  const floor = realismFloor(), view = floor.presentation.views[0];
  for (const p of [{ roof: 'unsafe' }, { skirting: 'true' }, { views: Array(17).fill(view) }, { views: [{ ...view, center: [-1, .5] }] },
    { views: [{ ...view, name: '' }] }, { views: [{ ...view, heading: NaN }] }, { views: [{ ...view, width: 501 }] }, { views: [{ ...view, notes: 'x'.repeat(601) }] }]) {
    assert.throws(() => G.validate({ ...floor, presentation: p }), { status: 400 });
  }
  assert.throws(() => G.validate({ ...floor, furniture: [{ ...floor.furniture[0], height: -1 }] }), { status: 400 });
});

test('guided room positions are clear; overhead lights and rugs do not obstruct walking', () => {
  const floor = realismFloor(), walk = createWalkCollision(floor, G);
  for (const view of floor.presentation.views) assert.ok(walk.canWalk((view.center[0] - .5) * floor.width * .3048, (view.center[1] - .5) * floor.depth * .3048), `${view.name} is a clear standing position`);
  const bare = { ...floor, furniture: [] }, fixtures = { ...bare, furniture: [{ type: 'rug', center: [.45,.6], width: 4, depth: 4, rotation: 0 }, { type: 'ceiling_light', center: [.45,.6], width: 2, depth: 2, rotation: 0 }] };
  const x = (.45 - .5) * floor.width * .3048, z = (.6 - .5) * floor.depth * .3048;
  assert.equal(createWalkCollision(fixtures, G).canWalk(x,z), createWalkCollision(bare,G).canWalk(x,z));
  assert.equal(walk.canWalk((.1 - .5) * floor.width * .3048, (.24 - .5) * floor.depth * .3048), false, 'stairs stay blocked until floor traversal is implemented');
});
