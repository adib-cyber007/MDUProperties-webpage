'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');
const G = require('../public/floor-plan-geometry');
const { frameBounds } = require('../src/view-framing.cjs');
const fixture = () => ({ version: 1, image: 'data:image/png;base64,YQ==', width: 30, depth: 40, height: 10, thickness: .5, published: false, scaleConfirmed: true,
  walls: [{ kind: 'wall', a: [.25,.2], b: [.75,.2] }, { kind: 'wall', a: [.75,.2], b: [.75,.8] }, { kind: 'door', a: [.4,.2], b: [.5,.2] }],
  furniture: [{ type: 'appliance', center: [.6,.5], width: 1.5, depth: 2, rotation: 0, source: 'detected' }, { type: 'bed', center: [.4,.5], width: 5, depth: 6.5, rotation: 0, source: 'manual' }] });

test('building dimensions exclude drawing margins and resize detected fixtures without enlarging standard furniture', () => {
  const before = fixture(), plan = G.largeLayout(before);
  assert.ok(Math.abs(plan.width - 75) < 1e-8); assert.ok(Math.abs(plan.depth - 100) < 1e-8);
  assert.deepEqual(plan.walls, before.walls, 'tracing coordinates and opening positions survive');
  assert.equal(plan.height, 10); assert.equal(plan.thickness, .5);
  assert.equal(plan.scaleConfirmed, false); assert.equal(plan.published, false);
  assert.ok(Math.abs(G.wallSpan(plan).width - 37.5) < 1e-8); assert.ok(Math.abs(G.wallSpan(plan).depth - 60) < 1e-8);
  assert.ok(Math.abs(plan.furniture[0].width - 3.75) < 1e-8); assert.ok(Math.abs(plan.furniture[0].depth - 5) < 1e-8);
  assert.deepEqual(plan.furniture[1], before.furniture[1]);
  const sized = G.resizeBuilding(before, 40, 60);
  assert.ok(Math.abs(G.wallSpan(sized).width - 40) < 1e-8);
  assert.ok(Math.abs(G.wallSpan(sized).depth - 60) < 1e-8);
  const obj = G.toOBJ(sized); assert.match(obj, /Units: feet/);
  assert.ok(G.boxes(sized).some(box => box.material === 'wall' && box.width > 39));
  assert.throws(() => G.resizeBuilding({ ...before, walls: [] }, 40, 60), /outline/);
  assert.throws(() => G.resizeBuilding(before, 400, 400), /Drawing width/);
  const corrected = G.largeLayout(before, 60, 600, 600);
  assert.ok(Math.abs(corrected.width / corrected.depth - 1) < 1e-8, 'legacy default dimensions no longer squeeze a square drawing');
  assert.ok(Math.abs(Math.max(G.wallSpan(corrected).width,G.wallSpan(corrected).depth)-60) < 1e-8);
});

test('printed-distance calibration corrects the whole drawing and detected fixtures together', () => {
  const plan = G.calibrate(fixture(), [.25,.2], [.75,.2], 30, 600, 800);
  assert.equal(plan.width, 60); assert.equal(plan.depth, 80);
  assert.equal(plan.furniture[0].width, 3); assert.equal(plan.furniture[1].width, 5);
  assert.equal(plan.scaleConfirmed, true);
});

test('large and tall buildings fit every camera corner on portrait and landscape screens with less empty space', () => {
  for (const [min,max] of [[[-9,-.2,-12],[9,3,12]],[[-9,-.2,-12],[9,30,12]]]) for (const aspect of [.45,1,2.4]) {
    const fitted = frameBounds(min,max,aspect);
    const camera = new THREE.PerspectiveCamera(42,aspect,.03,1200);
    const center = new THREE.Vector3(...fitted.center);
    camera.position.copy(center).add(new THREE.Vector3(...fitted.direction).multiplyScalar(fitted.distance));
    camera.lookAt(center); camera.updateMatrixWorld();
    let occupancy = 0;
    for (const x of [min[0],max[0]]) for (const y of [min[1],max[1]]) for (const z of [min[2],max[2]]) {
      const screen = new THREE.Vector3(x,y,z).project(camera);
      assert.ok(Math.abs(screen.x) < 1 && Math.abs(screen.y) < 1 && screen.z < 1, 'the entire building fits without clipping');
      occupancy = Math.max(occupancy, Math.abs(screen.x), Math.abs(screen.y));
    }
    assert.ok(occupancy > .85, 'the model fills the available view');
    const oldDistance = new THREE.Vector3().subVectors(new THREE.Vector3(...max),new THREE.Vector3(...min)).length()/2 / Math.sin(42*Math.PI/360)*1.06/Math.min(1,aspect);
    if (max[1] < 5) assert.ok(fitted.distance < oldDistance, 'houses are framed more closely');
  }
});
