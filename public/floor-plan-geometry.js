(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FloorPlanGeometry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_SEGMENTS = 250;
  const FURNITURE = {
    bed: { label: 'Bed', width: 5, depth: 6.5 },
    sofa: { label: 'Sofa', width: 6, depth: 2.8 },
    dining_table: { label: 'Dining table', width: 5, depth: 3 },
    table: { label: 'Table', width: 3, depth: 3 },
    chair: { label: 'Chair', width: 2, depth: 2 },
    wardrobe: { label: 'Wardrobe', width: 5, depth: 2 },
    kitchen_counter: { label: 'Kitchen counter', width: 6, depth: 2 },
    sink: { label: 'Sink', width: 2.5, depth: 2 },
    toilet: { label: 'Toilet', width: 2, depth: 2.5 },
    appliance: { label: 'Appliance', width: 2.5, depth: 2.5 },
    other: { label: 'Other item', width: 3, depth: 3 }
  };
  const MAX_FURNITURE = 100;
  const FINISH_PATTERNS = ['solid', 'plaster', 'linen', 'stripes', 'botanical', 'trellis', 'dots', 'damask', 'wood', 'chevron', 'herringbone', 'tiles', 'checker', 'marble', 'terrazzo', 'stone', 'concrete', 'panels', 'coffer', 'slats', 'custom'];
  function validateFinish(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !FINISH_PATTERNS.includes(value.pattern)) invalid('Choose a supported surface finish.');
    for (const color of [value.color, value.accent]) if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) invalid('Finish colors must use a six-digit hex code, such as #E8DED0.');
    const result = { pattern: value.pattern, color: value.color.toLowerCase(), accent: value.accent.toLowerCase(),
      scale: number(value.scale, .25, 20, 'Finish repeat size in feet'), rotation: number(value.rotation, -180, 180, 'Finish rotation') };
    if (value.pattern === 'custom') {
      if (typeof value.texture !== 'string' || value.texture.length > 700000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.texture)) invalid('Upload a PNG, JPG or WebP texture smaller than 500 KB after compression.');
      result.texture = value.texture;
    }
    return result;
  }
  function invalid(message) { throw Object.assign(new Error(message), { status: 400 }); }
  function number(value, min, max, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid(`${label} must be between ${min} and ${max}.`);
    return value;
  }
  function validate(input) {
    if (input == null) return null;
    if (input.version === 2) return validateBuilding(input);
    if (typeof input !== 'object' || Array.isArray(input) || input.version !== 1) invalid('This floor-plan format is not supported.');
    if (typeof input.image !== 'string' || input.image.length > 2500000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(input.image)) invalid('Upload a PNG, JPEG, or WebP floor-plan image smaller than 1.8 MB after compression.');
    if (!Array.isArray(input.walls) || input.walls.length > MAX_SEGMENTS) invalid(`A floor plan can contain up to ${MAX_SEGMENTS} wall and opening segments.`);
    const plan = {
      version: 1, image: input.image, unit: 'ft',
      width: number(input.width, 4, 500, 'Drawing width in feet'),
      depth: number(input.depth, 4, 500, 'Drawing depth in feet'),
      height: number(input.height, 7, 25, 'Wall height in feet'),
      thickness: number(input.thickness, .2, 2, 'Wall thickness in feet'),
      scaleConfirmed: input.scaleConfirmed !== false,
      openingDetectionVersion: number(input.openingDetectionVersion ?? 0, 0, 1000, 'Opening detection version'),
      published: input.published === true,
      walls: input.walls.map(wall => {
        if (!wall || !['wall', 'door', 'window'].includes(wall.kind)) invalid('Choose wall, doorway, or window for each segment.');
        for (const key of ['a', 'b']) {
          if (!Array.isArray(wall[key]) || wall[key].length !== 2) invalid('Each segment needs two endpoints.');
          wall[key].forEach(value => number(value, 0, 1, 'Wall endpoint'));
        }
        const length = Math.hypot((wall.a[0] - wall.b[0]) * input.width, (wall.a[1] - wall.b[1]) * input.depth);
        if (length < .1) invalid('Wall and opening segments must be at least 0.1 feet long.');
        if (wall.hinge !== undefined && (wall.kind !== 'door' || !['a', 'b'].includes(wall.hinge))) invalid('Door hinge must be at endpoint a or b.');
        if (wall.swing !== undefined && (wall.kind !== 'door' || ![-1, 1].includes(wall.swing))) invalid('Door swing must be clockwise or anticlockwise.');
        if ((wall.finish !== undefined || wall.exteriorFinish !== undefined || wall.outside !== undefined) && wall.kind !== 'wall') invalid('Individual finishes and outside directions can only be applied to walls.');
        if (wall.outside !== undefined && !['left','right','both','none'].includes(wall.outside)) invalid('Choose automatic, interior or an outside direction for the wall.');
        if (wall.finishLocked !== undefined && (wall.kind !== 'wall' || typeof wall.finishLocked !== 'boolean')) invalid('A wall design lock must be true or false and belong to a wall.');
        return { kind: wall.kind, a: [...wall.a], b: [...wall.b],
          ...(wall.confidence !== undefined ? { confidence: number(wall.confidence, 0, 1, 'Wall confidence') } : {}),
          ...(wall.hinge !== undefined ? { hinge: wall.hinge } : {}), ...(wall.swing !== undefined ? { swing: wall.swing } : {}),
          ...(wall.finish !== undefined ? { finish: validateFinish(wall.finish) } : {}),
          ...(wall.exteriorFinish !== undefined ? { exteriorFinish: validateFinish(wall.exteriorFinish) } : {}),
          ...(wall.outside !== undefined ? { outside: wall.outside } : {}),
          ...(wall.finishLocked !== undefined ? { finishLocked: wall.finishLocked } : {}) };
      }),
      furniture: (() => {
        if (input.furniture !== undefined && (!Array.isArray(input.furniture) || input.furniture.length > MAX_FURNITURE)) invalid(`A floor plan can contain up to ${MAX_FURNITURE} furniture and fixture items.`);
        return (input.furniture || []).map(item => {
          if (!item || !Object.hasOwn(FURNITURE, item.type)) invalid('Choose a supported furniture or fixture type.');
          if (!Array.isArray(item.center) || item.center.length !== 2) invalid('Each item needs a position on the drawing.');
          item.center.forEach(value => number(value, 0, 1, 'Furniture position'));
          const width = number(item.width, .5, 15, 'Item width in feet');
          const depth = number(item.depth, .5, 15, 'Item depth in feet');
          const rotation = number(item.rotation, -180, 180, 'Item rotation in degrees');
          if (item.source !== undefined && !['detected', 'manual'].includes(item.source)) invalid('Item source is not supported.');
          return { type: item.type, center: [...item.center], width, depth, rotation, source: item.source || 'manual' };
        });
      })()
    };
    if (input.finishes !== undefined) {
      if (!input.finishes || typeof input.finishes !== 'object' || Array.isArray(input.finishes)) invalid('Surface finishes must describe walls, flooring or ceiling.');
      plan.finishes = {};
      for (const key of ['wall', 'exterior', 'floor', 'ceiling']) if (input.finishes[key] !== undefined) plan.finishes[key] = validateFinish(input.finishes[key]);
    }
    if (input.finishLocks !== undefined) {
      if (!input.finishLocks || typeof input.finishLocks !== 'object' || Array.isArray(input.finishLocks)) invalid('Design locks must describe walls, flooring or ceiling.');
      plan.finishLocks = {};
      for (const key of ['wall', 'exterior', 'floor', 'ceiling']) if (input.finishLocks[key] !== undefined) {
        if (typeof input.finishLocks[key] !== 'boolean') invalid('A surface design lock must be true or false.');
        plan.finishLocks[key] = input.finishLocks[key];
      }
    }
    if (input.recognition !== undefined) {
      const recognition = input.recognition;
      if (!recognition || !['cubicasa5k','mitunet','color-walls'].includes(recognition.engine) || !Array.isArray(recognition.regions) || recognition.regions.length > 100) invalid('Recognition must contain a supported engine and up to 100 predicted room outlines.');
      plan.recognition = {
        engine: recognition.engine,
        inferenceMs: recognition.inferenceMs == null ? null : number(recognition.inferenceMs, 0, Number.MAX_SAFE_INTEGER, 'Recognition time'),
        regions: recognition.regions.map(region => {
          if (!region || typeof region.type !== 'string' || !region.type.trim() || region.type.length > 80 || !Array.isArray(region.polygon) || region.polygon.length < 3 || region.polygon.length > 1024) invalid('Each predicted room needs a name and a bounded polygon.');
          return { type: region.type, confidence: number(region.confidence, 0, 1, 'Room confidence'), polygon: region.polygon.map(point => {
            if (!Array.isArray(point) || point.length !== 2) invalid('Each room outline point needs two coordinates.');
            return point.map(value => number(value, 0, 1, 'Room outline coordinate'));
          }) };
        })
      };
      if (recognition.candidates !== undefined) {
        if (!Array.isArray(recognition.candidates) || recognition.candidates.length > MAX_SEGMENTS) invalid('Too many wall review candidates.');
        plan.recognition.candidates = recognition.candidates.map(candidate => {
          const wall = validate({version:1,image:plan.image,width:plan.width,depth:plan.depth,height:plan.height,thickness:plan.thickness,walls:[candidate]}).walls[0];
          if (wall.kind !== 'wall') invalid('Only uncertain walls belong in wall review.');
          return {...wall,reason:typeof candidate.reason==='string'?candidate.reason.slice(0,80):'Review wall'};
        });
      }
      if (recognition.annotations !== undefined) {
        if (!Array.isArray(recognition.annotations) || recognition.annotations.length > 300) invalid('Too many drawing annotations.');
        plan.recognition.annotations = recognition.annotations.map(annotation => {
          if (!annotation || !['text','measurement-text','dimension-line','symbol'].includes(annotation.type) || !Array.isArray(annotation.polygon) || annotation.polygon.length!==4) invalid('Drawing annotations need a type and four corners.');
          return {type:annotation.type,text:typeof annotation.text==='string'?annotation.text.slice(0,80):'',confidence:number(annotation.confidence,0,1,'Annotation confidence'),polygon:annotation.polygon.map(point=>{
            if(!Array.isArray(point)||point.length!==2)invalid('Annotation corners need two coordinates.');
            return point.map(value=>number(value,0,1,'Annotation corner'));
          })};
        });
      }
      if (recognition.summary !== undefined) {
        plan.recognition.summary = {};
        for (const key of ['textRegions','dimensionLines','symbolRegions','removedPixels','reviewSegments']) plan.recognition.summary[key]=number(recognition.summary?.[key]??0,0,Number.MAX_SAFE_INTEGER,'Recognition count');
      }
    }
    const textures = [plan.image, ...Object.values(plan.finishes || {}).map(f => f.texture || ''), ...plan.walls.flatMap(w => [w.finish?.texture || '', w.exteriorFinish?.texture || ''])];
    if (textures.reduce((sum, image) => sum + image.length, 0) > 5000000) invalid('This floor has too many texture images. Use smaller textures (5 MB combined maximum).');
    if (plan.published && !plan.scaleConfirmed) invalid('Confirm the actual drawing width and depth before publishing.');
    if (plan.published && !plan.walls.some(wall => wall.kind === 'wall')) invalid('Review at least one detected wall before publishing the 3D layout.');
    return plan;
  }
  const MAX_FLOORS = 8;
  function floorName(index) { return index === 0 ? 'Ground floor' : index === 1 ? 'First floor' : index === 2 ? 'Second floor' : index === 3 ? 'Third floor' : `Floor ${index}`; }
  function validateBuilding(input) {
    if (!Array.isArray(input.floors) || !input.floors.length || input.floors.length > MAX_FLOORS) invalid(`Choose between 1 and ${MAX_FLOORS} floors.`);
    const published = input.published === true;
    const floors = input.floors.map((floor, index) => {
      if (!floor || typeof floor !== 'object' || (floor.plan && floor.plan.version !== 1)) invalid('Each floor needs a single floor-plan drawing.');
      const plan = floor.plan == null ? null : validate({ ...floor.plan, published });
      if (published && !plan) invalid(`Upload and review the plan for ${floorName(index)} before publishing.`);
      return { name: floorName(index), plan,
        slabThickness: number(floor.slabThickness ?? .5, .2, 3, 'Slab thickness in feet'),
        offsetX: number(floor.offsetX ?? 0, -500, 500, 'Floor horizontal offset'),
        offsetZ: number(floor.offsetZ ?? 0, -500, 500, 'Floor depth offset') };
    });
    if (floors.reduce((sum, floor) => sum + (floor.plan ? JSON.stringify(floor.plan).length : 0), 0) > 10000000) invalid('The combined floor drawings and textures are too large. Use smaller images (10 MB combined maximum).');
    return { version: 2, unit: 'ft', published, floors };
  }
  function floorsOf(model) {
    if (!model) return [];
    const floors = model.version === 2 ? model.floors : [{ name: floorName(0), plan: model, slabThickness: .5, offsetX: 0, offsetZ: 0 }];
    let elevation = 0;
    return floors.map((floor, index) => {
      const placed = { ...floor, index, elevation };
      // Finished floor to finished floor: clear wall height plus the next slab.
      elevation += (floor.plan?.height || 10) + (floors[index + 1]?.slabThickness ?? .5);
      return placed;
    });
  }
  function hasGeometry(model) { return floorsOf(model).some(f => f.plan?.walls.some(w => w.kind === 'wall')); }
  function coverImage(model) { return floorsOf(model).find(f => f.plan?.image)?.plan.image || ''; }
  // The image may include dimension guides and large blank margins. Keep its
  // coordinate system for walls, but size the presentation slab to the walls.
  function footprint(plan) {
    const walls = (plan.walls || []).filter(wall => wall.kind === 'wall');
    if (!walls.length) return { x: 0, z: 0, width: plan.width, depth: plan.depth };
    const points = walls.flatMap(wall => [wall.a, wall.b]);
    const xs = points.map(point => (point[0] - .5) * plan.width);
    const zs = points.map(point => (point[1] - .5) * plan.depth);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const margin = Math.max(.5, plan.thickness / 2 + .25);
    return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2,
      width: Math.max(1, maxX - minX + 2 * margin), depth: Math.max(1, maxZ - minZ + 2 * margin) };
  }
  function wallSpan(plan) {
    const points = (plan.walls || []).filter(w => w.kind === 'wall').flatMap(w => [w.a, w.b]);
    if (!points.length) return null;
    const x = points.map(p => p[0]), z = points.map(p => p[1]);
    const fractionX = Math.max(...x) - Math.min(...x), fractionZ = Math.max(...z) - Math.min(...z);
    return { width: fractionX * plan.width, depth: fractionZ * plan.depth, fractionX, fractionZ };
  }
  // Adapted from FLRplanner/shared/recognition.ts: keep image-rule proposals
  // inside the recognized structure and prefer model fixtures over duplicates.
  function recognitionFurniture(result, suggestions, width, depth) {
    const points = result.walls.filter(w => w.kind === 'wall').flatMap(w => [w.a, w.b]);
    if (!points.length) return [];
    const minX = Math.min(...points.map(p => p[0])), maxX = Math.max(...points.map(p => p[0]));
    const minY = Math.min(...points.map(p => p[1])), maxY = Math.max(...points.map(p => p[1]));
    const inside = item => item.center[0] >= minX && item.center[0] <= maxX && item.center[1] >= minY && item.center[1] <= maxY;
    const fixtures = result.furniture.filter(inside);
    return [...fixtures, ...suggestions.filter(item => inside(item) && !fixtures.some(other =>
      Math.hypot((other.center[0] - item.center[0]) * width, (other.center[1] - item.center[1]) * depth)
        < Math.max(other.width, other.depth, item.width, item.depth) * .45))].slice(0, MAX_FURNITURE);
  }
  // FLRplanner supplies only uncovered wall spans around recognized openings.
  // Work in feet here; cutWalls removes these spans again for the actual gap.
  function surroundOpenings(segments, width, depth, thickness = .5) {
    const walls = [...segments];
    if (!segments.some(w => w.kind === 'wall')) return walls;
    for (const opening of segments.filter(w => w.kind !== 'wall')) {
      const ax = opening.a[0] * width, ay = opening.a[1] * depth;
      const dx = (opening.b[0] - opening.a[0]) * width, dy = (opening.b[1] - opening.a[1]) * depth;
      const length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length;
      if (length < .1) continue;
      const covered = walls.filter(w => w.kind === 'wall').flatMap(w => {
        const wx = (w.b[0] - w.a[0]) * width, wy = (w.b[1] - w.a[1]) * depth, wl = Math.hypot(wx, wy);
        if (!wl || Math.abs((wx * ux + wy * uy) / wl) < .995) return [];
        const a = [w.a[0] * width - ax, w.a[1] * depth - ay], b = [w.b[0] * width - ax, w.b[1] * depth - ay];
        if (Math.max(Math.abs(a[0] * uy - a[1] * ux), Math.abs(b[0] * uy - b[1] * ux)) > thickness * .55) return [];
        const p = a[0] * ux + a[1] * uy, q = b[0] * ux + b[1] * uy;
        const start = Math.max(0, Math.min(p, q)), end = Math.min(length, Math.max(p, q));
        return end > start ? [[start, end]] : [];
      }).sort((a, b) => a[0] - b[0]);
      let start = 0;
      for (const [s, e] of [...covered, [length, length]]) {
        const normalized = t => [Math.max(0, Math.min(1, (ax + ux * t) / width)), Math.max(0, Math.min(1, (ay + uy * t) / depth))];
        if (s - start >= .1) walls.push({ kind: 'wall', a: normalized(start), b: normalized(s) });
        start = Math.max(start, e);
      }
    }
    return walls;
  }
  function resizeDrawing(plan, width, depth, confirmed = false) {
    const sx = width / plan.width, sz = depth / plan.depth;
    const furniture = (plan.furniture || []).map(item => {
      if (item.source !== 'detected') return item;
      const angle = item.rotation * Math.PI / 180;
      return { ...item, width: item.width * Math.hypot(Math.cos(angle) * sx, Math.sin(angle) * sz),
        depth: item.depth * Math.hypot(Math.sin(angle) * sx, Math.cos(angle) * sz),
        rotation: Math.atan2(Math.sin(angle) * sz, Math.cos(angle) * sx) * 180 / Math.PI };
    });
    return validate({ ...plan, width, depth, furniture, scaleConfirmed: confirmed, published: false });
  }
  function resizeBuilding(plan, width, depth) {
    const span = wallSpan(plan);
    if (!span || span.fractionX < .01 || span.fractionZ < .01) invalid('Detect or trace the building outline before setting its size.');
    number(width, 4, 500, 'Building width in feet'); number(depth, 4, 500, 'Building depth in feet');
    return resizeDrawing(plan, width / span.fractionX, depth / span.fractionZ);
  }
  function largeLayout(plan, longestSide = 60, imageWidth = plan.width, imageHeight = plan.depth) {
    const span = wallSpan(plan);
    if (!span) invalid('Detect or trace walls before enlarging the layout.');
    number(imageWidth, 1, 100000, 'Image width'); number(imageHeight, 1, 100000, 'Image height');
    const factor = longestSide / Math.max(span.fractionX * imageWidth, span.fractionZ * imageHeight);
    return resizeDrawing(plan, imageWidth * factor, imageHeight * factor);
  }
  function calibrate(plan, a, b, distance, imageWidth, imageHeight) {
    number(distance, .1, 500, 'Reference distance in feet');
    number(imageWidth, 1, 100000, 'Image width'); number(imageHeight, 1, 100000, 'Image height');
    for (const point of [a, b]) {
      if (!Array.isArray(point) || point.length !== 2) invalid('Select two reference points.');
      point.forEach(value => number(value, 0, 1, 'Reference endpoint'));
    }
    const pixels = Math.hypot((b[0]-a[0])*imageWidth, (b[1]-a[1])*imageHeight);
    if (pixels < 10) invalid('Choose reference points farther apart for reliable scale calibration.');
    return resizeDrawing(plan, imageWidth * distance / pixels, imageHeight * distance / pixels, true);
  }
  const surfaceCache = new WeakMap();
  // Flood the air around the traced layout. Doors/windows close the envelope
  // for this analysis only; their rendered openings and geometry are untouched.
  // An incomplete envelope is reported as uncertain, rather than inventing rooms.
  function wallSurfaces(plan) {
    if (!plan?.walls?.length) return [];
    const key=JSON.stringify([plan.width,plan.depth,plan.thickness,plan.walls.map(w=>[w.kind,w.a,w.b,w.outside])]);
    const cached=surfaceCache.get(plan);if(cached?.key===key)return cached.value;
    const pts=plan.walls.flatMap(w=>[w.a,w.b]).map(p=>[p[0]*plan.width,p[1]*plan.depth]);
    const minX=Math.min(...pts.map(p=>p[0])),maxX=Math.max(...pts.map(p=>p[0])),minZ=Math.min(...pts.map(p=>p[1])),maxZ=Math.max(...pts.map(p=>p[1]));
    const step=Math.max(.04,(Math.max(maxX-minX,maxZ-minZ)+4*plan.thickness)/320),pad=plan.thickness+8*step;
    const ox=minX-pad,oz=minZ-pad,nx=Math.ceil((maxX-minX+2*pad)/step)+1,nz=Math.ceil((maxZ-minZ+2*pad)/step)+1;
    const blocked=new Uint8Array(nx*nz),air=new Uint8Array(nx*nz),queue=new Int32Array(nx*nz);
    const radius=plan.thickness/2+step*.7,cells=Math.ceil(radius/step);
    for(const w of plan.walls) {
      const ax=w.a[0]*plan.width,az=w.a[1]*plan.depth,dx=(w.b[0]-w.a[0])*plan.width,dz=(w.b[1]-w.a[1])*plan.depth;
      const count=Math.ceil(Math.hypot(dx,dz)/step*2);
      for(let i=0;i<=count;i++) {
        const px=(ax+dx*i/count-ox)/step,pz=(az+dz*i/count-oz)/step,cx=Math.round(px),cz=Math.round(pz);
        for(let z=Math.max(0,cz-cells);z<=Math.min(nz-1,cz+cells);z++)for(let x=Math.max(0,cx-cells);x<=Math.min(nx-1,cx+cells);x++)
          if(Math.hypot(x-px,z-pz)*step<=radius)blocked[z*nx+x]=1;
      }
    }
    let head=0,tail=1;queue[0]=0;air[0]=1;
    while(head<tail) {
      const p=queue[head++],x=p%nx,z=Math.floor(p/nx);
      for(const n of [x>0?p-1:-1,x<nx-1?p+1:-1,z>0?p-nx:-1,z<nz-1?p+nx:-1])if(n>=0&&!blocked[n]&&!air[n]){air[n]=1;queue[tail++]=n;}
    }
    const value=plan.walls.map(w=>{
      if(w.outside!==undefined)return {outside:w.outside,uncertain:false,source:'manual'};
      const ax=w.a[0]*plan.width,az=w.a[1]*plan.depth,dx=(w.b[0]-w.a[0])*plan.width,dz=(w.b[1]-w.a[1])*plan.depth,len=Math.hypot(dx,dz);
      function exposed(sign) {
        let outside=0,total=0;
        for(const t of [.25,.5,.75])for(let k=3;k<=6;k++) {
          const d=plan.thickness/2+step*k,x=Math.round((ax+dx*t-sign*dz/len*d-ox)/step),z=Math.round((az+dz*t+sign*dx/len*d-oz)/step);
          if(x<0||x>=nx||z<0||z>=nz){outside++;total++;break;}
          const p=z*nx+x;if(!blocked[p]){outside+=air[p];total++;break;}
        }
        return total===0||outside>total/2;
      }
      const left=exposed(1),right=exposed(-1),outside=left?(right?'both':'left'):(right?'right':'none');
      return {outside,uncertain:outside==='both',source:'auto'};
    });
    surfaceCache.set(plan,{key,value});return value;
  }
  // Remove opening intervals from full walls, including auto-detected walls.
  function cutWalls(plan) {
    const openings = plan.walls.filter(w => w.kind !== 'wall'), result = [];
    for (const wall of plan.walls) {
      if (wall.kind !== 'wall') { result.push(wall); continue; }
      const dx = (wall.b[0]-wall.a[0])*plan.width, dz = (wall.b[1]-wall.a[1])*plan.depth, length = Math.hypot(dx, dz);
      const ux = dx/length, uz = dz/length;
      let intervals = [[0, length]];
      for (const opening of openings) {
        const projected = [opening.a, opening.b].map(p => {
          const x = (p[0]-wall.a[0])*plan.width, z = (p[1]-wall.a[1])*plan.depth;
          return [x*ux+z*uz, Math.abs(x*uz-z*ux)];
        });
        const odx = (opening.b[0]-opening.a[0])*plan.width, odz = (opening.b[1]-opening.a[1])*plan.depth;
        if (Math.abs((odx*ux+odz*uz)/Math.hypot(odx, odz)) < .995 || projected.some(p => p[1] > plan.thickness*.55)) continue;
        const lo = Math.max(0, Math.min(projected[0][0], projected[1][0])), hi = Math.min(length, Math.max(projected[0][0], projected[1][0]));
        if (hi <= lo) continue;
        intervals = intervals.flatMap(([a,b]) => hi <= a || lo >= b ? [[a,b]] : [[a,Math.max(a,lo)], [Math.min(b,hi),b]].filter(([s,e]) => e-s > .001));
      }
      for (const [start,end] of intervals) result.push({ ...wall, a:[wall.a[0]+dx*start/length/plan.width,wall.a[1]+dz*start/length/plan.depth], b:[wall.a[0]+dx*end/length/plan.width,wall.a[1]+dz*end/length/plan.depth] });
    }
    return result;
  }
  // Coordinates use feet: X across the drawing, Y vertical, Z down the drawing.
  function boxes(plan) {
    if (plan.version === 2) return floorsOf(plan).flatMap(floor => floor.plan ? boxes(floor.plan).map(box => ({ ...box,
      x: box.x + floor.offsetX, z: box.z + floor.offsetZ,
      y: floor.elevation + (box.material === 'floor' ? -floor.slabThickness / 2 : box.y),
      height: box.material === 'floor' ? floor.slabThickness : box.height
    })) : []);
    const base = footprint(plan);
    const result = [{ ...base, y: -.15, height: .3, angle: 0, material: 'floor' }];
    const surfaces=wallSurfaces(plan),traced=plan.walls.map((w,i)=>({...w,outside:surfaces[i].outside}));
    // Keep finishes/direction around a doorway or window attached to a wall.
    for(const opening of traced.filter(w=>w.kind!=='wall')) {
      const parent=traced.find(w=>w.kind==='wall'&&[opening.a,opening.b].every(p=>{
        const dx=(w.b[0]-w.a[0])*plan.width,dz=(w.b[1]-w.a[1])*plan.depth,len=Math.hypot(dx,dz),x=(p[0]-w.a[0])*plan.width,z=(p[1]-w.a[1])*plan.depth,t=(x*dx+z*dz)/len;
        return Math.abs(x*dz-z*dx)/len<=plan.thickness*.55&&t>=-plan.thickness&&t<=len+plan.thickness;
      }));
      if(parent){opening.finish=parent.finish;opening.exteriorFinish=parent.exteriorFinish;
        const same=(opening.b[0]-opening.a[0])*(parent.b[0]-parent.a[0])+(opening.b[1]-opening.a[1])*(parent.b[1]-parent.a[1])>0;
        opening.outside=same||['none','both'].includes(parent.outside)?parent.outside:parent.outside==='left'?'right':'left';}
    }
    for (const wall of cutWalls({...plan,walls:traced})) {
      const dx = (wall.b[0] - wall.a[0]) * plan.width;
      const dz = (wall.b[1] - wall.a[1]) * plan.depth;
      const base = { x: ((wall.a[0] + wall.b[0]) / 2 - .5) * plan.width, z: ((wall.a[1] + wall.b[1]) / 2 - .5) * plan.depth, width: Math.hypot(dx, dz), depth: plan.thickness, angle: Math.atan2(dz, dx) };
      const add = (bottom, top, material = 'wall') => { if (top > bottom) result.push({ ...base, y: (bottom + top) / 2, height: top - bottom, material,
        ...(material === 'wall' ? {outside:wall.outside,
          ...(wall.finish || plan.finishes?.wall ? {finish:wall.finish || plan.finishes.wall}:{}),
          ...(wall.exteriorFinish || plan.finishes?.exterior ? {exteriorFinish:wall.exteriorFinish || plan.finishes.exterior}:{})}: {}) }); };
      if (wall.kind === 'door') {
        add(6.8, plan.height);
        // An illustrative leaf sits open inside the clear doorway, so the
        // recognized door is visible without sealing the circulation path.
        const angle = base.angle + (wall.hinge === 'b' ? Math.PI : 0) + (wall.swing || 1) * Math.PI / 3;
        const width = Math.max(.1, base.width - .15);
        const hinge = wall.hinge === 'b' ? wall.b : wall.a;
        const hingeX = (hinge[0] - .5) * plan.width, hingeZ = (hinge[1] - .5) * plan.depth;
        result.push({ x: hingeX + Math.cos(angle) * width / 2, z: hingeZ + Math.sin(angle) * width / 2,
          y: Math.min(6.7, plan.height - .2) / 2, width, depth: .12,
          height: Math.min(6.7, plan.height - .2), angle, material: 'door' });
      }
      else if (wall.kind === 'window') {
        add(0, 3); add(6.5, plan.height); add(3, 6.5, 'glass');
        add(3, 3.12, 'frame'); add(6.38, 6.5, 'frame');
        for (const along of [-base.width / 2 + .06, 0, base.width / 2 - .06]) {
          result.push({ ...base, x: base.x + Math.cos(base.angle) * along,
            z: base.z + Math.sin(base.angle) * along, width: Math.min(.12, base.width),
            depth: Math.min(.18, plan.thickness), y: 4.75, height: 3.5, material: 'frame' });
        }
      } else add(0, plan.height);
    }
    for (const item of plan.furniture || []) {
      const angle = item.rotation * Math.PI / 180;
      const baseX = (item.center[0] - .5) * plan.width, baseZ = (item.center[1] - .5) * plan.depth;
      function add(dx, dz, width, depth, bottom, top, material = 'furniture') {
        result.push({ x: baseX + dx*Math.cos(angle)-dz*Math.sin(angle), z: baseZ + dx*Math.sin(angle)+dz*Math.cos(angle), y: (bottom+top)/2, width, depth, height: top-bottom, angle, material });
      }
      const w=item.width,d=item.depth;
      if (item.type === 'bed') {
        add(0,0,w,d,.25,1.1,'wood'); add(0,0,w*.94,d*.94,1.1,1.75,'fabric');
        add(-w*.22,-d*.3,w*.38,d*.2,1.75,1.95,'light'); add(w*.22,-d*.3,w*.38,d*.2,1.75,1.95,'light');
        add(0,-d*.49,w,d*.07,.3,2.5,'wood');
      } else if (item.type === 'sofa') {
        add(0,0,w,d,.15,1.45,'fabric'); add(0,-d*.38,w,d*.24,1.45,2.8,'fabric');
        add(-w*.45,0,w*.1,d,1.1,2.2,'fabric'); add(w*.45,0,w*.1,d,1.1,2.2,'fabric');
      } else if (['dining_table','table'].includes(item.type)) {
        add(0,0,w,d,2.2,2.5,'wood');
        for (const x of [-.4,.4]) for (const z of [-.4,.4]) add(x*w,z*d,.18,.18,0,2.2,'wood');
      } else if (item.type === 'chair') {
        add(0,0,w,d,1.25,1.55,'wood'); add(0,-d*.44,w,d*.12,1.55,3,'wood');
        for (const x of [-.4,.4]) for (const z of [-.4,.4]) add(x*w,z*d,.13,.13,0,1.25,'wood');
      } else if (item.type === 'toilet') {
        add(0,d*.12,w*.72,d*.68,0,1.35,'light'); add(0,-d*.35,w*.85,d*.25,0,2.5,'light');
      } else if (item.type === 'sink') {
        add(0,0,w,d,0,2.6,'light'); add(0,0,w*.65,d*.65,2.6,2.68,'glass');
      } else if (item.type === 'wardrobe') add(0,0,w,d,0,Math.min(plan.height-1,7),'wood');
      else if (item.type === 'kitchen_counter') { add(0,0,w,d,0,2.7,'wood'); add(0,0,w,d,2.7,2.85,'light'); }
      else add(0,0,w,d,0,item.type === 'appliance' ? 3 : 2.5,item.type === 'appliance' ? 'light' : 'furniture');
    }
    return result;
  }
  function vertices(box) {
    const c = Math.cos(box.angle), s = Math.sin(box.angle);
    return [[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1],[-1,1,-1],[1,1,-1],[1,1,1],[-1,1,1]].map(([x,y,z]) => {
      x *= box.width / 2; z *= box.depth / 2;
      return [box.x + x * c - z * s, box.y + y * box.height / 2, box.z + x * s + z * c];
    });
  }
  const faces = [[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]];
  function toOBJ(plan) {
    const lines = ['# MDU Properties floor-plan layout', '# Units: feet; Y is up. Illustrative openings: doors 6.8 ft; windows 3–6.5 ft.'];
    let offset = 1;
    boxes(plan).forEach((box, index) => {
      lines.push(`o ${box.material}_${index}`);
      vertices(box).forEach(v => lines.push(`v ${v.map(n => n.toFixed(5)).join(' ')}`));
      faces.forEach(face => lines.push(`f ${face.map(i => i + offset).join(' ')}`));
      offset += 8;
    });
    return lines.join('\n') + '\n';
  }
  return { validate, validateFinish, FINISH_PATTERNS, calibrate, resizeDrawing, resizeBuilding, largeLayout, wallSpan, recognitionFurniture, surroundOpenings, cutWalls, wallSurfaces, boxes, vertices, faces, toOBJ, floorsOf, hasGeometry, coverImage, footprint, floorName, MAX_FLOORS, FURNITURE, MAX_SEGMENTS, MAX_FURNITURE };
});
