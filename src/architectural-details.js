import * as THREE from 'three';
const FT = .3048;

// Decorative details follow reviewed wall/opening cuts. Optional roofs are
// schematic rectangular volumes explicitly selected by the owner.
export function architecturalDetails(plan, { material, geometries, fullWalls, topFloor }) {
  const group = new THREE.Group(); group.name = 'Architectural details';
  const cube = new THREE.BoxGeometry(1, 1, 1); geometries.add(cube);
  const trim = material('joinery-trim', '#eeece5', { roughness: .55 });
  const metal = material('hardware', '#8d8063', { metalness: .8, roughness: .24 });
  function box(name, x, y, z, w, h, d, angle = 0, mat = trim) {
    const mesh = new THREE.Mesh(cube, mat); mesh.name = name;
    mesh.position.set(x, y, z); mesh.scale.set(w, h, d); mesh.rotation.y = -angle;
    mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh;
  }
  const p = plan.presentation || {};
  if (p.skirting !== false) {
    for (const wall of window.FloorPlanGeometry.cutWalls(plan).filter(w => w.kind !== 'door')) {
      const dx = (wall.b[0] - wall.a[0]) * plan.width * FT, dz = (wall.b[1] - wall.a[1]) * plan.depth * FT;
      const length = Math.hypot(dx, dz), angle = Math.atan2(dz, dx);
      const x = ((wall.a[0] + wall.b[0]) / 2 - .5) * plan.width * FT, z = ((wall.a[1] + wall.b[1]) / 2 - .5) * plan.depth * FT;
      for (const side of [-1, 1]) box('Skirting', x - Math.sin(angle) * side * (plan.thickness * FT / 2 + .009), .065,
        z + Math.cos(angle) * side * (plan.thickness * FT / 2 + .009), length, .13, .018, angle);
    }
  }
  if (p.trims !== false) for (const opening of plan.walls.filter(w => w.kind !== 'wall')) {
    const dx = (opening.b[0] - opening.a[0]) * plan.width * FT, dz = (opening.b[1] - opening.a[1]) * plan.depth * FT;
    const length = Math.hypot(dx, dz), angle = Math.atan2(dz, dx);
    const x = ((opening.a[0] + opening.b[0]) / 2 - .5) * plan.width * FT, z = ((opening.a[1] + opening.b[1]) / 2 - .5) * plan.depth * FT;
    const door = opening.kind === 'door', bottom = door ? 0 : 3 * FT;
    const top = Math.min((door ? 6.8 : 6.5) * FT, fullWalls ? plan.height * FT : 1.35);
    if (top <= bottom) continue;
    for (const side of [-1, 1]) {
      const sx = x - Math.sin(angle) * side * (plan.thickness * FT / 2 + .015), sz = z + Math.cos(angle) * side * (plan.thickness * FT / 2 + .015);
      for (const edge of [-1, 1]) box(door ? 'Door architrave' : 'Window reveal', sx + Math.cos(angle) * edge * (length / 2 + .025), (bottom + top) / 2,
        sz + Math.sin(angle) * edge * (length / 2 + .025), .065, top - bottom, .03, angle);
      if (fullWalls) box('Opening lintel trim', sx, top + .025, sz, length + .13, .065, .03, angle);
      if (!door) box('Window sill', sx, bottom - .025, sz, length + .16, .05, .17, angle);
    }
    if (door) {
      const leafAngle = angle + (opening.hinge === 'b' ? Math.PI : 0) + (opening.swing || 1) * Math.PI / 3;
      const hinge = opening.hinge === 'b' ? opening.b : opening.a;
      const hx = (hinge[0] - .5) * plan.width * FT, hz = (hinge[1] - .5) * plan.depth * FT, leafWidth = Math.max(.03, length - .15 * FT);
      for (const side of [-1, 1]) {
        const px = hx + Math.cos(leafAngle) * leafWidth * .82 - Math.sin(leafAngle) * side * .035;
        const pz = hz + Math.sin(leafAngle) * leafWidth * .82 + Math.cos(leafAngle) * side * .035;
        box('Door lever', px, 1.02, pz, .12, .018, .02, leafAngle, metal);
        box('Door escutcheon', px, .99, pz, .025, .13, .018, leafAngle, metal);
      }
    }
  }
  if (topFloor && fullWalls && ['flat', 'pitched'].includes(p.roof)) {
    const footprint = window.FloorPlanGeometry.footprint(plan), w = footprint.width * FT, d = footprint.depth * FT;
    const x = footprint.x * FT, z = footprint.z * FT, y = plan.height * FT;
    const roofMat = material('roof', p.roof === 'flat' ? '#d2cec2' : '#736e66', { roughness: .8 });
    if (p.roof === 'flat') {
      box('Roof slab', x, y + .09, z, w, .18, d, 0, roofMat);
      for (const side of [-1, 1]) {
        box('Roof parapet', x + side * (w / 2 - .06), y + .4, z, .12, .62, d, 0, roofMat);
        box('Roof parapet', x, y + .4, z + side * (d / 2 - .06), w, .62, .12, 0, roofMat);
      }
    } else {
      const shape = new THREE.Shape(); shape.moveTo(-w / 2, 0); shape.lineTo(0, Math.min(2, w * .24)); shape.lineTo(w / 2, 0); shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false }); geometries.add(geo);
      const roof = new THREE.Mesh(geo, roofMat); roof.name = 'Schematic pitched roof'; roof.position.set(x, y, z - d / 2); roof.castShadow = true; group.add(roof);
    }
  }
  return group;
}
