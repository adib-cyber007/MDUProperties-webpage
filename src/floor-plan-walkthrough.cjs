'use strict';

// Movement and sliding are adapted from FLRplanner/shared/walkthrough.ts.
// Prepare the site's feet-based, traced plan once; movement queries use metres.
const FT = .3048;
const WALK_RADIUS = .18;
const EYE_HEIGHT = 1.65;
const CLEAR_HEIGHT = EYE_HEIGHT + .12;

function collisionBox(box) {
  return { x: box.x * FT, y: box.z * FT, halfWidth: box.width * FT / 2,
    halfDepth: box.depth * FT / 2, cos: Math.cos(box.angle), sin: Math.sin(box.angle) };
}

function hitsBox(x, y, box, radius = WALK_RADIUS) {
  return distanceToBox(x, y, box) < radius;
}

function distanceToBox(x, y, box) {
  const dx = x - box.x, dy = y - box.y;
  const along = Math.abs(dx * box.cos + dy * box.sin) - box.halfWidth;
  const across = Math.abs(-dx * box.sin + dy * box.cos) - box.halfDepth;
  return Math.hypot(Math.max(0, along), Math.max(0, across));
}

// Seal doors and windows only while finding the interior. Collision uses the
// actual rendered opening cuts below, so doors stay traversable, windows don't.
function interiorMask(plan, bounds) {
  const thickness = plan.thickness * FT;
  const padding = Math.max(.6, thickness * 2);
  const step = Math.max(.035, (Math.max(bounds.width, bounds.depth) + 2 * padding) / 320);
  const left = bounds.x - bounds.width / 2 - padding;
  const top = bounds.y - bounds.depth / 2 - padding;
  const cols = Math.ceil((bounds.width + 2 * padding) / step) + 1;
  const rows = Math.ceil((bounds.depth + 2 * padding) / step) + 1;
  const mask = new Uint8Array(cols * rows), queue = new Int32Array(mask.length);
  const radius = thickness / 2 + step * .8, cells = Math.ceil(radius / step);
  for (const wall of plan.walls || []) {
    const ax = (wall.a[0] - .5) * plan.width * FT, ay = (wall.a[1] - .5) * plan.depth * FT;
    const dx = (wall.b[0] - wall.a[0]) * plan.width * FT, dy = (wall.b[1] - wall.a[1]) * plan.depth * FT;
    const count = Math.max(1, Math.ceil(Math.hypot(dx, dy) / step * 2));
    for (let i = 0; i <= count; i++) {
      const px = (ax + dx * i / count - left) / step, py = (ay + dy * i / count - top) / step;
      const cx = Math.round(px), cy = Math.round(py);
      for (let y = Math.max(0, cy - cells); y <= Math.min(rows - 1, cy + cells); y++)
        for (let x = Math.max(0, cx - cells); x <= Math.min(cols - 1, cx + cells); x++)
          if (Math.hypot(x - px, y - py) * step <= radius) mask[y * cols + x] = 2;
    }
  }
  let head = 0, tail = 1;
  queue[0] = 0; mask[0] = 1;
  while (head < tail) {
    const index = queue[head++], x = index % cols, y = Math.floor(index / cols);
    for (const next of [x > 0 ? index - 1 : -1, x < cols - 1 ? index + 1 : -1,
      y > 0 ? index - cols : -1, y < rows - 1 ? index + cols : -1]) {
      if (next >= 0 && mask[next] === 0) { mask[next] = 1; queue[tail++] = next; }
    }
  }
  const enclosed = mask.some(value => value === 0);
  return (x, y) => {
    // Partial drawings still support a preview within their presentation slab.
    if (!enclosed) return true;
    const col = Math.round((x - left) / step), row = Math.round((y - top) / step);
    return col >= 0 && col < cols && row >= 0 && row < rows && mask[row * cols + col] !== 1;
  };
}

function createWalkCollision(plan, geometry) {
  const footprint = geometry.footprint(plan);
  const bounds = { x: footprint.x * FT, y: footprint.z * FT,
    width: footprint.width * FT, depth: footprint.depth * FT };
  const inside = interiorMask(plan, bounds);
  const obstacles = geometry.boxes({ ...plan, furniture: [] })
    .filter(box => ['wall', 'glass', 'frame'].includes(box.material) &&
      (box.y - box.height / 2) * FT < CLEAR_HEIGHT && (box.y + box.height / 2) * FT > .05)
    .map(collisionBox);
  for (const item of plan.furniture || []) obstacles.push(collisionBox({
    x: (item.center[0] - .5) * plan.width, z: (item.center[1] - .5) * plan.depth,
    width: item.width, depth: item.depth, angle: item.rotation * Math.PI / 180
  }));
  const canWalk = (x, y) => Math.abs(x - bounds.x) <= bounds.width / 2 - WALK_RADIUS &&
    Math.abs(y - bounds.y) <= bounds.depth / 2 - WALK_RADIUS && inside(x, y) &&
    !obstacles.some(box => hitsBox(x, y, box));
  // Choose a room's clear centre rather than the gap in a central partition.
  // Closed doorway spans affect the starting position only, never movement.
  const spawnWalls = (plan.walls || []).map(wall => {
    const dx = (wall.b[0] - wall.a[0]) * plan.width, dy = (wall.b[1] - wall.a[1]) * plan.depth;
    return collisionBox({ x: ((wall.a[0] + wall.b[0]) / 2 - .5) * plan.width,
      z: ((wall.a[1] + wall.b[1]) / 2 - .5) * plan.depth,
      width: Math.hypot(dx, dy), depth: plan.thickness, angle: Math.atan2(dy, dx) });
  });
  const clearance = (x, y) => Math.min(bounds.width / 2 - Math.abs(x - bounds.x),
    bounds.depth / 2 - Math.abs(y - bounds.y),
    ...spawnWalls.map(box => distanceToBox(x, y, box)), ...obstacles.map(box => distanceToBox(x, y, box)));
  return { bounds, canWalk, clearance, eyeHeight: Math.min(EYE_HEIGHT, plan.height * FT - .15) };
}

/** FLRplanner's bounded interior search, adapted to the site's traced walls. */
function walkthroughStart({ bounds, canWalk, clearance }) {
  let best = canWalk(bounds.x, bounds.y) ? { x: bounds.x, y: bounds.y } : null;
  let bestClearance = best ? clearance(best.x, best.y) : -1, distance = best ? 0 : Infinity;
  for (let row = 1; row < 40; row++) for (let col = 1; col < 40; col++) {
    const x = bounds.x + bounds.width * (col / 40 - .5);
    const y = bounds.y + bounds.depth * (row / 40 - .5);
    if (!canWalk(x, y)) continue;
    const nextDistance = Math.hypot(x - bounds.x, y - bounds.y), nextClearance = clearance(x, y);
    if (nextClearance > bestClearance + .001 || (Math.abs(nextClearance - bestClearance) < .001 && nextDistance < distance)) {
      best = { x, y }; distance = nextDistance; bestClearance = nextClearance;
    }
  }
  return best;
}

/** From FLRplanner: slide along a wall when diagonal movement is blocked. */
function walkthroughStep(position, dx, dy, canWalk) {
  const target = { x: position.x + dx, y: position.y + dy };
  if (canWalk(target.x, target.y)) return target;
  const next = { ...position };
  if (canWalk(target.x, next.y)) next.x = target.x;
  if (canWalk(next.x, target.y)) next.y = target.y;
  return next;
}

module.exports = { FT, WALK_RADIUS, EYE_HEIGHT, createWalkCollision, walkthroughStart, walkthroughStep };
