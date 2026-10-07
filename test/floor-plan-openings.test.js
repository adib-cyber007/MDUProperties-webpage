'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Openings = require('../public/floor-plan-openings');
const G = require('../public/floor-plan-geometry');

// Rasterize independently of the recognizer: shaded paper, thin grey symbols,
// a wall gap, and a glazed opening, rotated together in drawing coordinates.
function drawing(degrees, symbols = true, scale = 1, darkAnnotation = false) {
  const width = 400 * scale, height = 400 * scale, data = new Uint8ClampedArray(width * height * 4);
  const angle = degrees * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const point = (x, y) => [(200 + x * c - y * s) / 400, (200 + x * s + y * c) / 400];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = (x / scale - 200) * c + (y / scale - 200) * s, v = -(x / scale - 200) * s + (y / scale - 200) * c;
    let shade = 210;
    if (Math.abs(u) <= 150 && Math.abs(v + 80) <= 1.5 && (u <= -60 || u >= -30)) shade = 145;
    if (symbols && u >= -60 && v >= -80 && Math.abs(Math.hypot(u + 60, v + 80) - 30) <= .65) shade = 160;
    if (symbols && Math.abs(u + 60) <= .65 && v >= -80 && v <= -50) shade = 160;
    if (Math.abs(u) <= 150 && Math.abs(v - 60) <= 3.5) {
      shade = 145;
      if (symbols && u >= 40 && u <= 100 && Math.abs(v - 60) < 2.3) shade = 210;
    }
    // A detached furniture rectangle must never become an opening.
    if ((Math.abs(u + 70) < 25 && Math.abs(v - 15) < .7) || (Math.abs(u + 95) < .7 && v > -15 && v < 15)) shade = 165;
    if (darkAnnotation && x < 30 * scale && y < 30 * scale) shade = 20;
    data.set([shade, shade, shade, 255], (y * width + x) * 4);
  }
  return { image: { width, height, data }, point, walls: [
    { kind: 'wall', a: point(-150, -80), b: point(-60, -80) },
    { kind: 'wall', a: point(-30, -80), b: point(150, -80) },
    { kind: 'wall', a: point(-150, 60), b: point(150, 60) }
  ] };
}

test('faint door and window symbols survive rotation, with furniture and blank gaps excluded', () => {
  for (const angle of [0, 30, 90]) {
    const { image, point, walls } = drawing(angle);
    const found = Openings.detect(image, walls);
    const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) * image.width;
    const door = found.find(o => o.kind === 'door' && distance(o.a, point(-60, -80)) < 5 && distance(o.b, point(-30, -80)) < 5);
    assert.ok(door, `door at ${angle} degrees: ${JSON.stringify(found)}`);
    assert.equal(door.hinge, 'a'); assert.equal(door.swing, 1);
    assert.ok(found.some(o => o.kind === 'window' && distance(o.a, point(40, 60)) < 6 && distance(o.b, point(100, 60)) < 6), `window at ${angle} degrees: ${JSON.stringify(found)}`);
    assert.equal(found.length, 2, 'no openings inferred from furniture or room fill');
    const negative = drawing(angle, false);
    assert.deepEqual(Openings.detect(negative.image, negative.walls), [], 'blank passages and solid walls are not classified as doors/windows');
  }
});

test('faint windows remain recognizable beside dark annotations and at larger scan sizes', () => {
  for (const scale of [1, 2, 3]) {
    const { image, walls, point } = drawing(0, true, scale, true);
    const found = Openings.detect(image, walls);
    const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < .02;
    assert.ok(found.some(o => o.kind === 'window' && close(o.a, point(40, 60)) && close(o.b, point(100, 60))), `window at ${scale}x: ${JSON.stringify(found)}`);
    assert.ok(found.some(o => o.kind === 'door' && close(o.a, point(-60, -80)) && close(o.b, point(-30, -80))), `door at ${scale}x: ${JSON.stringify(found)}`);
    const negative = drawing(0, false, scale, true);
    assert.deepEqual(Openings.detect(negative.image, negative.walls), []);
  }
});

