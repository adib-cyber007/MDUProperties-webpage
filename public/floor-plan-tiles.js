(function (root, factory) {
  const common = typeof module === 'object' && module.exports;
  const api = factory(common ? require('./floor-plan-geometry') : root.FloorPlanGeometry,
    common ? require('./floor-plan-finishes') : root.FloorPlanFinishes);
  if (common) module.exports = api;
  else root.FloorPlanTiles = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (G, F) {
  'use strict';
  const STYLES = [8, 9, 10, 11, 12, 13, 15, 18].map(index => F.PRESETS.floor[index]);
  let controlId = 0;

  function createFinish(name, size, grout, rotation = 0) {
    const style = STYLES.find(item => item.name === name);
    if (!style) throw new Error('Choose a floor tile style.');
    // Each procedural texture contains two tiles along each edge.
    return G.validateFinish({ ...style.finish, scale: size * 2, rotation, tile: { name, grout } });
  }
  function applyTiles(plan, finish) {
    const checked = G.validate(plan);
    if (!checked || checked.version !== 1) throw new Error('Select a floor with a drawing before applying tiles.');
    const tile = G.validateFinish(finish);
    if (!tile.tile) throw new Error('Choose a floor tile style.');
    return G.validate({ ...checked, finishes: { ...checked.finishes, floor: tile } });
  }
  function createControls(root, { getPlan, applyPlan, isReady, onStatus }) {
    const id = ++controlId;
    let chosen = '', saved;
    root.classList.add('fp-tiles');
    root.innerHTML = `<div class="fp-paint-heading"><h3>Floor tiles</h3><p>Choose a tile style for this floor, then set its size and grout colour.</p></div>
      <div class="fp-tile-styles" role="group" aria-label="Floor tile styles"></div>
      <div class="fp-tile-settings">
        <div class="fp-tile-setting"><label for="fp-tile-${id}-size">Tile size (ft)</label><input id="fp-tile-${id}-size" data-tile-size type="text" value="2" inputmode="decimal" autocomplete="off" aria-describedby="fp-tile-${id}-note"></div>
        <div class="fp-tile-setting"><label for="fp-tile-${id}-grout">Grout colour</label><input id="fp-tile-${id}-grout" data-tile-grout type="color" value="#bcb4a5"></div>
        <div class="fp-tile-setting"><label for="fp-tile-${id}-rotation">Tile orientation</label><select id="fp-tile-${id}-rotation" data-tile-rotation><option value="0">Straight</option><option value="45">Diagonal · 45°</option><option value="90">Quarter turn · 90°</option></select></div>
      </div>
      <div class="fp-tile-preview"><span data-tile-preview aria-hidden="true"></span><p data-tile-description role="status"></p><button type="button" class="btn btn-outline btn-small" data-tile-apply>Apply floor tiles</button></div>
      <p class="fp-note" data-tile-current role="status"></p>
      <p class="fp-note" id="fp-tile-${id}-note">Size is the edge of each square tile: enter 2 for 2 × 2 ft tiles. Applying updates this floor in 3D. Save the project to keep it. Samples are illustrative; custom flooring images are available below.</p>`;
    const size = root.querySelector('[data-tile-size]'), grout = root.querySelector('[data-tile-grout]'), rotation = root.querySelector('[data-tile-rotation]');
    const apply = root.querySelector('[data-tile-apply]'), styles = root.querySelector('.fp-tile-styles');
    function draft() { return createFinish(chosen, Number(size.value), grout.value, Number(rotation.value)); }
    function preview() {
      let finish;
      try { finish = draft(); } catch { /* Keep the model while the selection is incomplete. */ }
      size.setAttribute('aria-invalid', String(!!chosen && !finish));
      root.querySelector('[data-tile-preview]').replaceChildren(...(finish ? [F.canvas(finish, 80)] : []));
      root.querySelector('[data-tile-description]').textContent = finish ? `${chosen} · ${Number(size.value)} × ${Number(size.value)} ft` : chosen ? 'Enter a tile size between 0.125 and 10 ft.' : 'Choose a tile sample to begin.';
      apply.disabled = !isReady() || !finish;
      for (const button of styles.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.tileStyle === chosen));
    }
    for (const style of STYLES) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'fp-tile-style';
      button.dataset.tileStyle = style.name; button.setAttribute('aria-label', style.name + ' floor tiles');
      const sample = F.canvas(createFinish(style.name, 2, style.finish.pattern === 'tiles' ? style.finish.accent : '#bcb4a5'), 100);
      sample.setAttribute('aria-hidden', 'true'); const label = document.createElement('span'); label.textContent = style.name;
      button.append(sample, label); styles.append(button);
      button.onclick = () => { chosen = style.name; preview(); };
    }
    function sync() {
      const finish = getPlan()?.finishes?.floor, next = JSON.stringify(finish || null), ready = isReady();
      if (saved !== next) {
        saved = next;
        const style = STYLES.find(item => item.name === finish?.tile?.name) || STYLES.find(item => item.finish.pattern === finish?.pattern && item.finish.color === finish?.color && item.finish.accent === finish?.accent);
        chosen = style?.name || '';
        size.value = style ? finish.scale / 2 : 2;
        grout.value = finish?.tile?.grout || (style?.finish.pattern === 'tiles' ? style.finish.accent : '#bcb4a5');
        const angle = finish?.rotation || 0;
        for (const option of [...rotation.options]) if (!['0', '45', '90'].includes(option.value)) option.remove();
        if (![0, 45, 90].includes(angle)) rotation.add(new Option(`${angle}°`, String(angle)));
        rotation.value = String(angle);
      }
      root.querySelector('[data-tile-current]').textContent = finish?.tile ? `Current floor: ${finish.tile.name} · ${finish.scale / 2} × ${finish.scale / 2} ft` : `Current floor: ${(finish || F.DEFAULTS.floor).pattern} finish. Choose and apply tiles to replace it.`;
      for (const input of root.querySelectorAll('input, select, .fp-tile-style')) input.disabled = !ready;
      preview();
    }
    function commit() {
      if (!isReady()) return;
      try {
        const finish = draft();
        if (JSON.stringify(getPlan()?.finishes?.floor) !== JSON.stringify(finish)) applyPlan(applyTiles(getPlan(), finish));
        onStatus(`${chosen} floor tiles applied. Save the project to keep them.`);
      } catch (error) { onStatus(error.message, true); }
    }
    for (const input of [size, grout, rotation]) {
      input.oninput = preview;
      input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } };
    }
    apply.onclick = commit; sync();
    return { sync };
  }
  return { STYLES, createFinish, applyTiles, createControls };
});
