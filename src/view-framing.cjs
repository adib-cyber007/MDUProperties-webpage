'use strict';
// Fit every bounding-box corner against both perspective frustum axes. A
// bounding sphere adds substantial empty space to flat houses, especially on
// portrait screens. Coordinates and the returned distance use the same units.
function frameBounds(min, max, aspect, fov = 42, direction = [.85, 1.35, 1.05], padding = 1.04) {
  const norm = v => { const n = Math.hypot(...v); return v.map(x => x / n); };
  const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  const forward = norm(direction), right = norm([forward[2], 0, -forward[0]]);
  const up = [forward[1] * right[2] - forward[2] * right[1], forward[2] * right[0] - forward[0] * right[2], forward[0] * right[1] - forward[1] * right[0]];
  const center = min.map((v, i) => (v + max[i]) / 2);
  const tangentY = Math.tan(fov * Math.PI / 360), tangentX = tangentY * Math.max(.05, aspect);
  let distance = .7;
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
    const point = [x, y, z].map((v, i) => v - center[i]), near = dot(point, forward);
    distance = Math.max(distance, near + Math.max(Math.abs(dot(point, right)) / tangentX, Math.abs(dot(point, up)) / tangentY) * padding, near + .1);
  }
  return { center, distance, direction: forward };
}
module.exports = { frameBounds };
