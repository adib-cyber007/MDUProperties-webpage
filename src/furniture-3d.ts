import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
// Adapted from the owner's FLRplanner Furniture3D models; dimensions are metres.
type Item = { id: string; type: string; w: number; h: number; x: number; y: number; rotation: number; color: string };
export function furnitureModel(item: Item, materials: Map<string, THREE.MeshStandardMaterial>, geometries: Map<string, THREE.BufferGeometry>): THREE.Group {
  const group = new THREE.Group();
  group.userData = { kind: "item", id: item.id };
  const w = item.w,
    d = item.h,
    c = item.color;
  const material = (color: string) => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    return materials.get(color)!;
  };
  function box(
    x: number,
    y: number,
    z: number,
    bw: number,
    bh: number,
    bd: number,
    color = c,
    round = 0.02,
  ) {
    const key = ['box', bw, bh, bd, round].join(':');
    if (!geometries.has(key)) geometries.set(key, round
      ? new RoundedBoxGeometry(
          Math.max(0.01, bw),
          Math.max(0.01, bh),
          Math.max(0.01, bd),
          2,
          Math.min(round, bw / 3, bh / 3, bd / 3),
        )
      : new THREE.BoxGeometry(bw, bh, bd));
    const geometry = geometries.get(key)!;
    const mesh = new THREE.Mesh(geometry, material(color));
    mesh.position.set(x + bw / 2 - w / 2, y + bh / 2, z + bd / 2 - d / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }
  function cylinder(
    x: number,
    y: number,
    z: number,
    r: number,
    height: number,
    color = c,
  ) {
    const key = ['cylinder', r, height].join(':');
    if (!geometries.has(key)) geometries.set(key, new THREE.CylinderGeometry(r, r * 0.9, height, 20));
    const mesh = new THREE.Mesh(
      geometries.get(key)!,
      material(color),
    );
    mesh.position.set(x - w / 2, y + height / 2, z - d / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }
  const legs = (height: number, inset = 0.12) => {
    for (const x of [inset, w - inset])
      for (const z of [inset, d - inset])
        cylinder(x, 0, z, 0.035, height, "#827563");
  };
  if (item.type === "rug") {
    box(0, 0.003, 0, w, 0.013, d, c, 0);
  } else if (item.type === "sofa" || item.type === "armchair") {
    legs(0.18);
    box(0, 0.14, 0, w, 0.24, d, c, 0.06);
    box(0, 0.3, 0, w, 0.47, 0.16, c, 0.05);
    box(0, 0.25, 0.05, 0.15, 0.37, d - 0.05, c, 0.04);
    box(w - 0.15, 0.25, 0.05, 0.15, 0.37, d - 0.05, c, 0.04);
    const n = item.type === "sofa" ? 3 : 1;
    for (let i = 0; i < n; i++)
      box(
        0.16 + (i * (w - 0.32)) / n,
        0.36,
        0.17,
        (w - 0.34) / n,
        0.15,
        d - 0.2,
        c,
        0.055,
      );
    box(
      0.22,
      0.5,
      0.22,
      Math.min(0.34, w * 0.25),
      0.12,
      Math.min(0.35, d * 0.4),
      "#e5dfcf",
      0.05,
    );
  } else if (item.type === "bed" || item.type === "single-bed") {
    legs(0.15);
    box(0, 0.12, 0, w, 0.2, d, "#a89b83", 0.03);
    box(0.03, 0.32, 0.06, w - 0.06, 0.19, d - 0.1, "#f4f0e5", 0.07);
    box(0, 0.12, 0, w, 0.72, 0.09, "#b4aa97", 0.03);
    box(0.045, 0.52, d * 0.31, w - 0.09, 0.04, d * 0.64, c, 0.025);
    const n = item.type === "bed" ? 2 : 1;
    for (let i = 0; i < n; i++)
      box(
        0.09 + (i * (w - 0.18)) / n,
        0.53,
        0.17,
        (w - 0.24) / n,
        0.11,
        0.39,
        "#f9f5e9",
        0.06,
      );
    box(0.05, 0.56, d * 0.8, w - 0.1, 0.025, d * 0.13, "#ded4c1", 0.015);
  } else if (["coffee", "dining", "desk", "island"].includes(item.type)) {
    const height =
      item.type === "coffee" ? 0.4 : item.type === "island" ? 0.9 : 0.74;
    legs(height - 0.06, 0.15);
    const depth = item.type === "dining" ? d * 0.65 : d;
    box(
      0,
      height - 0.08,
      item.type === "dining" ? d * 0.175 : 0,
      w,
      0.08,
      depth,
      c,
      0.045,
    );
    if (item.type === "dining") {
      for (const x of [w * 0.25, w * 0.75])
        for (const z of [0.02, d - 0.34]) {
          box(x - 0.18, 0.35, z, 0.36, 0.06, 0.33, "#bcae95", 0.04);
          box(
            x - 0.18,
            0.4,
            z < 0.1 ? z : z + 0.28,
            0.36,
            0.37,
            0.045,
            "#bcae95",
            0.035,
          );
          for (const xx of [-0.13, 0.13])
            for (const zz of [0.05, 0.27])
              cylinder(x + xx, 0, z + zz, 0.022, 0.35, "#948671");
        }
      cylinder(w * 0.5, height, d * 0.5, 0.09, 0.16, "#e4e2d3");
    }
    if (item.type === "desk") {
      box(
        w * 0.35,
        height,
        d * 0.2,
        w * 0.35,
        0.02,
        d * 0.45,
        "#555f57",
        0.005,
      );
      box(
        w * 0.35,
        height + 0.02,
        d * 0.2,
        w * 0.35,
        0.28,
        0.018,
        "#627369",
        0.005,
      );
    }
    if (item.type === "coffee") {
      cylinder(w * 0.68, height, d * 0.45, 0.1, 0.035, "#e8e2d2");
      box(
        w * 0.18,
        height,
        d * 0.35,
        w * 0.22,
        0.025,
        d * 0.38,
        "#c6cdb6",
        0.003,
      );
    }
  } else if (item.type === "chair") {
    legs(0.44, 0.07);
    box(0, 0.42, 0, w, 0.07, d, c, 0.03);
    box(0, 0.46, 0, w, 0.4, 0.06, c, 0.03);
  } else if (
    ["kitchen", "wardrobe", "bookshelf", "tv", "nightstand", "sink"].includes(
      item.type,
    )
  ) {
    const height =
      item.type === "wardrobe"
        ? 2.1
        : item.type === "bookshelf"
          ? 1.6
          : item.type === "kitchen" || item.type === "sink"
            ? 0.88
            : 0.52;
    box(0, 0.08, 0, w, height - 0.08, d, c, 0.015);
    if (item.type === "kitchen" || item.type === "sink")
      box(-0.015, height, -0.015, w + 0.03, 0.045, d + 0.03, "#e0dfd4", 0.01);
    if (item.type === "tv") {
      if (w >= d)
        box(w * 0.08, 0.6, d * 0.2, w * 0.84, 0.6, 0.045, "#36433c", 0.008);
      else box(w * 0.2, 0.6, d * 0.08, 0.045, 0.6, d * 0.84, "#36433c", 0.008);
    }
    if (item.type === "sink") {
      for (const x of [w * 0.27, w * 0.73]) {
        const basin = cylinder(
          x,
          height + 0.05,
          d * 0.55,
          Math.min(w * 0.18, d * 0.34),
          0.04,
          "#becdca",
        );
        basin.scale.z = 1.2;
      }
      box(
        w * 0.48,
        height + 0.08,
        d * 0.2,
        0.025,
        0.17,
        0.025,
        "#879993",
        0.002,
      );
    }
    if (item.type === "wardrobe") {
      const n = Math.max(1, Math.round(w / 0.55));
      for (let i = 1; i < n; i++)
        box(
          (i * w) / n - 0.005,
          0.1,
          d,
          0.01,
          height - 0.1,
          0.005,
          "#9c947e",
          0,
        );
      for (let i = 0; i < n; i++)
        box(
          ((i + 0.75) * w) / n,
          1,
          d + 0.01,
          0.018,
          0.15,
          0.02,
          "#80765e",
          0.003,
        );
    }
    if (item.type === "bookshelf") {
      for (let row = 0; row < 4; row++) {
        box(
          0.03,
          0.15 + row * 0.35,
          d - 0.04,
          w - 0.06,
          0.24,
          0.045,
          "#786f5b",
          0,
        );
        for (let b = 0; b < Math.floor(w / 0.1); b++)
          box(
            0.05 + b * 0.1,
            0.17 + row * 0.35,
            d - 0.065,
            0.065,
            0.17 + (b % 3) * 0.02,
            0.03,
            ["#abb99e", "#e1d5bd", "#ac9380"][b % 3],
            0.002,
          );
      }
    }
  } else if (item.type === "bath") {
    const outer = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.5, 0.55, 8, 24),
      material("#f5f3eb"),
    );
    outer.rotation.x = Math.PI / 2;
    outer.scale.set(w * 0.9, d / 1.6, 0.5);
    outer.position.y = 0.35;
    outer.castShadow = true;
    group.add(outer);
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 32),
      material("#cbdcd7"),
    );
    water.rotation.x = -Math.PI / 2;
    water.scale.set(w * 0.7, d * 1.5, 1);
    water.position.y = 0.53;
    group.add(water);
  } else if (item.type === "toilet") {
    box(0.02, 0.2, 0.01, w - 0.04, 0.52, d * 0.26, "#f1f2e8", 0.04);
    const bowl = cylinder(w / 2, 0.15, d * 0.6, w * 0.38, 0.25, "#f6f6ee");
    bowl.scale.z = 1.25;
    const inside = cylinder(w / 2, 0.4, d * 0.6, w * 0.25, 0.025, "#ccd8d2");
    inside.scale.z = 1.25;
  } else if (item.type === "shower") {
    box(0, 0, 0, w, 0.06, d, "#d8e4df", 0.02);
    const glass = new THREE.MeshStandardMaterial({
      color: "#b8d7d3",
      transparent: true,
      opacity: 0.23,
      roughness: 0.2,
      side: THREE.DoubleSide,
    });
    const side = box(w - 0.02, 0.06, 0, 0.02, 1.9, d, "#bfd3c6", 0);
    side.material = glass;
    box(w * 0.2, 1.8, 0.04, 0.025, 0.16, 0.2, "#81948a", 0.005);
    cylinder(w * 0.5, 0.062, d * 0.5, 0.035, 0.005, "#8c9e95");
  } else if (item.type === "plant") {
    cylinder(w / 2, 0, d / 2, w * 0.25, 0.32, "#b7a78c");
    cylinder(w / 2, 0.25, d / 2, 0.025, 0.65, "#6b7556");
    for (let k = 0; k < 7; k++) {
      const a = k * 2.4;
      const leaf = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 10, 8),
        material(k % 2 ? c : "#8da876"),
      );
      leaf.scale.set(w * 0.8, 0.55, d * 1.25);
      leaf.rotation.z = Math.sin(a) * 0.5;
      leaf.position.set(
        Math.cos(a) * w * 0.22,
        0.5 + k * 0.05,
        Math.sin(a) * d * 0.2,
      );
      leaf.castShadow = true;
      group.add(leaf);
    }
  } else if (item.type === "lamp") {
    cylinder(w / 2, 0, d / 2, w * 0.38, 0.04, "#9c9680");
    cylinder(w / 2, 0.04, d / 2, 0.014, 1.3, "#817c69");
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(w * 0.48, 0.28, 24, 1, true),
      new THREE.MeshStandardMaterial({
        color: "#e4decb",
        side: THREE.DoubleSide,
      }),
    );
    shade.position.y = 1.38;
    group.add(shade);
  } else if (item.type === "stairs") {
    for (let k = 0; k < 12; k++)
      box(0, 0, (k * d) / 12, w, (k + 1) * 0.2, d / 12, c, 0);
  } else box(0, 0, 0, w, 0.5, d, c);
  group.position.set(item.x + w / 2, 0, item.y + d / 2);
  group.rotation.y = (-item.rotation * Math.PI) / 180;
  return group;
}
