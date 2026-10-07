(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FloorPlanOpenings = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Only symbols corroborated by a structural wall are promoted to openings.
  // Ambiguous plans still need the editor's manual Doorway / Window tools.
  function detect(image, walls) {
    const { width, height, data } = image;
    if (!walls?.length || !data || data.length !== width * height * 4) return [];
    const gray = new Uint8Array(width * height), ink = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i++) {
      const j = i * 4, alpha = data[j + 3] / 255;
      gray[i] = Math.round((data[j] * .299 + data[j + 1] * .587 + data[j + 2] * .114) * alpha + 255 * (1 - alpha));
      ink[i] = gray[i] < 120 ? 1 : 0;
    }
    const nearInk = new Uint8Array(ink.length);
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      nearInk[i] = ink[i] || ink[i - 1] || ink[i + 1] || ink[i - width] || ink[i + width] ? 1 : 0;
    }
    const sample = (field, x, y) => {
      x = Math.round(x); y = Math.round(y);
      return x >= 0 && y >= 0 && x < width && y < height ? field[y * width + x] : 0;
    };
    const structural = walls.filter(wall => wall.kind === 'wall');
    if (!structural.length) return [];
    const xs = structural.flatMap(wall => [wall.a[0] * width, wall.b[0] * width]);
    const ys = structural.flatMap(wall => [wall.a[1] * height, wall.b[1] * height]);
    const span = Math.max(80, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
    // Sample symbol cross-sections in drawing-relative units, so larger
    // exports do not push window frames outside a fixed seven-pixel band.
    const symbolScale = Math.max(1, Math.min(4, span / 320));
    const minimumWindow = Math.max(8, 16 * Math.min(1, span / 320)) * symbolScale;
    const minRadius = Math.max(8, Math.round(span * .045));
    const maxRadius = Math.max(32, Math.min(256, Math.round(span * .17)));
    const stride = Math.max(1, Math.round(span / 350));
    const arcSamples = Array.from({ length: 11 }, (_, k) => {
      const angle = (k + 1) * Math.PI / 24;
      return [Math.cos(angle), Math.sin(angle)];
    });
    const axes = structural.map(wall => {
      const a = [wall.a[0] * width, wall.a[1] * height], b = [wall.b[0] * width, wall.b[1] * height];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      if (Math.hypot(dx, dy) < 12) return null;
      let angle = Math.atan2(dy, dx);
      if (angle < 0) angle += Math.PI;
      if (angle >= Math.PI) angle -= Math.PI;
      const ux = Math.cos(angle), uy = Math.sin(angle), nx = -uy, ny = ux;
      const start = a[0] * ux + a[1] * uy, end = b[0] * ux + b[1] * uy;
      return { axis: angle, ux, uy, nx, ny, fixed: ((a[0] + b[0]) * nx + (a[1] + b[1]) * ny) / 2,
        lo: Math.min(start, end), hi: Math.max(start, end) };
    }).filter(Boolean);
    // Door symbols sit in gaps between wall sections. Search a shared wall
    // axis across those gaps, while still requiring the arc and leaf evidence.
    for (let i = 0; i < axes.length; i++) {
      for (let j = i + 1; j < axes.length; j++) {
        const a = axes[i], b = axes[j];
        if (Math.abs(a.axis - b.axis) > .001 || Math.abs(a.fixed - b.fixed) > 2 || Math.max(a.lo, b.lo) - Math.min(a.hi, b.hi) > maxRadius) continue;
        a.lo = Math.min(a.lo, b.lo); a.hi = Math.max(a.hi, b.hi);
        axes.splice(j, 1); j = i;
      }
    }
    const point = (wall, along, across) => [wall.ux * along + wall.nx * across, wall.uy * along + wall.ny * across];
    // A doorway can terminate at a crossing wall (there may be no second
    // collinear wall stub). Extend only to an actual nearby wall intersection.
    const originalAxes = axes.map(axis => ({ ...axis }));
    for (const wall of axes) {
      wall.originalLo = wall.lo; wall.originalHi = wall.hi;
      let lower = wall.lo, upper = wall.hi;
      for (const other of originalAxes) {
        const cross = wall.ux * other.uy - wall.uy * other.ux;
        if (Math.abs(cross) < .3) continue;
        const p = point(wall, 0, wall.fixed), q = point(other, 0, other.fixed);
        const dx = q[0] - p[0], dy = q[1] - p[1];
        const t = (dx * other.uy - dy * other.ux) / cross;
        const s = (dx * wall.uy - dy * wall.ux) / cross;
        if (s < other.lo - 2 || s > other.hi + 2) continue;
        const reach = Math.min(maxRadius, span * .1);
        if (t < wall.lo && wall.lo - t <= reach && (lower === wall.lo || t > lower)) lower = t;
        if (t > wall.hi && t - wall.hi <= reach && (upper === wall.hi || t < upper)) upper = t;
      }
      wall.lo = lower; wall.hi = upper;
    }
    const make = (kind, wall, lo, hi) => {
      const a = point(wall, lo, wall.fixed), b = point(wall, hi, wall.fixed);
      return { kind, a: [a[0] / width, a[1] / height], b: [b[0] / width, b[1] / height] };
    };

    const doors = [];
    // A thin faint stroke must be darker than BOTH sides. This avoids turning
    // a colored room boundary or a solid furniture fill into symbol evidence.
    function ridge(x, y, nx, ny) {
      let best = 0;
      for (const offset of [-1, 0, 1]) {
        const xx = x + nx * offset, yy = y + ny * offset;
        const middle = sample(gray, xx, yy);
        const sides = Math.min(sample(gray, xx + nx * 2.5 * symbolScale, yy + ny * 2.5 * symbolScale), sample(gray, xx - nx * 2.5 * symbolScale, yy - ny * 2.5 * symbolScale));
        best = Math.max(best, sides - middle);
      }
      return best >= 8;
    }
    for (const wall of axes) {
      for (let hinge = Math.ceil(wall.lo + 2); hinge <= wall.hi - 2; hinge += stride) {
        for (const tangent of [-1, 1]) for (const normal of [-1, 1]) {
          const available = tangent > 0 ? wall.hi - hinge : hinge - wall.lo;
          for (let radius = minRadius; radius <= Math.min(maxRadius, available + 4); radius += stride) {
            // Reject solid wall positions before the expensive leaf/arc search.
            // Blank space alone never creates a door: symbol checks still follow.
            let gap = 0;
            for (const fraction of [.25, .5, .75]) {
              const along = hinge + tangent * radius * fraction;
              const p = point(wall, along, wall.fixed), room = point(wall, along, wall.fixed + normal * radius * .45);
              if (sample(gray, p[0], p[1]) > Math.max(145, sample(gray, room[0], room[1]) - 8)) gap++;
            }
            if (gap < 2) continue;
            let arc = 0, leaf = 0, faintLeaf = 0;
            for (let k = 2; k <= 10; k++) {
              const p = point(wall, hinge, wall.fixed + normal * radius * k / 11);
              leaf += sample(nearInk, p[0], p[1]);
              faintLeaf += ridge(p[0], p[1], wall.ux, wall.uy) ? 1 : 0;
            }
            if (leaf < 6 && faintLeaf < 7) continue;
            let faintArc = 0;
            for (const [c, s] of arcSamples) {
              const p = point(wall, hinge + tangent * radius * c, wall.fixed + normal * radius * s);
              arc += sample(nearInk, p[0], p[1]);
              const nx = wall.ux * tangent * c + wall.nx * normal * s;
              const ny = wall.uy * tangent * c + wall.ny * normal * s;
              faintArc += ridge(p[0], p[1], nx, ny) ? 1 : 0;
            }
            const strong = arc >= 9 && leaf >= 6;
            if (!strong && (faintArc < 10 || faintLeaf < 7)) continue;
            if (faintArc < 7) continue;
            let nearbyCurves = 0;
            for (const [c, s] of arcSamples) {
              const p = point(wall, hinge + tangent * radius * c, wall.fixed + normal * radius * s);
              const nx = wall.ux * tangent * c + wall.nx * normal * s, ny = wall.uy * tangent * c + wall.ny * normal * s;
              const distance = Math.max(4, radius * .22);
              nearbyCurves += ridge(p[0] + nx * distance, p[1] + ny * distance, nx, ny) ? 1 : 0;
              nearbyCurves += ridge(p[0] - nx * distance, p[1] - ny * distance, nx, ny) ? 1 : 0;
            }
            if (faintArc - nearbyCurves / 2 < 4) continue;
            const lo = Math.max(wall.lo, Math.min(hinge, hinge + tangent * radius));
            const hi = Math.min(wall.hi, Math.max(hinge, hinge + tangent * radius));
            if (hi - lo < minRadius) continue;
            if (lo < wall.originalLo - 2 && (lo - wall.lo > Math.max(3, (wall.originalLo - wall.lo) * .35) || Math.abs(hi - wall.originalLo) > 3)) continue;
            if (hi > wall.originalHi + 2 && (wall.hi - hi > Math.max(3, (wall.hi - wall.originalHi) * .35) || Math.abs(lo - wall.originalHi) > 3)) continue;
            let clear = 0;
            for (let t = lo + 3; t < hi - 2; t += 3) {
              const p = point(wall, t, wall.fixed);
              const room = point(wall, t, wall.fixed + normal * radius * .45);
              clear += sample(gray, p[0], p[1]) > (strong ? 215 : Math.max(145, sample(gray, room[0], room[1]) - 8)) ? 1 : 0;
            }
            if (clear < Math.ceil((hi - lo - 5) / 3 * .55)) continue;
            if (lo < wall.lo || hi > wall.hi) continue;
            const openingLo = lo < wall.originalLo - 2 ? wall.lo : lo;
            const openingHi = hi > wall.originalHi + 2 ? wall.hi : hi;
            doors.push({ ...make('door', wall, openingLo, openingHi), hinge: tangent > 0 ? 'a' : 'b', swing: tangent * normal,
              score: strong ? arc + leaf + 20 : faintArc + faintLeaf, axis: wall.axis, fixed: wall.fixed, lo: openingLo, hi: openingHi });
          }
        }
      }
    }
    const chosenDoors = [];
    for (const candidate of doors.sort((a, b) => b.score - a.score)) {
      if (chosenDoors.some(existing => existing.axis === candidate.axis && Math.abs(existing.fixed - candidate.fixed) < 9 &&
        Math.max(0, Math.min(existing.hi, candidate.hi) - Math.max(existing.lo, candidate.lo)) > Math.min(existing.hi - existing.lo, candidate.hi - candidate.lo) * .45)) continue;
      chosenDoors.push(candidate);
    }

    const windows = [];
    for (const wall of originalAxes) {
      const evidence = [];
      for (let along = Math.ceil(wall.lo + 3); along <= wall.hi - 3; along++) {
        const values = [];
        for (let offset = -7; offset <= 7; offset++) {
          const p = point(wall, along, wall.fixed + offset * symbolScale);
          values.push(sample(gray, p[0], p[1]));
        }
        // A glazing mullion may be the darkest pixel at the wall centre.
        // Look for bright panes between strokes on both sides of that centre.
        const pane = Math.max(...values.slice(5, 10));
        const hasCoreBright = pane >= 225;
        let isWindow = 0;
        for (let left = 0; left <= 7 && pane >= 170 && isWindow < 2; left++) {
          if (values[left] >= 190) continue;
          for (let right = Math.max(7, left + 3); right < Math.min(values.length, left + 12); right++) {
            if (values[right] >= 190) continue;
            if (hasCoreBright && Math.min(values[left], values[right]) < 100 && values.slice(left + 1, right).some(value => value >= 225)) {
              isWindow = Math.max(isWindow, left < 7 && right > 7 ? 2 : 1);
            } else if (left < 7 && right > 7 && pane - Math.max(values[left], values[right]) >= 30 && values.slice(left + 1, right).some(value => value >= pane - 3)) {
              isWindow = Math.max(isWindow, 3);
            }
          }
        }
        evidence.push(isWindow);
      }
      let start = -1, last = -1;
      function append() {
        if (start < 0 || last - start < minimumWindow) return;
        const samples = evidence.slice(start - first, last - first + 1);
        if (samples.filter(Boolean).length < samples.length * .7) return;
        if (last - start < 24 * symbolScale && samples.filter(value => value >= 2).length < samples.length * .6) return;
        // Parallel outlines alone also describe walls. Require a bounded
        // strip instead of replacing an entire outlined wall with glazing.
        if (start - wall.lo < 6 * symbolScale && wall.hi - last < 6 * symbolScale) return;
        if (samples.filter(value => value === 3).length > samples.length * .3 &&
          (start - wall.lo < 6 * symbolScale || wall.hi - last < 6 * symbolScale || last - start > (wall.hi - wall.lo) * .7)) return;
        const lo = Math.max(wall.lo, start - 1), hi = Math.min(wall.hi, last + 1);
        if (chosenDoors.some(door => door.axis === wall.axis && Math.abs(door.fixed - wall.fixed) < 9 &&
          Math.max(0, Math.min(hi, door.hi) - Math.max(lo, door.lo)) > (hi - lo) * .25)) return;
        windows.push({ ...make('window', wall, lo, hi), axis: wall.axis, fixed: wall.fixed, lo, hi });
      }
      const first = Math.ceil(wall.lo + 3);
      for (let i = 0; i <= evidence.length; i++) {
        if (i < evidence.length && evidence[i]) { if (start < 0) start = first + i; last = first + i; }
        else if (start >= 0 && (i === evidence.length || first + i - last > 5 * symbolScale)) { append(); start = last = -1; }
      }
    }
    const chosenWindows = [];
    for (const candidate of windows.sort((a, b) => (b.hi - b.lo) - (a.hi - a.lo))) {
      if (chosenWindows.some(existing => existing.axis === candidate.axis && Math.abs(existing.fixed - candidate.fixed) < 9 &&
        Math.max(0, Math.min(existing.hi, candidate.hi) - Math.max(existing.lo, candidate.lo)) > Math.min(existing.hi - existing.lo, candidate.hi - candidate.lo) * .45)) continue;
      chosenWindows.push(candidate);
    }
    return [...chosenDoors, ...chosenWindows].map(({ kind, a, b, hinge, swing }) => ({ kind, a, b, ...(kind === 'door' ? { hinge, swing } : {}) }));
  }

  // A door's drawn leaf can be long and connected enough to pass wall
  // detection. Remove only a stroke matching that recognized hinge and leaf;
  // nearby partitions and manually traced walls are never changed by rescans.
  function removeDoorLeaves(walls, openings, width, height) {
    const doors = openings.filter(opening => opening.kind === 'door');
    return walls.filter(wall => !doors.some(door => {
      const hinge = door.hinge === 'b' ? door.b : door.a;
      const other = door.hinge === 'b' ? door.a : door.b;
      const dx = (other[0] - hinge[0]) * width, dy = (other[1] - hinge[1]) * height;
      const radius = Math.hypot(dx, dy), ux = dx / radius, uy = dy / radius;
      // The hinge-to-latch vector already reverses when the hinge is b.
      const sign = door.swing || 1;
      const nx = -uy * sign, ny = ux * sign;
      const points = [wall.a, wall.b].map(p => {
        const x = (p[0] - hinge[0]) * width, y = (p[1] - hinge[1]) * height;
        return { along: x * nx + y * ny, across: Math.abs(x * ux + y * uy) };
      }).sort((a, b) => a.along - b.along);
      const tolerance = Math.max(3, radius * .12);
      return points.every(p => p.across <= tolerance) && Math.abs(points[0].along) <= tolerance &&
        Math.abs(points[1].along - radius) <= tolerance;
    }));
  }

  return { detect, removeDoorLeaves };
});
