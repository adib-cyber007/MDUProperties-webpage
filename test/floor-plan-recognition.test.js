'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Detection = require('../public/floor-plan-detection');

// The browser worker only proposes furniture. Structural recognition is
// verified through the model API and browser integration tests.
function analyze(pixels, plan, mode) {
  let result;
  const context = vm.createContext({ self: { postMessage: value => { result = JSON.parse(JSON.stringify(value)); } } });
  context.importScripts = (...urls) => {
    for (const url of urls) {
      const name = path.basename(url.split('?')[0]);
      assert.equal(name, 'floor-plan-furniture.js', 'legacy structural recognizers are not loaded');
      context.FloorPlanFurniture = require(path.join(__dirname, '../public', name));
    }
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/floor-plan-worker.js'), 'utf8'), context);
  context.self.onmessage({ data: { id: 7, pixels, plan, mode } });
  assert.equal(result.id, 7);
  return result;
}

test('browser worker refuses structural recognition instead of substituting legacy geometry', () => {
  const pixels = { width: 40, height: 40, data: new Uint8ClampedArray(6400).fill(255) };
  for (const mode of [undefined, 'all', 'openings']) {
    const result = analyze(pixels, { width: 30, depth: 40, walls: [], furniture: [] }, mode);
    assert.match(result.error, /must use the pretrained floor plan service/);
    assert.equal(result.walls, undefined);
  }
});

test('furniture suggestions preserve model walls and exclude the enclosing building', () => {
  for (const outlined of [false, true]) {
    const width = 800, height = 800, data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let y = 197; y <= 403; y++) for (let x = 147; x <= 353; x++) {
      const edge = Math.min(x - 147, 353 - x, y - 197, 403 - y);
      if (outlined ? edge === 0 || edge === 6 : edge <= 6) data.set([30,30,30,255], (y * width + x) * 4);
    }
    const points = [[.1875,.25],[.4375,.25],[.4375,.5],[.1875,.5]];
    const walls = points.map((a, i) => ({ kind: 'wall', a, b: points[(i + 1) % 4] }));
    const plan = { width: 30, depth: 40, walls, furniture: [] }, before = JSON.stringify(plan);
    const result = analyze({ width, height, data }, plan, 'furniture');
    assert.equal(result.error, undefined);
    assert.deepEqual(result.walls, [], 'worker never returns structural geometry');
    assert.equal(result.furniture.length, 0, 'building outline is not a furniture item');
    assert.equal(JSON.stringify(plan), before);
  }
});

test('single-stroke wall drawings and isolated wall sections remain supported', () => {
  const width=400, height=400, data=new Uint8ClampedArray(width*height*4).fill(255);
  for(let t=40;t<=360;t++) for(const [x,y] of [[t,40],[t,360],[40,t],[360,t]]) data.set([30,30,30,255],(y*width+x)*4);
  const walls=Detection.detect({width,height,data});
  assert.equal(walls.length,4);
});

test('many long text strokes are filtered before enforcing the model segment limit', () => {
  const width=400,height=700,data=new Uint8ClampedArray(width*height*4).fill(255);
  const stroke=(x0,y0,x1,y1)=>{for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)data.set([30,30,30,255],(y*width+x)*4);};
  stroke(20,20,380,26);stroke(20,674,380,680);stroke(20,20,26,680);stroke(374,20,380,680);
  for(let row=0;row<11;row++) for(let col=0;col<8;col++) {
    const x=45+col*42,y=45+row*56;
    stroke(x,y,x+1,y+30);
    for(const dy of [0,15,30])stroke(x,y+dy,x+24,y+dy+1);
  }
  const image={width,height,data};
  assert.ok(Detection.detect(image,{includeDetached:true}).length>250,'fixture has more raw strokes than the model limit');
  const walls=Detection.detect(image);
  assert.equal(walls.length,4,'letter strokes must not connect across whitespace as doorway stubs');
});