test('a continuous double-line wall is not a full-length window', () => {
  const width = 400, height = 400, data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const y of [97, 103]) for (let x = 40; x <= 360; x++) data.set([20, 20, 20, 255], (y * width + x) * 4);
  assert.deepEqual(Openings.detect({width, height, data}, [{kind:'wall', a:[.1,.25], b:[.9,.25]}]), []);
});

test('small bounded glazing is detected without promoting continuous outlined walls', () => {
  const width=200,height=200,data=new Uint8ClampedArray(width*height*4).fill(255);
  for(let x=20;x<=180;x++) for(let y=97;y<=103;y++) {
    const shade=x>=90 && x<=103 && y>98 && y<102 ? 255 : 30;
    data.set([shade,shade,shade,255],(y*width+x)*4);
  }
  const walls=[{kind:'wall',a:[.1,.5],b:[.9,.5]}];
  const found=Openings.detect({width,height,data},walls);
  assert.equal(found.length,1); assert.equal(found[0].kind,'window');
  assert.ok(Math.abs(found[0].a[0]*width-90)<3 && Math.abs(found[0].b[0]*width-103)<3);
});

test('door symbols larger than 130 pixels remain recognizable on large supported scans', () => {
  const {image,walls,point}=drawing(0,true,5);
  const found=Openings.detect(image,walls);
  assert.ok(found.some(o=>o.kind==='door' && Math.hypot(o.a[0]-point(-60,-80)[0],o.a[1]-point(-60,-80)[1])<.02 &&
    Math.hypot(o.b[0]-point(-30,-80)[0],o.b[1]-point(-30,-80)[1])<.02));
});

test('detected hinge and swing persist and place the door leaf on the correct side on upper floors', () => {
  const image = 'data:image/png;base64,AAAA';
  for (const hinge of ['a', 'b']) for (const swing of [-1, 1]) {
    const door = { kind: 'door', a: [.3, .4], b: [.4, .4], hinge, swing };
    const plan = G.validate({ version: 1, image, width: 30, depth: 40, height: 10, thickness: .5,
      walls: [{ kind: 'wall', a: [.1, .4], b: [.9, .4] }, door] });
    assert.deepEqual(plan.walls[1], door);
    const leaf = G.boxes(plan).find(b => b.material === 'door');
    assert.equal(Math.sign(leaf.z - (door.a[1] - .5) * plan.depth), swing * (hinge === 'a' ? 1 : -1));
    const building = G.validate({version:2, floors:[{plan},{plan}]});
    const leaves = G.boxes(building).filter(b => b.material === 'door');
    assert.equal(leaves[1].y - leaves[0].y, 10.5);
    assert.equal(leaves[1].angle, leaves[0].angle);
    assert.throws(() => G.validate({...plan, walls:[{...door, hinge:'middle'}]}), /hinge/);
    assert.throws(() => G.validate({...plan, walls:[{...door, swing:0}]}), /swing/);
  }
});

test('door-symbol cleanup respects both hinges, swing sides and rotated walls', () => {
  for(const angle of [0,30,90]) for(const hinge of ['a','b']) for(const swing of [-1,1]) {
    const theta = angle*Math.PI/180, ux=Math.cos(theta), uy=Math.sin(theta);
    const door = {kind:'door', a:[.35,.4], b:[.35+ux*.1,.4+uy*.1], hinge, swing};
    const p = door[hinge], sign=hinge==='a'?1:-1;
    const leaf = {kind:'wall', a:p, b:[p[0]-uy*.1*sign*swing,p[1]+ux*.1*sign*swing]};
    const partition = {...leaf,b:[p[0]-uy*.3*sign*swing,p[1]+ux*.3*sign*swing]};
    const neighboring = {kind:'wall',a:[.1,.1],b:[.1,.9]};
    assert.deepEqual(Openings.removeDoorLeaves([leaf,partition,neighboring],[door],400,400),[partition,neighboring]);
    assert.deepEqual(Openings.removeDoorLeaves([leaf],[],400,400),[leaf], 'unrecognized leaves are not silently erased');
  }
});
