(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FloorPlanDetection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Local contrast handles shaded scans without a single fixed ink threshold.
  function maskFor(image) {
    const { width: w, height: h, data } = image;
    const gray = new Uint8Array(w * h), integral = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        const i = y * w + x, j = i * 4, alpha = data[j + 3] / 255;
        gray[i] = Math.round((data[j] * .299 + data[j + 1] * .587 + data[j + 2] * .114) * alpha + 255 * (1 - alpha));
        row += gray[i]; integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
      }
    }
    const mask = new Uint8Array(w * h), radius = Math.max(16, Math.round(Math.min(w, h) * .035));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius), x1 = Math.min(w, x + radius + 1), y0 = Math.max(0, y - radius), y1 = Math.min(h, y + radius + 1);
      const mean = (integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
      const value = gray[y * w + x]; mask[y * w + x] = value < 90 || (value < 235 && value < mean - 14) ? 1 : 0;
    }
    return mask;
  }

  function runs(image, axis, minimum) {
    const { width, height, data } = image;
    const outer = axis === 'horizontal' ? height : width;
    const inner = axis === 'horizontal' ? width : height;
    const found = [];
    for (let fixed = 0; fixed < outer; fixed++) {
      let start = -1;
      for (let moving = 0; moving <= inner; moving++) {
        const index = axis === 'horizontal' ? fixed * width + moving : moving * width + fixed;
        const dark = moving < inner && data[index];
        if (dark && start < 0) start = moving;
        if ((!dark || moving === inner) && start >= 0) {
          if (moving - start >= minimum) found.push({ fixed, start, end: moving - 1, length: moving - start });
          start = -1;
        }
      }
    }
    return found;
  }

  function collapse(records, axis, width, height) {
    const tolerance = 1;
    const clusters = [];
    for (const line of records) {
      let match = null;
      for (let i = clusters.length - 1; i >= 0; i--) {
        const group = clusters[i];
        if (line.fixed - group.last > tolerance) continue;
        const overlap = Math.min(line.end, group.end) - Math.max(line.start, group.start) + 1;
        if (overlap >= Math.min(line.length, group.end - group.start + 1) * .7) { match = group; break; }
      }
      if (match) {
        match.last = line.fixed;
        match.position += line.fixed * line.length;
        match.weight += line.length;
        match.start = Math.min(match.start, line.start);
        match.end = Math.max(match.end, line.end);
      } else clusters.push({ first: line.fixed, last: line.fixed, position: line.fixed * line.length, weight: line.length, start: line.start, end: line.end });
    }
    const stripes = clusters.map(group => ({ ...group, fixed: group.position / group.weight, thickness: group.last - group.first + 1 }));
    const used = new Set(), paired = [];
    const maxGap = Math.max(5, Math.min(width, height) * .03);
    for (let i = 0; i < stripes.length; i++) {
      if (used.has(i)) continue;
      const a = stripes[i]; let best = -1, distance = Infinity;
      for (let j = i + 1; j < stripes.length; j++) {
        if (used.has(j)) continue;
        const b = stripes[j], gap = Math.abs(a.fixed - b.fixed);
        const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
        if (a.thickness <= 4 && b.thickness <= 4 && gap > (a.thickness + b.thickness) / 2 && gap <= maxGap && gap < distance && overlap / Math.max(a.end - a.start, b.end - b.start) > .82) { best = j; distance = gap; }
      }
      if (best >= 0) {
        const b = stripes[best]; used.add(best);
        paired.push({ fixed: (a.fixed + b.fixed) / 2, start: Math.min(a.start, b.start), end: Math.max(a.end, b.end),
          thickness: distance + (a.thickness + b.thickness) / 2, outlined: true });
      } else paired.push(a);
    }
    return paired.map(group => {
      const fixed = group.fixed;
      const a = axis === 'horizontal' ? [group.start / width, fixed / height] : [fixed / width, group.start / height];
      const b = axis === 'horizontal' ? [group.end / width, fixed / height] : [fixed / width, group.end / height];
      return { kind: 'wall', a, b, thickness: group.thickness, outlined: !!group.outlined };
    });
  }

  function diagonals(mask, width, height, axisWalls) {
    const points = [];
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (mask[i] && (!mask[i - 1] || !mask[i + 1] || !mask[i - width] || !mask[i + width])) points.push([x, y]);
    }
    if (!points.length) return [];
    const step = Math.max(1, Math.ceil(points.length / 25000)), diag = Math.ceil(Math.hypot(width, height)), bins = 2 * diag + 1;
    const minimum = Math.max(28, Math.min(width, height) * .07), peaks = [];
    for (let degree = 1; degree < 180; degree++) {
      if (degree === 90) continue;
      const angle = degree * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle), votes = new Uint16Array(bins);
      for (let i = 0; i < points.length; i += step) votes[Math.round(points[i][0] * c + points[i][1] * s) + diag]++;
      for (let r = 1; r < bins - 1; r++) if (votes[r] >= minimum * .65 / step && votes[r] >= votes[r - 1] && votes[r] > votes[r + 1]) peaks.push({ degree, rho: r - diag, score: votes[r], c, s });
    }
    peaks.sort((a, b) => b.score - a.score);
    const accepted = [], lines = [];
    for (const peak of peaks) {
      if (accepted.length >= 40) break;
      if (accepted.some(p => Math.abs(p.degree - peak.degree) <= 3 && Math.abs(p.rho - peak.rho) <= 12)) continue;
      accepted.push(peak);
      const { c, s, rho } = peak, tx = -s, ty = c;
      const corners = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]].map(([x, y]) => x * tx + y * ty);
      let start = null, last = null;
      function append() {
        if (start === null || last - start < minimum) return;
        const a = [(rho * c + start * tx) / width, (rho * s + start * ty) / height];
        const b = [(rho * c + last * tx) / width, (rho * s + last * ty) / height];
        if ([...a, ...b].some(v => v < 0 || v > 1)) return;
        // Suppress shallow duplicates supported by the same upright wall.
        const nearAxis = axisWalls.some(wall => {
          const horizontal = Math.abs(wall.a[1] - wall.b[1]) < 1e-6;
          const k = horizontal ? 1 : 0, scale = horizontal ? height : width;
          const along = 1-k;
          const overlap = Math.min(Math.max(a[along],b[along]),Math.max(wall.a[along],wall.b[along])) - Math.max(Math.min(a[along],b[along]),Math.min(wall.a[along],wall.b[along]));
          return overlap > 0 && Math.max(Math.abs(a[k] - wall.a[k]), Math.abs(b[k] - wall.a[k])) * scale < 12;
        });
        if (!nearAxis) lines.push({ kind: 'wall', a, b });
      }
      for (let t = Math.floor(Math.min(...corners)); t <= Math.ceil(Math.max(...corners)); t++) {
        let ink = false;
        for (let offset = -1; offset <= 1; offset++) {
          const x = Math.round((rho + offset) * c + t * tx), y = Math.round((rho + offset) * s + t * ty);
          if (x >= 0 && x < width && y >= 0 && y < height && mask[y * width + x]) ink = true;
        }
        if (ink) { if (start === null) start = t; last = t; }
        else if (start !== null && t - last > 2) { append(); start = last = null; }
      }
      append();
    }
    const length = w => Math.hypot((w.b[0]-w.a[0])*width,(w.b[1]-w.a[1])*height);
    const unique = [];
    for (const line of lines.sort((a,b)=>length(b)-length(a))) {
      const duplicate = unique.some(w => {
        const dx=(w.b[0]-w.a[0])*width, dy=(w.b[1]-w.a[1])*height, len=length(w);
        const projected=[line.a,line.b].map(p=>{
          const x=(p[0]-w.a[0])*width,y=(p[1]-w.a[1])*height;
          return [(x*dx+y*dy)/len,Math.abs(x*dy-y*dx)/len];
        });
        return projected.every(p=>p[1]<=5 && p[0]>=-5 && p[0]<=len+5);
      });
      if (!duplicate) unique.push(line);
    }
    return unique;
  }

  // Measure transverse ink rather than trusting line length. Thin annotation
  // strokes can touch a building and still belong to its dimensions or symbols.
  function wallEvidence(walls, mask, width, height) {
    const sample = (x, y) => {
      x = Math.round(x); y = Math.round(y);
      return x >= 0 && y >= 0 && x < width && y < height ? mask[y * width + x] : 0;
    };
    const profiles = walls.map(wall => {
      const a = [wall.a[0] * width, wall.a[1] * height], b = [wall.b[0] * width, wall.b[1] * height];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ux = (b[0] - a[0]) / length, uy = (b[1] - a[1]) / length, nx = -uy, ny = ux;
      function band(t) {
        const x = a[0] + ux * t, y = a[1] + uy * t;
        if (wall.outlined) {
          const half = wall.thickness / 2;
          // Both faces must persist; the empty centre of an outlined wall is valid.
          const face = offset => [-1, 0, 1].some(d => sample(x + nx * (offset + d), y + ny * (offset + d)));
          return face(-half + 1) && face(half - 1) ? wall.thickness : 0;
        }
        let center = null;
        for (const offset of [0, -1, 1, -2, 2]) if (sample(x + nx * offset, y + ny * offset)) { center = offset; break; }
        if (center === null) return 0;
        let lo = center, hi = center;
        const limit = Math.max(8, Math.min(width, height) * .04);
        while (lo > -limit && sample(x + nx * (lo - 1), y + ny * (lo - 1))) lo--;
        while (hi < limit && sample(x + nx * (hi + 1), y + ny * (hi + 1))) hi++;
        return hi - lo + 1;
      }
      const values = Array.from({ length: 25 }, (_, i) => band(length * (i + 1) / 26)).filter(Boolean).sort((a, b) => a - b);
      const thickness = values.length ? values[Math.floor((values.length - 1) * .6)] : 0;
      return { wall, a, b, length, ux, uy, band, thickness };
    });
    const substantial = profiles.filter(p => p.thickness >= 2 && p.length >= Math.min(width, height) * .1).sort((a, b) => a.thickness - b.thickness);
    const total = substantial.reduce((sum, p) => sum + p.length, 0);
    let typical = 1, weight = 0;
    for (const p of substantial) { weight += p.length; typical = p.thickness; if (weight >= total * .65) break; }
    const threshold = Math.max(1.75, typical * .72);
    const anchors = profiles.filter(p => p.thickness >= threshold);
    // Uniform single-stroke or fragmentary plans have no reliable thickness
    // hierarchy. Keep them for topology checks rather than erase their walls.
    if (anchors.length < 3) return walls;
    const tolerance = Math.max(3, typical * 1.2);
    for (const p of anchors) {
      let run = 0, first = null, last = null;
      const minimumRun = Math.max(3, Math.ceil(typical * .75));
      for (let t = 0; t <= p.length; t++) {
        run = p.band(t) >= threshold ? run + 1 : 0;
        if (run >= minimumRun) { if (first === null) first = t - run + 1; last = t; }
      }
      p.bodyLo = first ?? 0; p.bodyHi = last ?? p.length;
    }
    // Bounds come from sustained wall bands, excluding narrow extensions and
    // the isolated cross-stroke where a dimension rail meets its extension.
    const bodyPoints = anchors.flatMap(p => [p.bodyLo, p.bodyHi].map(t => [p.a[0] + t * p.ux, p.a[1] + t * p.uy]));
    const xs = bodyPoints.map(p => p[0]), ys = bodyPoints.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const inside = ([x, y]) => x >= minX - 2 && x <= maxX + 2 && y >= minY - 2 && y <= maxY + 2;
    function touches(point, p) {
      const t = Math.max(0, Math.min(p.length, (point[0] - p.a[0]) * p.ux + (point[1] - p.a[1]) * p.uy));
      return Math.hypot(point[0] - p.a[0] - t * p.ux, point[1] - p.a[1] - t * p.uy) <= tolerance;
    }
    return profiles.flatMap(p => {
      if (p.thickness < threshold) {
        const interior = [p.a, p.b].every(inside);
        // Interior partitions can be drawn thinner than the perimeter. Their
        // connected groups are checked below; external dimension rails fail this.
        if (interior && p.thickness >= Math.max(1.75, typical * .35)) return [p.wall];
        // A thin partition must join structure at both ends. A door leaf,
        // leader, tick, or attached furniture outline usually has one free end.
        const junction = (point, q) => Math.abs(p.ux * q.uy - p.uy * q.ux) > .3 && touches(point, q);
        if (!interior || !anchors.some(q => junction(p.a, q)) || !anchors.some(q => junction(p.b, q))) return [];
        return [p.wall];
      }
      let lo = inside(p.a) ? 0 : p.bodyLo, hi = inside(p.b) ? p.length : p.bodyHi;
      // Trim narrow dimension extensions that continue beyond a thick wall.
      // Faint ends inside the building can be jambs/glazing and stay intact.
      if (hi - lo < Math.max(20, Math.min(width, height) * .06)) return [];
      return [{ ...p.wall, a: [(p.a[0] + lo * p.ux) / width, (p.a[1] + lo * p.uy) / height],
        b: [(p.a[0] + hi * p.ux) / width, (p.a[1] + hi * p.uy) / height] }];
    });
  }

  // Structural walls form a connected layout. Dimension guides, labels and
  // furniture outlines usually form smaller detached groups of lines.
  function structuralGroups(walls, width, height) {
    if (walls.length < 3) return walls;
    const points = walls.map(w => [w.a, w.b].map(p => [p[0] * width, p[1] * height]));
    const lengths = points.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]));
    const tolerance = Math.max(3, Math.min(width, height) * .006);
    function pointDistance(p, [a, b]) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    }
    function connected(i, j) {
      const a = points[i], b = points[j];
      if (a.some(p => pointDistance(p, b) <= tolerance) || b.some(p => pointDistance(p, a) <= tolerance)) return true;
      const dx = a[1][0] - a[0][0], dy = a[1][1] - a[0][1];
      const ex = b[1][0] - b[0][0], ey = b[1][1] - b[0][1];
      const normalDistance = p => Math.abs((p[0] - a[0][0]) * dy - (p[1] - a[0][1]) * dx) / lengths[i];
      // Collinear stubs separated by an opening still belong to one layout.
      if (Math.abs(dx * ey - dy * ex) / (lengths[i] * lengths[j]) < .02 &&
          b.every(p => normalDistance(p) <= tolerance) &&
          Math.min(lengths[i], lengths[j]) >= Math.min(width, height) * .12 &&
          a.some(p => pointDistance(p, b) <= Math.min(width, height) * .12)) return true;
      // Two walls can cross without either endpoint touching the other.
      const cross = (u, v) => u[0] * v[1] - u[1] * v[0];
      const direction = [a[1][0] - a[0][0], a[1][1] - a[0][1]];
      const other = [b[1][0] - b[0][0], b[1][1] - b[0][1]];
      const denominator = cross(direction, other);
      if (Math.abs(denominator) < 1e-6) return false;
      const delta = [b[0][0] - a[0][0], b[0][1] - a[0][1]];
      const t = cross(delta, other) / denominator, u = cross(delta, direction) / denominator;
      return t >= 0 && t <= 1 && u >= 0 && u <= 1;
    }
    const seen = new Uint8Array(walls.length), groups = [];
    for (let seed = 0; seed < walls.length; seed++) {
      if (seen[seed]) continue;
      const group = [], queue = [seed]; seen[seed] = 1;
      for (let k = 0; k < queue.length; k++) {
        const i = queue[k]; group.push(i);
        for (let j = 0; j < walls.length; j++) if (!seen[j] && connected(i, j)) { seen[j] = 1; queue.push(j); }
      }
      groups.push({ indices: group, length: group.reduce((total, i) => total + lengths[i], 0) });
    }
    groups.sort((a, b) => b.length - a.length);
    const main = groups[0];
    // A single dominant network is evidence of a building. Ambiguous or
    // disconnected drawings stay intact for manual review.
    if (main.indices.length < 3 || (groups[1] && main.length < groups[1].length * 1.5)) return walls;
    const keep = new Set(groups.filter(group => group === main || (group.indices.length >= 3 && group.length >= main.length * .35)).flatMap(group => group.indices));
    return walls.filter((_, index) => keep.has(index));
  }

  function detect(image, { includeDetached = false } = {}) {
    if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) ||
        image.width < 40 || image.height < 40 || image.width > 2048 || image.height > 2048 ||
        !image.data || image.data.length !== image.width * image.height * 4) throw new Error('The drawing could not be read for wall detection.');
    const minimum = Math.max(20, Math.round(Math.min(image.width, image.height) * .06));
    // ImageData dimensions are prototype getters in browsers, not spreadable fields.
    const mask = maskFor(image), binary = { width: image.width, height: image.height, data: mask };
    const horizontal = collapse(runs(binary, 'horizontal', minimum), 'horizontal', image.width, image.height);
    const vertical = collapse(runs(binary, 'vertical', minimum), 'vertical', image.width, image.height);
    const walls = [...horizontal, ...vertical, ...diagonals(mask, image.width, image.height, [...horizontal, ...vertical])].filter(wall => {
      const dx = (wall.a[0] - wall.b[0]) * image.width;
      const dy = (wall.a[1] - wall.b[1]) * image.height;
      return Math.hypot(dx, dy) >= minimum;
    });
    // Bound pathological drawings before graph analysis, but count the model
    // limit after annotation removal so a sheet full of labels can still work.
    if (walls.length > 2000) throw new Error('Too many lines were found. Crop the plan to one floor and remove legends or schedules before trying again.');
    const structural = includeDetached ? walls : structuralGroups(wallEvidence(walls, mask, image.width, image.height), image.width, image.height);
    if (!includeDetached && structural.length > 250) throw new Error('Too many wall lines were found. Crop the plan to one floor before trying again.');
    return structural.map(({ a, b }) => ({ kind: 'wall', a, b }));
  }

  return { detect };
});
