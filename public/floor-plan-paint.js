(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./floor-plan-geometry') : root.FloorPlanGeometry);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FloorPlanPaint = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (G) {
  'use strict';
  const BRAND = 'Asian Paints';
  const normalize = value => String(value || '').trim().toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9]+/g, ' ').trim();
  const alias = name => normalize(name.replace(/-n$/i, ''));
  const label = shade => `${shade.name} (${shade.code})`;
  let cataloguePromise, controlId = 0;

  function validateCatalogue(data) {
    if (data?.brand !== BRAND || !Array.isArray(data.shades) || !data.shades.length) throw new Error('The paint shade catalogue could not be read.');
    const codes = new Set();
    for (const shade of data.shades) {
      if (!shade || typeof shade.name !== 'string' || !shade.name.trim() || shade.name.length > 80 ||
          typeof shade.code !== 'string' || !/^[a-z0-9]{4,8}$/i.test(shade.code) || typeof shade.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(shade.color) || codes.has(shade.code)) throw new Error('The paint shade catalogue contains an invalid shade.');
      codes.add(shade.code);
    }
    return data;
  }
  function resolve(data, input) {
    const key = normalize(input);
    if (!key) return null;
    const matches = data.shades.filter(shade => [normalize(shade.code), normalize(shade.name), alias(shade.name), normalize(label(shade))].includes(key));
    return matches.length === 1 ? matches[0] : null;
  }
  function search(data, input, limit = 12) {
    const key = normalize(input);
    if (!key) return [];
    const exact = resolve(data, input);
    return (exact ? [exact] : data.shades.filter(shade => normalize(shade.name).includes(key) || normalize(shade.code).startsWith(key))).slice(0, limit);
  }
  function applyPaint(model, target, shade) {
    if (!['wall', 'exterior'].includes(target)) throw new Error('Choose interior or exterior walls.');
    const finish = G.validateFinish({ pattern: 'solid', color: shade.color, accent: shade.color, scale: 3, rotation: 0,
      paint: { brand: BRAND, name: shade.name, code: shade.code } });
    const property = target === 'wall' ? 'finish' : 'exteriorFinish';
    const paintFloor = plan => plan ? { ...plan, finishes: { ...plan.finishes, [target]: finish },
      walls: plan.walls.map(wall => { const next = { ...wall }; if (wall.kind === 'wall') delete next[property]; return next; }) } : null;
    const checked = G.validate(model);
    return G.validate(checked?.version === 2 ? { ...checked, floors: checked.floors.map(floor => ({ ...floor, plan: paintFloor(floor.plan) })) } : paintFloor(checked));
  }
  function loadCatalogue() {
    cataloguePromise ||= fetch('/asian-paints-shades.json?v=1', { signal: AbortSignal.timeout(8000) })
      .then(response => { if (!response.ok) throw new Error('The paint shade catalogue could not load.'); return response.json(); })
      .then(validateCatalogue).catch(error => { cataloguePromise = null; throw error; });
    return cataloguePromise;
  }
  function createControls(root, { getPlan, applyPlan, isReady, onStatus }) {
    const id = ++controlId;
    let data = null;
    root.classList.add('fp-paint');
    root.innerHTML = `<div class="fp-paint-heading"><h3>Paint by shade name</h3><p>Choose Asian Paints shades for this floor. Interior and exterior walls are painted separately.</p></div>
      <div class="fp-paint-fields">${[['wall', 'Interior'], ['exterior', 'Exterior']].map(([target, title]) => `<div class="fp-paint-field" data-paint="${target}">
        <label for="fp-paint-${id}-${target}">${title} paint name</label>
        <input id="fp-paint-${id}-${target}" type="text" maxlength="100" autocomplete="off" spellcheck="false" list="fp-paint-list-${id}-${target}" aria-describedby="fp-paint-match-${id}-${target}" placeholder="${target === 'wall' ? 'e.g. Buttercup or 0336' : 'e.g. Apricot or 0501'}">
        <datalist id="fp-paint-list-${id}-${target}"></datalist>
        <div class="fp-paint-match"><span class="fp-paint-swatch" aria-hidden="true"></span><span id="fp-paint-match-${id}-${target}" data-paint-match role="status"></span></div>
        <button type="button" class="btn btn-outline btn-small" data-paint-apply>Apply ${title.toLowerCase()} paint</button>
      </div>`).join('')}</div>
      <p class="fp-note" data-paint-catalogue role="status">Loading Asian Paints shades…</p><button type="button" class="btn btn-outline btn-small" data-paint-retry hidden>Retry shade catalogue</button>
      <p class="fp-note">Applying a shade paints all chosen wall faces on this floor, including individual wall finishes. Save the project to keep it. Screen colours are a preview; check a physical shade card for the final paint.</p>`;
    const rows = [...root.querySelectorAll('[data-paint]')].map(element => ({ element, target: element.dataset.paint,
      input: element.querySelector('input'), list: element.querySelector('datalist'), button: element.querySelector('button'),
      match: element.querySelector('[data-paint-match]'), swatch: element.querySelector('.fp-paint-swatch'), saved: undefined }));
    function preview(row) {
      const shade = data && resolve(data, row.input.value), current = getPlan()?.finishes?.[row.target];
      row.swatch.style.backgroundColor = shade?.color || current?.color || '#eeeeee';
      row.match.textContent = shade ? `${shade.name} · ${shade.code}` : row.input.value.trim() ? 'Choose a matching Asian Paints shade name or code.' : current?.paint ? label(current.paint) : 'Choose a shade to replace the current finish.';
      row.input.setAttribute('aria-invalid', String(!!data && !!row.input.value.trim() && !shade));
      row.button.disabled = !data || !isReady() || !shade;
      row.list.replaceChildren();
      if (data) for (const item of search(data, row.input.value)) row.list.append(new Option(label(item), item.name));
    }
    function sync() {
      for (const row of rows) {
        const finish = getPlan()?.finishes?.[row.target], saved = JSON.stringify(finish || null);
        if (saved !== row.saved) { row.saved = saved; row.input.value = finish?.paint ? label(finish.paint) : ''; }
        row.input.disabled = !data || !isReady(); preview(row);
      }
    }
    function apply(row) {
      if (!data || !isReady()) return;
      const shade = resolve(data, row.input.value);
      if (!shade) { preview(row); onStatus('Choose a matching Asian Paints shade before applying paint.', true); return; }
      try {
        applyPlan(applyPaint(getPlan(), row.target, shade));
        row.input.value = label(shade); preview(row);
        onStatus(`${row.target === 'wall' ? 'Interior' : 'Exterior'} walls updated to ${shade.name} (${shade.code}). Save the project to keep the paint.`);
      } catch (error) { onStatus(error.message, true); }
    }
    for (const row of rows) {
      row.input.oninput = () => preview(row);
      row.input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); apply(row); } };
      row.button.onclick = () => apply(row);
    }
    async function load() {
      root.querySelector('[data-paint-retry]').hidden = true;
      root.querySelector('[data-paint-catalogue]').textContent = 'Loading Asian Paints shades…';
      try {
        data = await loadCatalogue(); if (!root.isConnected) return;
        root.querySelector('[data-paint-catalogue]').textContent = `${data.shades.length.toLocaleString('en-IN')} Asian Paints shades. Type a name or shade code, then apply.`;
      } catch { if (root.isConnected) { root.querySelector('[data-paint-catalogue]').textContent = 'Shades could not load. Your existing finishes are kept. Retry to choose paint.'; root.querySelector('[data-paint-retry]').hidden = false; } }
      if (root.isConnected) sync();
    }
    root.querySelector('[data-paint-retry]').onclick = load;
    sync(); load();
    return { sync };
  }
  return { BRAND, validateCatalogue, resolve, search, applyPaint, createControls };
});
