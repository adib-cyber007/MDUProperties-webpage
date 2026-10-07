'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');
const G = require('../public/floor-plan-geometry');
const { frameBounds } = require('../src/view-framing.cjs');
const image = 'data:image/png;base64,AAAA';
const plan = () => ({ version: 1, image, width: 30, depth: 40, height: 10, thickness: .5, scaleConfirmed: true,
  walls: [{ kind: 'wall', a: [.25,.2], b: [.75,.2] }, { kind: 'wall', a: [.75,.2], b: [.75,.8] },
    { kind: 'wall', a: [.75,.8], b: [.25,.8] }, { kind: 'wall', a: [.25,.8], b: [.25,.2] },
    { kind: 'door', a: [.4,.2], b: [.5,.2] }],
  furniture: [{ type: 'sink', center: [.6,.6], width: 2, depth: 2, rotation: 0, source: 'detected' },
    { type: 'sofa', center: [.4,.6], width: 6, depth: 2.8, rotation: 0, source: 'manual' }] });

test('building dimensions exclude page margins and resize openings and detected fixtures', () => {
  const original = plan(), resized = G.resizeBuilding(original, 30, 48);
  assert.equal(resized.width, 60); assert.ok(Math.abs(resized.depth - 80) < 1e-9);
  assert.deepEqual(resized.walls, original.walls, 'image coordinates stay aligned');
  assert.equal(resized.height, 10); assert.equal(resized.thickness, .5);
  assert.equal(resized.furniture[0].width, 4); assert.equal(resized.furniture[1].width, 6);
  assert.equal(resized.scaleConfirmed, false); assert.equal(resized.published, false);
  const doors = G.boxes(resized).filter(b => b.material === 'door');
  assert.ok(doors.length); assert.ok(doors.every(b => b.width > 5), 'door exports use enlarged physical geometry');
  assert.equal(original.width, 30, 'the old draft remains undoable');
});

test('large provisional layouts preserve proportions and survive saved building validation', () => {
  const enlarged = G.largeLayout(plan());
  const span = G.wallSpan(enlarged);
  assert.ok(Math.abs(Math.max(span.width, span.depth) - 60) < 1e-9);
  assert.ok(Math.abs(span.width / span.depth - 15 / 24) < 1e-9);
  const saved = G.validate({ version: 2, floors: [{ plan: enlarged }] });
  assert.deepEqual(saved.floors[0].plan.walls, enlarged.walls);
  assert.equal(saved.floors[0].plan.width, enlarged.width);
  assert.throws(() => G.resizeBuilding({ ...plan(), walls: [] }, 40, 60), /outline/);
  assert.throws(() => G.resizeBuilding(plan(), 1000, 60), /Building width/);
});

test('printed measurements recalibrate detected fixtures and preserve manual asset sizes', () => {
  const calibrated = G.calibrate(plan(), [.25,.2], [.75,.2], 30, 600, 800);
  assert.equal(calibrated.width, 60); assert.equal(calibrated.depth, 80);
  assert.equal(calibrated.furniture[0].width, 4); assert.equal(calibrated.furniture[1].width, 6);
  assert.equal(calibrated.scaleConfirmed, true);
});

test('camera framing fills portrait and landscape previews without clipping the building', () => {
  const min = [-12,0,-18], max = [12,3,18];
  for (const aspect of [.4, .8, 1, 2.2]) {
    const frame = frameBounds(min, max, aspect);
    const camera = new THREE.PerspectiveCamera(42, aspect, .03, 1200);
    camera.position.fromArray(frame.center).add(new THREE.Vector3().fromArray(frame.direction).multiplyScalar(frame.distance));
    camera.lookAt(new THREE.Vector3().fromArray(frame.center)); camera.updateMatrixWorld();
    let extent = 0;
    for (const x of [min[0],max[0]]) for (const y of [min[1],max[1]]) for (const z of [min[2],max[2]]) {
      const projected = new THREE.Vector3(x,y,z).project(camera);
      extent = Math.max(extent, Math.abs(projected.x), Math.abs(projected.y));
      assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1, `corner fits at aspect ${aspect}`);
    }
    assert.ok(extent > .88, 'preview makes good use of the available space');
    const oldDistance = Math.hypot(24,3,36) / 2 / Math.sin(21 * Math.PI / 180) * 1.06 / Math.min(1,aspect);
    assert.ok(frame.distance < oldDistance, 'the oversized sphere no longer shrinks the house');
  }
});
