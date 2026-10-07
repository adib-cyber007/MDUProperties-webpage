'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../public/floor-plan-geometry');
const { createRecognizer } = require('../floor-plan-recognition');
const image = 'data:image/png;base64,AAAA';
const wall = (a, b, kind = 'wall') => ({ kind, a, b });
const boundary = [wall([.2,.2], [.8,.2]), wall([.8,.2], [.8,.8]), wall([.8,.8], [.2,.8]), wall([.2,.8], [.2,.2])];
const fixture = (center, type = 'sink') => ({ type, center, width: 2, depth: 2, rotation: 0, source: 'detected' });
const region = { type: 'Kitchen', confidence: .94, polygon: [[.22,.22], [.78,.22], [.78,.78], [.22,.78]] };
const plan = () => ({ version: 1, image, width: 30, depth: 30, height: 10, thickness: .5, walls: boundary,
  recognition: { engine: 'cubicasa5k', regions: [region], inferenceMs: 120 } });

test('FLRplanner furniture review excludes page legends and prefers neural fixtures over duplicate rule proposals', () => {
  const sink = fixture([.5,.5]), legend = fixture([.92,.92]), chair = fixture([.7,.7], 'chair');
  const result = { walls: boundary, furniture: [sink, legend] };
  const before = JSON.stringify(result);
  const reviewed = G.recognitionFurniture(result, [fixture([.51,.5]), legend, chair], 30, 30);
  assert.deepEqual(reviewed, [sink, chair]);
  assert.equal(JSON.stringify(result), before, 'review never mutates model predictions');
  assert.deepEqual(G.recognitionFurniture({ walls: [], furniture: [sink] }, [chair], 30, 30), []);
});

test('opening surrounds fill only missing spans and preserve existing walls and door direction', () => {
  const segments = [wall([.2,.2], [.35,.2]), wall([.5,.2], [.8,.2]),
    { ...wall([.3,.2], [.6,.2], 'door'), hinge: 'b', swing: -1 }];
  const surrounded = G.surroundOpenings(segments, 30, 30);
  assert.equal(surrounded.length, segments.length + 1);
  assert.deepEqual(surrounded.slice(0, segments.length), segments);
  assert.ok(Math.abs(surrounded.at(-1).a[0] - .35) < 1e-9);
  assert.ok(Math.abs(surrounded.at(-1).b[0] - .5) < 1e-9);
  assert.deepEqual(G.surroundOpenings(surrounded, 30, 30), surrounded, 'repeated review adds no duplicate spans');
  const cut = G.cutWalls({ width: 30, depth: 30, thickness: .5, walls: surrounded });
  assert.equal(cut.filter(w => w.kind === 'door').length, 1);
  assert.ok(cut.filter(w => w.kind === 'wall').every(w => Math.max(...[w.a,w.b].map(p=>p[0])) <= .300001 || Math.min(...[w.a,w.b].map(p=>p[0])) >= .599999));
  const diagonal = [wall([.1,.1], [.3,.3]), wall([.5,.5], [.9,.9]), wall([.3,.3], [.5,.5], 'window')];
  const rotated = G.surroundOpenings(diagonal, 60, 30);
  assert.equal(rotated.length, 4);
  assert.deepEqual(G.surroundOpenings(rotated, 60, 30), rotated);
  assert.deepEqual(G.surroundOpenings([segments[2]], 30, 30), [segments[2]], 'openings alone never invent structure');
});

test('predicted room outlines survive saving and scaling without generating extra room walls', () => {
  const checked = G.validate(plan());
  assert.deepEqual(G.validate(JSON.parse(JSON.stringify(checked))).recognition, checked.recognition);
  assert.deepEqual(G.resizeDrawing(checked, 60, 40).recognition, checked.recognition, 'normalized room coordinates follow the same drawing scale');
  const building = G.validate({version:2, floors:[{plan:checked}], published:false});
  assert.deepEqual(building.floors[0].plan.recognition, checked.recognition);
  assert.equal(checked.walls.length, boundary.length, 'polygons are review data, not new wall boundaries');
  for (const bad of [
    {...region, polygon:[[0,0],[1,0],[1,2]]}, {...region, confidence:NaN}, {...region, type:'x'.repeat(81)},
    {...region, polygon:[[0,0],[1,0]]}, {...region, polygon:Array(1025).fill([.5,.5])}
  ]) assert.throws(()=>G.validate({...plan(), recognition:{engine:'cubicasa5k',regions:[bad]}}), {status:400});
  assert.throws(()=>G.validate({...plan(), recognition:{engine:'cubicasa5k',regions:Array(101).fill(region)}}), {status:400});
});

test('recognition API validates room predictions and removes outside fixtures without losing metadata alignment', async () => {
  const output = { engine:'cubicasa5k', walls:boundary, rooms:[region], inferenceMs:120,
    furniture:[{...fixture([.95,.95]),label:'Legend',confidence:.5},{...fixture([.5,.5]),label:'Sink',confidence:.91}] };
  const recognizer = payload => createRecognizer({baseUrl:'http://localhost:8765',fetchImpl:async()=>new Response(JSON.stringify(payload))});
  const reviewed = await recognizer(output).analyze({image,width:30,depth:30});
  assert.equal(reviewed.furniture.length, 1);
  assert.equal(reviewed.furniture[0].label, 'Sink');
  assert.equal(reviewed.furniture[0].confidence, .91);
  assert.deepEqual(reviewed.rooms, [region]);
  await assert.rejects(recognizer({...output, rooms:[{...region,polygon:[[0,0],[1,0],[1,2]]}]}).analyze({image,width:30,depth:30}), {status:502});
});
