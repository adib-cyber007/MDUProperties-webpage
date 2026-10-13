import * as THREE from 'three';

// Deterministic, locally generated surface maps; no network or asset licenses.
export function detailTexture(kind, ownedTextures) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d'), data = ctx.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const noise = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    let v = 160 + (noise - Math.floor(noise)) * 25;
    if (kind === 'fabric') v += (x % 4 < 2 ? 20 : -20) + (y % 4 < 2 ? 16 : -16);
    if (kind === 'wood') v = 140 + 35 * Math.sin(x * .35 + 2 * Math.sin(y * .027)) + 14 * Math.sin(x * 1.9 + Math.sin(y * .05));
    if (kind === 'tiles') v = x < 2 || y < 2 || Math.abs(x - 128) < 2 || Math.abs(y - 128) < 2 ? 45 : 205;
    if (kind === 'stone') v = 150 + 40 * Math.sin(x * .08 + y * .06 + Math.sin(y * .04));
    const i = (y * 256 + x) * 4; data.data[i] = data.data[i + 1] = data.data[i + 2] = v; data.data[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  const texture = new THREE.CanvasTexture(canvas); texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  ownedTextures.add(texture); return texture;
}

export function normalTexture(heightMap, ownedTextures) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d'), source = heightMap.image.getContext('2d').getImageData(0, 0, 256, 256).data, data = ctx.createImageData(256,256);
  const sample = (x,y) => source[(((y + 256) % 256) * 256 + (x + 256) % 256) * 4] / 255;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const dx = sample(x-1,y) - sample(x+1,y), dy = sample(x,y-1) - sample(x,y+1), length = Math.hypot(dx,dy,1), i = (y*256+x)*4;
    data.data[i] = (dx / length * .5 + .5) * 255; data.data[i+1] = (dy / length * .5 + .5) * 255; data.data[i+2] = (1 / length * .5 + .5) * 255; data.data[i+3] = 255;
  }
  ctx.putImageData(data,0,0); const map = new THREE.CanvasTexture(canvas); map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.copy(heightMap.repeat); map.rotation = heightMap.rotation; ownedTextures.add(map); return map;
}

export function furnitureMaterials(materials, textures) {
  const maps = new Map();
  return (color, kind = 'fabric') => {
    const key = `furnishing:${kind}:${color}`;
    if (!materials.has(key)) {
      const settings = kind === 'metal' ? { metalness: .85, roughness: .23 } :
        kind === 'ceramic' ? { roughness: .17, metalness: .03 } :
        kind === 'glass' ? { transparent: true, opacity: .22, roughness: .07, depthWrite: false } :
        kind === 'light' ? { roughness: .55, emissive: '#ffe5bd', emissiveIntensity: .8 } :
        { roughness: kind === 'wood' ? .48 : .92 };
      if (['fabric', 'wood'].includes(kind)) {
        if (!maps.has(kind)) { const map = detailTexture(kind, textures); map.repeat.set(kind === 'fabric' ? 6 : 2, 6); maps.set(kind, map); }
        const normalKey = `${kind}:normal`;
        if (!maps.has(normalKey)) maps.set(normalKey, normalTexture(maps.get(kind), textures));
        settings.normalMap = maps.get(normalKey); settings.normalScale = new THREE.Vector2(.22,.22);
        settings.roughnessMap = maps.get(kind);
      }
      materials.set(key, new THREE.MeshStandardMaterial({ color, ...settings }));
    }
    return materials.get(key);
  };
}

export function contactShadowTexture(textures) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d'), gradient = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(37,30,21,.34)'); gradient.addColorStop(.55, 'rgba(37,30,21,.15)'); gradient.addColorStop(1, 'rgba(37,30,21,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas); textures.add(texture); return texture;
}
