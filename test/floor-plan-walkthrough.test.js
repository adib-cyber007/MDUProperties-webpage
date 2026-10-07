'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../public/floor-plan-geometry');
const { FT, createWalkCollision, walkthroughStart, walkthroughStep } = require('../src/floor-plan-walkthrough.cjs');

const segment = (kind, a, b) => ({ kind, a, b });
function twoRooms(opening = 'door') {
  return { width: 24, depth: 20, height: 10, thickness: .5, furniture: [], walls: [
    segment('wall', [.05, .05], [.95, .05]), segment('wall', [.95, .05], [.95, .95]),
    segment('wall', [.95, .95], [.05, .95]), segment('wall', [.05, .95], [.05, .05]),
    segment('wall', [.5, .05], [.5, .95]), segment(opening, [.5, .4], [.5, .6])
  ] };
}

test('walkthrough crosses real door cuts in both directions and stops at solid walls and windows', () => {
  const walk = createWalkCollision(twoRooms(), G);
  for (let x = -1; x <= 1; x += .05) assert.ok(walk.canWalk(x, 0), `door is open at ${x}`);
  assert.equal(walk.canWalk(0, 1.5), false, 'solid partition is blocked');
  assert.equal(createWalkCollision(twoRooms('window'), G).canWalk(0, 0), false, 'a window is not a passage');
  let p = { x: -.8, y: 0 };
  for (let i = 0; i < 32; i++) p = walkthroughStep(p, .05, 0, walk.canWalk);
  assert.ok(p.x > .7);
  for (let i = 0; i < 32; i++) p = walkthroughStep(p, -.05, 0, walk.canWalk);
  assert.ok(p.x < -.7);
});

test('walkthrough spawn avoids a central partition, rotated furniture and fully occupied floors', () => {
  const plan = twoRooms(); plan.walls.pop();
  plan.furniture = [{ type: 'sofa', center: [.25, .5], width: 5, depth: 3, rotation: 35 }];
  const walk = createWalkCollision(plan, G), start = walkthroughStart(walk);
  assert.ok(start && walk.canWalk(start.x, start.y));
  assert.equal(walk.canWalk(-6 * FT, 0), false);
  plan.furniture = [{ type: 'other', center: [.5, .5], width: 100, depth: 100, rotation: 0 }];
  assert.equal(walkthroughStart(createWalkCollision(plan, G)), null);
});

test('concave outside space stays blocked even without a wall directly in the path', () => {
  const points = [[.05, .05], [.95, .05], [.95, .35], [.35, .35], [.35, .95], [.05, .95]];
  const plan = { width: 30, depth: 30, height: 10, thickness: .5,
    walls: points.map((a, i) => segment('wall', a, points[(i + 1) % points.length])) };
  const walk = createWalkCollision(plan, G);
  assert.equal(walk.canWalk(0, 0), false, 'center of the bounds is outside the L-shaped building');
  assert.equal(walk.canWalk(2, 2), false);
  const start = walkthroughStart(walk); assert.ok(start && walk.canWalk(start.x, start.y));
});

test('movement slides along a wall while preserving safe clearance and the prepared snapshot', () => {
  const plan = twoRooms(); plan.walls.pop();
  const walk = createWalkCollision(plan, G);
  const p = { x: -.3, y: 1 };
  const next = walkthroughStep(p, .15, -.1, walk.canWalk);
  assert.equal(next.x, p.x); assert.equal(next.y, .9);
  plan.walls.length = 0;
  assert.equal(walk.canWalk(0, 1), false, 'movement queries retain the snapshot');
});

test('walkthrough respects the slab boundary for an incomplete drawing and low ceilings', () => {
  const plan = { width: 20, depth: 20, height: 6, thickness: .5,
    walls: [segment('wall', [.1, .1], [.9, .1]), segment('wall', [.9, .1], [.9, .9])] };
  const walk = createWalkCollision(plan, G);
  const start = walkthroughStart(walk); assert.ok(start && walk.canWalk(start.x, start.y));
  assert.equal(walk.canWalk(100, 0), false);
  assert.ok(walk.eyeHeight < plan.height * FT);
});
