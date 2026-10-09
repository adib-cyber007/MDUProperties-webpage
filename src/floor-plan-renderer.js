import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { furnitureModel } from './furniture-3d.ts';
import { frameBounds } from './view-framing.cjs';
import { createWalkCollision, walkthroughStart, walkthroughStep } from './floor-plan-walkthrough.cjs';

const FT = .3048;
const typeMap = { dining_table: 'dining', table: 'coffee', kitchen_counter: 'kitchen', appliance: 'kitchen' };
const colors = { bed: '#78988e', sofa: '#8fa699', chair: '#b9a388', wardrobe: '#b8a78f', kitchen_counter: '#b9b6a7', sink: '#d2d6ce', toilet: '#f1f2e8', appliance: '#dbe0dc' };

// Static geometry stays on the GPU; camera motion only changes camera uniforms.
window.FloorPlanRenderer = function (canvas, { onSelectFurniture, onError, onRestore, onViewChange } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'default' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#edf0eb');
  const content = new THREE.Group(); scene.add(content);
  const hemisphere = new THREE.HemisphereLight('#fffefa', '#d2cdc5', 2); scene.add(hemisphere);
  const roomLight = new THREE.AmbientLight('#fff8ed', .65); roomLight.visible = false; scene.add(roomLight);
  const sun = new THREE.DirectionalLight('#fff2db', 2.2); sun.position.set(-5, 18, 8); sun.castShadow = true;
  sun.shadow.bias = -.0005; sun.shadow.normalBias = .025;
  scene.add(sun); scene.add(sun.target);
  const camera = new THREE.PerspectiveCamera(42, 1, .03, 1200);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = .12;
  controls.maxPolarAngle = Math.PI * .49; controls.minDistance = .7; controls.maxDistance = 200;
  const materials = new Map(), geometries = new Set(), textures = new Set();
  let plan = null, fingerprint = '', fullWalls = true, showCeiling = false, ceilingView = false, quality = 'auto', frame = 0, visible = true, disposed = false, lost = false;
  let textureJobs = [];
  let fitted = false, cameraInteracted = false, renderCount = 0, buildCount = 0, picks = [], pointerStart = null, visibleFloor = 'all', dimensionFingerprint = '';
  let walking = false, walkFloor = null, collision = null, walkYaw = 0, walkPitch = 0, lastFrame = 0, savedOverview = null;
  const pressed = new Set(), forward = new THREE.Vector3(), right = new THREE.Vector3(), delta = new THREE.Vector3();
  const walkCache = new Map();

  function schedule() { if (!frame && !disposed && !lost && visible && !document.hidden) { lastFrame = performance.now(); frame = requestAnimationFrame(render); } }
  function render(now) {
    frame = 0;
    if (disposed || lost || !visible || document.hidden) return;
    const dt = Math.min(.05, Math.max(0, (now - lastFrame) / 1000)); lastFrame = now;
    if (walking && collision && pressed.size) {
      forward.set(0, 0, -1).applyQuaternion(camera.quaternion); forward.y = 0; forward.normalize();
      right.set(1, 0, 0).applyQuaternion(camera.quaternion); right.y = 0; right.normalize();
      delta.set(0, 0, 0);
      if (pressed.has('w') || pressed.has('arrowup')) delta.add(forward);
      if (pressed.has('s') || pressed.has('arrowdown')) delta.sub(forward);
      if (pressed.has('d') || pressed.has('arrowright')) delta.add(right);
      if (pressed.has('a') || pressed.has('arrowleft')) delta.sub(right);
      delta.normalize().multiplyScalar(dt * 2);
      const next = walkthroughStep({ x: camera.position.x - walkFloor.offsetX * FT, y: camera.position.z - walkFloor.offsetZ * FT }, delta.x, delta.z, collision.canWalk);
      camera.position.x = next.x + walkFloor.offsetX * FT; camera.position.z = next.y + walkFloor.offsetZ * FT;
    } else if (!walking) controls.update();
    renderer.render(scene, camera); renderCount++;
    if (walking && pressed.size) frame = requestAnimationFrame(render);
  }
  controls.addEventListener('change', schedule);
  controls.addEventListener('start', () => { cameraInteracted = true; });
  function material(key, color, properties = {}) {
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: .88, ...properties }));
    return materials.get(key);
  }
  function clearContent() {
    content.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
    content.clear(); geometries.forEach(g => g.dispose()); geometries.clear();
    materials.forEach(m => m.dispose()); materials.clear(); textures.forEach(t => t.dispose()); textures.clear(); picks = []; textureJobs = [];
  }
  function finishMaterial(finish) {
    const key = `finish:${JSON.stringify(finish)}`;
    if (materials.has(key)) return materials.get(key);
    let map = null;
    if (finish.pattern !== 'solid') {
      map = finish.pattern === 'custom' ? new THREE.Texture() : new THREE.CanvasTexture(window.FloorPlanFinishes.canvas(finish));
      textures.add(map); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(1 / finish.scale, 1 / finish.scale); map.rotation = finish.rotation * Math.PI / 180;
      map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      if (finish.pattern === 'custom') {
        const texture = map;
        textureJobs.push(new Promise(resolve => {
          const image = new Image();
          image.onload = () => {
            if (!disposed && textures.has(texture)) {
              texture.image = image; texture.repeat.y = image.width / image.height / finish.scale; texture.needsUpdate = true; schedule();
            }
            resolve();
          };
          image.onerror = () => { if (!disposed && textures.has(texture)) onError?.('A custom finish image could not be displayed. Upload another PNG, JPG or WebP texture.'); resolve(); };
          image.src = finish.texture;
        }));
      }
    }
    const mat=material(key, finish.pattern === 'solid' || finish.pattern === 'custom' ? finish.color : '#ffffff', {
      map, roughness: ['marble', 'tiles'].includes(finish.pattern) ? .42 : .88, side: THREE.DoubleSide
    });
    mat.name=finish.paint?`${finish.paint.brand} ${finish.paint.name} (${finish.paint.code})`:`${finish.pattern} ${finish.color}`;return mat;
  }
  function surfaceGeometry(width, depth) {
    const geometry = new THREE.PlaneGeometry(width * FT, depth * FT), uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * width, uv.getY(i) * depth);
    geometries.add(geometry); return geometry;
  }
  function texturedBox(box) {
    const geometry = new THREE.BoxGeometry(box.width * FT, box.height, box.depth * FT), uv = geometry.attributes.uv;
    // Box faces use real surface dimensions, so wallpaper does not stretch
    // when wall lengths/heights vary. All textured walls merge by material.
    for (let i = 0; i < uv.count; i++) {
      const face = Math.floor(i / 4);
      const w = face < 2 ? box.depth : box.width;
      const h = face < 2 || face >= 4 ? box.height / FT : box.depth;
      const along = box.x * Math.cos(box.angle) + box.z * Math.sin(box.angle) - box.width / 2;
      const bottom = box.y / FT - box.height / FT / 2;
      uv.setXY(i, uv.getX(i) * w + (face >= 4 ? along : 0), uv.getY(i) * h + (face < 2 || face >= 4 ? bottom : 0));
    }
    geometry.rotateY(-box.angle); geometry.translate(box.x * FT, box.y, box.z * FT); return geometry;
  }
  function applyQuality() {
    const large = window.FloorPlanGeometry.floorsOf(plan).reduce((n, f) => n + (f.plan?.furniture?.length || 0), 0) > 45;
    const mobile = canvas.clientWidth < 600;
    const ratio = quality === 'fast' ? 1 : quality === 'high' ? 2 : large || mobile ? 1.25 : 1.5;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ratio));
    renderer.shadowMap.enabled = quality !== 'fast';
    const size = quality === 'high' ? 2048 : large || mobile ? 512 : 1024;
    if (sun.shadow.mapSize.x !== size) { sun.shadow.map?.dispose(); sun.shadow.map = null; sun.shadow.mapSize.set(size, size); }
    renderer.shadowMap.needsUpdate = true;
  }
  function visibleBounds() {
    const bounds = new THREE.Box3();
    content.children.filter(group => group.visible).forEach(group => bounds.union(new THREE.Box3().setFromObject(group)));
    return bounds;
  }
  function fit() {
    if (!plan) return;
    const bounds = visibleBounds();
    if (bounds.isEmpty()) return;
    const frame = frameBounds(bounds.min.toArray(), bounds.max.toArray(), camera.aspect, camera.fov);
    const distance = frame.distance;
    controls.target.fromArray(frame.center);
    camera.far = Math.max(1200, distance * 8); camera.updateProjectionMatrix();
    camera.position.copy(controls.target).add(new THREE.Vector3().fromArray(frame.direction).multiplyScalar(distance));
    controls.maxDistance = Math.max(20, distance * 4); controls.update(); fitted = true; cameraInteracted = false;
  }
  function resize() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height || disposed) return;
    const changedAspect = Math.abs(camera.aspect - width / height) > .01;
    applyQuality(); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    if (!walking && !ceilingView && (!fitted || changedAspect)) fit(); schedule();
  }
  function build() {
    clearContent(); buildCount++;
    roomLight.visible = ceilingView || walking;
    if (!window.FloorPlanGeometry.hasGeometry(plan)) { schedule(); return; }
    content.userData = { units: 'metres', wallView: walking || fullWalls ? 'full' : 'cutaway', ceilingVisible: walking || showCeiling };
    const building = plan;
    for (const floor of window.FloorPlanGeometry.floorsOf(building)) {
    const plan = floor.plan;
    if (!plan?.walls?.length) continue;
    const group = new THREE.Group(); group.name = floor.name;
    group.visible = visibleFloor === 'all' || String(floor.index) === visibleFloor;
    group.position.set(floor.offsetX * FT, floor.elevation * FT, floor.offsetZ * FT);
    group.userData = { floorIndex: floor.index, elevation: floor.elevation * FT, actualWallHeight: plan.height * FT };
    content.add(group);
    const width = plan.width * FT, depth = plan.depth * FT;
    const footprint = window.FloorPlanGeometry.footprint(plan);
    const cube = new THREE.BoxGeometry(1, 1, 1); geometries.add(cube);
    const batches = new Map();
    const wallBatches = new Map();
    const heightLimit = walking || fullWalls ? plan.height * FT : Math.min(plan.height * FT, 1.35);
    for (const box of window.FloorPlanGeometry.boxes({ ...plan, furniture: [] })) {
      if (box.material === 'floor') continue;
      const bottom = (box.y - box.height / 2) * FT, top = Math.min((box.y + box.height / 2) * FT, heightLimit);
      if (top <= bottom) continue;
      const key = box.material;
      if (key === 'wall') {
        const finish = box.finish || plan.finishes?.wall || window.FloorPlanFinishes.DEFAULTS.wall;
        const outside=box.outside||'none',exterior=box.exteriorFinish||plan.finishes?.exterior||window.FloorPlanFinishes.DEFAULTS.exterior;
        const geometry=texturedBox({...box,y:(bottom+top)/2,height:top-bottom});
        const interiorMat=finishMaterial(finish),exteriorMat=finishMaterial(exterior);
        // +Z is the marked side of the directed wall. Split the six box faces
        // before merging so indoor wallpaper never wraps onto the facade.
        // Caps on outside walls use the facade; inside caps use plain paint.
        const capMat=outside==='none'?finishMaterial({...finish,pattern:'solid'}):exteriorMat;
        const faceMaterials=[capMat,capMat,capMat,capMat,
          ['left','both'].includes(outside)?exteriorMat:interiorMat,
          ['right','both'].includes(outside)?exteriorMat:interiorMat];
        const indicesByMaterial=new Map();
        for(const face of geometry.groups) {
          const mat=faceMaterials[face.materialIndex];if(!indicesByMaterial.has(mat))indicesByMaterial.set(mat,[]);
          const indices=indicesByMaterial.get(mat);
          for(let i=face.start;i<face.start+face.count;i++)indices.push(geometry.index.getX(i));
        }
        for(const [mat,indices] of indicesByMaterial) {
          const part=geometry.clone();part.clearGroups();part.setIndex(indices);
          if(!wallBatches.has(mat))wallBatches.set(mat,[]);wallBatches.get(mat).push(part);
        }
        geometry.dispose();
        continue;
      }
      if (!batches.has(key)) batches.set(key, []);
      batches.get(key).push({ ...box, y: (bottom + top) / 2, height: top - bottom });
    }
    const transform = new THREE.Object3D();
    for (const [mat, parts] of wallBatches) {
      const geometry = mergeGeometries(parts, false); parts.forEach(p => p.dispose());
      if (!geometry) continue;
      geometries.add(geometry); const mesh = new THREE.Mesh(geometry, mat); mesh.name = 'Finished walls'; mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
    }
    for (const [key, boxes] of batches) {
      const mat = key === 'glass' ? material('glass', '#adcfc7', { transparent: true, opacity: .35, roughness: .2, depthWrite: false }) :
        key === 'door' ? material('door', '#a98158', { roughness: .68 }) :
        key === 'frame' ? material('frame', '#425e67', { roughness: .45 }) : material('walls', '#e0e1d8');
      const mesh = new THREE.InstancedMesh(cube, mat, boxes.length);
      boxes.forEach((box, index) => {
        transform.position.set(box.x * FT, box.y, box.z * FT); transform.rotation.set(0, -box.angle, 0);
        transform.scale.set(box.width * FT, box.height, (key === 'glass' ? Math.min(box.depth, .1) : box.depth) * FT);
        transform.updateMatrix(); mesh.setMatrixAt(index, transform.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
      mesh.castShadow = key !== 'glass'; mesh.receiveShadow = true; group.add(mesh);
    }
    const slab = new THREE.Mesh(cube, material('slab', '#c8d0c2'));
    slab.scale.set(footprint.width * FT, floor.slabThickness * FT, footprint.depth * FT);
    slab.position.set(footprint.x * FT, -floor.slabThickness * FT / 2, footprint.z * FT);
    slab.receiveShadow = true; group.add(slab);
    const surface = new THREE.Mesh(surfaceGeometry(footprint.width, footprint.depth), finishMaterial(plan.finishes?.floor || window.FloorPlanFinishes.DEFAULTS.floor));
    surface.name = 'Finished floor';
    surface.rotation.x = -Math.PI / 2; surface.position.set(footprint.x * FT, .002, footprint.z * FT); surface.receiveShadow = true; group.add(surface);
    const ceiling = new THREE.Mesh(surfaceGeometry(footprint.width, footprint.depth), finishMaterial(plan.finishes?.ceiling || window.FloorPlanFinishes.DEFAULTS.ceiling));
    ceiling.name = 'Ceiling finish'; ceiling.rotation.x = Math.PI / 2; ceiling.position.set(footprint.x * FT, plan.height * FT, footprint.z * FT);
    ceiling.visible = walking || showCeiling; ceiling.receiveShadow = false; group.add(ceiling);

    // Merge furniture by material after placing it. Rounded detail does not create a draw call for every cushion or leg.
    const furnitureBatches = new Map(), sourceGeometries = new Map(), originals = new Set();
    (plan.furniture || []).forEach((item, index) => {
      const w = item.width * FT, d = item.depth * FT;
      const model = furnitureModel({ id: String(index), type: typeMap[item.type] || item.type, w, h: d,
        x: (item.center[0] - .5) * width - w / 2, y: (item.center[1] - .5) * depth - d / 2,
        rotation: item.rotation, color: colors[item.type] || '#b7a58b' }, materials, sourceGeometries);
      model.updateMatrixWorld(true);
      picks.push({ index, bounds: new THREE.Box3().setFromObject(model).translate(group.position) });
      model.traverse(object => {
        if (!object.isMesh) return;
        const copy = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
        copy.applyMatrix4(object.matrixWorld);
        if (!furnitureBatches.has(object.material)) furnitureBatches.set(object.material, []);
        furnitureBatches.get(object.material).push(copy); originals.add(object.geometry);
      });
    });
    originals.forEach(geometry => geometry.dispose());
    for (const [mat, parts] of furnitureBatches) {
      const geometry = mergeGeometries(parts, false); parts.forEach(p => p.dispose());
      if (!geometry) continue;
      geometries.add(geometry); const mesh = new THREE.Mesh(geometry, mat); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
    }
    }
    const bounds = new THREE.Box3().setFromObject(content), center = bounds.getCenter(new THREE.Vector3());
    const span = bounds.getSize(new THREE.Vector3()).length() + 3;
    sun.target.position.copy(center); sun.position.copy(center).add(new THREE.Vector3(-span * .4, span * 1.2, span * .55));
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: .1, far: span * 4 });
    sun.shadow.camera.updateProjectionMatrix(); renderer.shadowMap.needsUpdate = true;
    applyQuality(); resize(); schedule();
  }
  function update(next) {
    const dimensions = model => JSON.stringify(window.FloorPlanGeometry.floorsOf(model).map(f => [f.offsetX, f.offsetZ, f.elevation, f.plan?.width, f.plan?.depth, f.plan?.height]));
    const nextDimensions = dimensions(next), sizeChanged = dimensionFingerprint !== nextDimensions;
    dimensionFingerprint = nextDimensions;
    const key = JSON.stringify(window.FloorPlanGeometry.floorsOf(next).map(f => [f.elevation, f.offsetX, f.offsetZ, f.slabThickness, f.plan?.width, f.plan?.depth, f.plan?.height, f.plan?.thickness, f.plan?.walls, f.plan?.furniture, f.plan?.finishes]));
    plan = next;
    if (key === fingerprint) return;
    walkCache.clear();
    if (walking && !prepareWalk(visibleFloor, !sizeChanged)) stopWalk(false);
    if (!cameraInteracted || sizeChanged) fitted = false;
    fingerprint = key; build();
  }
  function action(name) {
    if (!plan) return;
    if (name === 'walk') { if (walking) stopWalk(); else startWalk(); return walking; }
    if (walking && name === 'reset') { prepareWalk(visibleFloor); canvas.focus({ preventScroll: true }); schedule(); return; }
    if (walking && ['walls', 'ceiling', 'left', 'right', 'up', 'down', 'in', 'out'].includes(name)) return;
    if (walking && ['top', 'ceiling-view'].includes(name)) stopWalk();
    if (name === 'walls') { fullWalls = !fullWalls; build(); return fullWalls; }
    if (name === 'ceiling') {
      showCeiling = !showCeiling;
      if (!showCeiling) { const wasInside = ceilingView; ceilingView = false; roomLight.visible = false; controls.maxPolarAngle = Math.PI * .49; if (wasInside) fit(); }
      content.userData.ceilingVisible = showCeiling;
      content.traverse(object => { if (object.name === 'Ceiling finish') object.visible = showCeiling; });
      schedule(); return showCeiling;
    }
    if (name === 'ceiling-view') {
      ceilingView = true; showCeiling = true; fullWalls = true; controls.maxPolarAngle = Math.PI - .01; build();
      viewCeiling(); return;
    }
    if (name === 'reset' || name === 'top') {
      if (ceilingView || showCeiling) { ceilingView = false; showCeiling = false; controls.maxPolarAngle = Math.PI * .49; build(); }
      if (name === 'reset') { fit(); schedule(); return; }
    }
    cameraInteracted = true;
    const offset = camera.position.clone().sub(controls.target), sphere = new THREE.Spherical().setFromVector3(offset);
    if (name === 'left') sphere.theta -= .2;
    if (name === 'right') sphere.theta += .2;
    if (name === 'up') sphere.phi = Math.max(.01, sphere.phi - .12);
    if (name === 'down') sphere.phi = Math.min(controls.maxPolarAngle, sphere.phi + .12);
    if (name === 'in') sphere.radius = Math.max(controls.minDistance, sphere.radius / 1.15);
    if (name === 'out') sphere.radius = Math.min(controls.maxDistance, sphere.radius * 1.15);
    if (name === 'top') { sphere.phi = .001; sphere.theta = 0; }
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sphere)); controls.update(); schedule();
  }
  function viewCeiling() {
    const floors = window.FloorPlanGeometry.floorsOf(plan).filter(f => f.plan);
    const floor = floors.find(f => String(f.index) === visibleFloor) || floors[0];
    if (!floor) return;
    const bounds = window.FloorPlanGeometry.footprint(floor.plan), elevation = floor.elevation * FT;
    const x = (bounds.x + floor.offsetX) * FT, z = (bounds.z + floor.offsetZ) * FT, height = floor.plan.height * FT;
    controls.target.set(x, elevation + height * .8, z);
    camera.position.set(x - bounds.width * FT * .15, elevation + Math.min(1.6, height * .6), z + bounds.depth * FT * .15);
    cameraInteracted = true; fitted = true; controls.update(); schedule();
  }
  function viewState() { return { fullWalls, showCeiling, ceilingView, walking, visibleFloor }; }
  function changedView() { onViewChange?.(viewState()); }
  function prepareWalk(value, preserve = false) {
    pressed.clear(); pointerStart = null;
    const floors = window.FloorPlanGeometry.floorsOf(plan).filter(f => f.plan?.walls?.some(w => w.kind === 'wall'));
    const floor = floors.find(f => String(f.index) === String(value)) || (value === 'all' ? floors[0] : null);
    if (!floor) { onError?.('This floor has no reviewed walls. Choose a floor with a saved layout.'); return false; }
    let prepared = walkCache.get(floor.index);
    if (!prepared) { prepared = createWalkCollision(floor.plan, window.FloorPlanGeometry); walkCache.set(floor.index, prepared); }
    const position = { x: camera.position.x - floor.offsetX * FT, y: camera.position.z - floor.offsetZ * FT };
    const keep = preserve && walkFloor?.index === floor.index && prepared.canWalk(position.x, position.y);
    const start = keep ? position : walkthroughStart(prepared);
    if (!start) { onError?.('There is no clear space to start the walkthrough. Check the floor dimensions, walls and furniture.'); return false; }
    walkFloor = floor; collision = prepared; visibleFloor = String(floor.index);
    if (!keep) { walkYaw = 0; walkPitch = -.1; }
    camera.position.set(start.x + floor.offsetX * FT, floor.elevation * FT + prepared.eyeHeight, start.y + floor.offsetZ * FT);
    camera.rotation.set(walkPitch, walkYaw, 0, 'YXZ');
    return true;
  }
  function startWalk() {
    const previous = { position: camera.position.clone(), target: controls.target.clone(), visibleFloor,
      fullWalls, showCeiling, ceilingView, maxPolarAngle: controls.maxPolarAngle, fov: camera.fov };
    if (!prepareWalk(visibleFloor)) return;
    savedOverview = previous; walking = true; ceilingView = false; controls.enabled = false;
    camera.fov = 75; camera.updateProjectionMatrix();
    build(); changedView(); canvas.focus({ preventScroll: true }); schedule();
  }
  function stopWalk(rebuild = true) {
    if (!walking) return;
    walking = false; pressed.clear(); pointerStart = null; collision = null; walkFloor = null; controls.enabled = true;
    if (savedOverview) {
      visibleFloor = savedOverview.visibleFloor; fullWalls = savedOverview.fullWalls; showCeiling = savedOverview.showCeiling;
      ceilingView = savedOverview.ceilingView; controls.maxPolarAngle = savedOverview.maxPolarAngle;
      camera.fov = savedOverview.fov; camera.updateProjectionMatrix();
      camera.position.copy(savedOverview.position); controls.target.copy(savedOverview.target); savedOverview = null;
    }
    controls.update(); if (rebuild) build(); changedView(); schedule();
  }
  function move(key, active) {
    if (!walking || !['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) return;
    if (active) { pressed.add(key); canvas.focus({ preventScroll: true }); schedule(); } else pressed.delete(key);
  }
  function keydown(event) {
    if (walking) {
      const key = event.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) { event.preventDefault(); move(key, true); }
      else if (event.key === 'Home') { event.preventDefault(); action('reset'); }
      else if (event.key === 'Escape') { event.preventDefault(); stopWalk(); }
      return;
    }
    const name = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', '+': 'in', '=': 'in', '-': 'out', Home: 'reset' }[event.key];
    if (name) { event.preventDefault(); action(name); }
  }
  function keyup(event) { pressed.delete(event.key.toLowerCase()); }
  function clearMovement() { pressed.clear(); pointerStart = null; }
  function cancelLook() { pointerStart = null; }
  function pointerdown(event) {
    pointerStart = { x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, id: event.pointerId };
    canvas.focus({ preventScroll: true });
    if (walking) { event.preventDefault(); canvas.setPointerCapture(event.pointerId); }
  }
  function pointermove(event) {
    if (!walking || !pointerStart || pointerStart.id !== event.pointerId) return;
    walkYaw -= (event.clientX - pointerStart.lastX) * .005;
    walkPitch = Math.max(-1.2, Math.min(1.2, walkPitch - (event.clientY - pointerStart.lastY) * .005));
    pointerStart.lastX = event.clientX; pointerStart.lastY = event.clientY;
    camera.rotation.set(walkPitch, walkYaw, 0, 'YXZ'); schedule();
  }
  function pointerup(event) {
    if (walking) { pointerStart = null; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); return; }
    if (!onSelectFurniture || !pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) { pointerStart = null; return; }
    pointerStart = null;
    const rect = canvas.getBoundingClientRect(), raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    let nearest = Infinity, found = -1;
    for (const pick of picks) { const point = raycaster.ray.intersectBox(pick.bounds, new THREE.Vector3()); if (point) { const distance = point.distanceTo(camera.position); if (distance < nearest) { nearest = distance; found = pick.index; } } }
    if (found >= 0) onSelectFurniture(found);
  }
  function contextlost(event) { event.preventDefault(); lost = true; clearMovement(); cancelAnimationFrame(frame); frame = 0; onError?.('3D graphics were interrupted. Waiting for your browser to restore the preview.'); }
  function contextrestored() { lost = false; renderer.shadowMap.needsUpdate = true; onRestore?.(); schedule(); }
  function visibility() { if (document.hidden) { clearMovement(); cancelAnimationFrame(frame); frame = 0; } else schedule(); }
  canvas.addEventListener('keydown', keydown); canvas.addEventListener('pointerdown', pointerdown); canvas.addEventListener('pointerup', pointerup);
  canvas.addEventListener('pointermove', pointermove); canvas.addEventListener('pointercancel', cancelLook); canvas.addEventListener('lostpointercapture', cancelLook); canvas.addEventListener('blur', clearMovement);
  window.addEventListener('keyup', keyup); window.addEventListener('blur', clearMovement);
  canvas.addEventListener('webglcontextlost', contextlost); canvas.addEventListener('webglcontextrestored', contextrestored);
  document.addEventListener('visibilitychange', visibility);
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas);
  const intersection = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (visible) schedule(); else { clearMovement(); cancelAnimationFrame(frame); frame = 0; } }); intersection.observe(canvas);
  resize();
  return {
    update, action, move,
    setFloor(value) {
      if (walking) { if (!prepareWalk(value, String(value) === visibleFloor)) { changedView(); return; } }
      else visibleFloor = String(value);
      content.children.forEach(group => { group.visible = visibleFloor === 'all' || String(group.userData.floorIndex) === visibleFloor; });
      if (!walking) { if (ceilingView) viewCeiling(); else if (!cameraInteracted) fit(); }
      renderer.shadowMap.needsUpdate = true; changedView(); schedule();
    },
    setQuality(value) { if (!['auto', 'high', 'fast'].includes(value)) return; quality = value; resize(); },
    getStats() { return { renderCount, buildCount, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, pixelRatio: renderer.getPixelRatio(), visible, lost, fullWalls, showCeiling, ceilingView, walking, walkFloor: walkFloor?.index ?? null, cameraPosition: camera.position.toArray(), cameraRotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z], pressedKeys: [...pressed], cameraDistance: camera.position.distanceTo(controls.target), boundsMetres: visibleBounds().getSize(new THREE.Vector3()).toArray(), floors: content.children.map(group => ({ name: group.name, elevation: group.position.y, visible: group.visible })) }; },
    getViewState: viewState,
    async exportPNG() { await Promise.all(textureJobs); renderer.render(scene, camera); return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not capture the 3D view.')), 'image/png')); },
    async exportGLB() { await Promise.all(textureJobs); return new GLTFExporter().parseAsync(content, { binary: true, onlyVisible: true }); },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); resizeObserver.disconnect(); intersection.disconnect(); controls.dispose();
      document.removeEventListener('visibilitychange', visibility);
      canvas.removeEventListener('keydown', keydown); canvas.removeEventListener('pointerdown', pointerdown); canvas.removeEventListener('pointerup', pointerup);
      canvas.removeEventListener('pointermove', pointermove); canvas.removeEventListener('pointercancel', cancelLook); canvas.removeEventListener('lostpointercapture', cancelLook); canvas.removeEventListener('blur', clearMovement);
      window.removeEventListener('keyup', keyup); window.removeEventListener('blur', clearMovement); walkCache.clear(); clearMovement();
      canvas.removeEventListener('webglcontextlost', contextlost); canvas.removeEventListener('webglcontextrestored', contextrestored);
      clearContent(); sun.shadow.map?.dispose(); renderer.dispose(); renderer.forceContextLoss();
    }
  };
};
