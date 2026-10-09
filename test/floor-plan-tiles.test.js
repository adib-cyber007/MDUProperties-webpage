'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../public/floor-plan-geometry');
const T = require('../public/floor-plan-tiles');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=';

test('floor tiles preserve painted walls, geometry, furniture and the previous saved model', () => {
  const paint = { pattern: 'solid', color: '#debc97', accent: '#debc97', scale: 3, rotation: 0, paint: { brand: 'Asian Paints', name: 'Buttercup-N', code: '0336' } };
  const plan = G.validate({ version: 1, image: pixel, width: 24, depth: 20, height: 10, thickness: .5,
    walls: [{ kind: 'wall', a: [.1,.1], b: [.9,.1], finish: paint }],
    furniture: [{ type: 'sofa', center: [.5,.5], width: 6, depth: 2.8, rotation: 0 }], finishes: { wall: paint, exterior: paint } });
  const before = JSON.stringify(plan);
  const finish = T.createFinish('White marble', 2, '#665544', 45);
  const tiled = T.applyTiles(plan, finish);
  assert.deepEqual(tiled.walls, plan.walls); assert.deepEqual(tiled.furniture, plan.furniture);
  assert.deepEqual(tiled.finishes.wall, paint); assert.deepEqual(tiled.finishes.exterior, paint);
  assert.equal(tiled.finishes.floor.scale / 2, 2, 'each of the two tiles in a repeat measures two feet');
  assert.equal(tiled.finishes.floor.rotation, 45);
  assert.deepEqual(tiled.finishes.floor.tile, { name: 'White marble', grout: '#665544' });
  assert.equal(JSON.stringify(plan), before, 'Undo can retain the unmodified previous model');
  const building = G.validate({ version: 2, floors: [{ plan: tiled }, { plan }] });
  assert.equal(building.floors[1].plan.finishes.floor, undefined, 'other floors keep their flooring');
  assert.deepEqual(G.validate(JSON.parse(JSON.stringify(building))), building);
});

test('tile finishes round-trip without losing names, grout or physical size and reject malformed settings', () => {
  for (const style of T.STYLES) {
    const finish = T.createFinish(style.name, 1.5, '#D0C0B0', 90);
    assert.deepEqual(G.validateFinish(JSON.parse(JSON.stringify(finish))), finish);
    assert.equal(finish.tile.grout, '#d0c0b0'); assert.equal(finish.scale / 2, 1.5);
  }
  for (const [name, size, grout, rotation] of [
    ['Missing tiles', 2, '#ffffff', 0], ['White porcelain', 0, '#ffffff', 0],
    ['White porcelain', NaN, '#ffffff', 0], ['White porcelain', 11, '#ffffff', 0],
    ['White porcelain', 2, 'grey', 0], ['White porcelain', 2, '#ffffff', Infinity]
  ]) assert.throws(() => T.createFinish(name, size, grout, rotation));
  const finish = T.createFinish('White porcelain', 2, '#cccccc');
  for (const invalid of [{ ...finish, pattern: 'wood' }, { ...finish, tile: null }, { ...finish, tile: { name: ' ', grout: '#ffffff' } }]) assert.throws(() => G.validateFinish(invalid), { status: 400 });
});
