(function () {
  'use strict';
  const G = window.FloorPlanGeometry;
  const singleFloorEditor = window.FloorPlanUI.createEditor;
  window.FloorPlanUI.createEditor = function (root, initial, options) {
    const checked = G.validate(initial);
    const blank = index => ({ name: G.floorName(index), plan: null, offsetX: 0, offsetZ: 0, slabThickness: .5 });
    let building = checked?.version === 2 ? checked : { version: 2, published: checked?.published || false, floors: checked ? G.floorsOf(checked).map(({ name, plan, offsetX, offsetZ, slabThickness }) => ({ name, plan, offsetX, offsetZ, slabThickness })) : [blank(0)] };
    let selected = 0, child = null, mounting = false, timer, designer = null, designing = false;
    root.classList.add('building-editor');
    root.innerHTML = `<div class="form-section"><h2>Optional 3D building</h2><p>How many floors does this property have? Include the ground floor. Upload one drawing per floor, then review the combined model.</p></div>
      <div class="building-floor-bar"><label>Number of floors <select data-floor-count aria-label="Number of floors">${Array.from({ length: G.MAX_FLOORS }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}</select></label><label>Edit floor <select data-edit-floor aria-label="Edit floor"></select></label></div>
      <p data-building-status role="status" aria-live="polite"></p>
      <div class="building-position form-grid"><label>Slab thickness (ft)<input data-position="slabThickness" type="number" min=".2" max="3" step=".1"></label><label>Left/right offset (ft)<input data-position="offsetX" type="number" min="-500" max="500" step=".1"></label><label>Front/back offset (ft)<input data-position="offsetZ" type="number" min="-500" max="500" step=".1"></label></div>
      <p class="fp-note">Ground floor stays at the bottom. Upper floors stack using the floor below’s wall height and their slab thickness. Drawings align at their centres; use offsets to align stairs and outside walls when plans have different margins.</p>
      <section class="fp-designer" data-building-designer hidden></section><div data-floor-host></div><section class="building-preview"><h3>Combined building preview</h3><p data-floor-summary></p><div data-building-viewer></div></section>
      <label class="building-publish"><input type="checkbox" data-building-published> Show this 3D building on this property’s page</label><p class="fp-note">Upload, check dimensions and review walls for every floor before publishing. Save the property to keep your changes. You can save an incomplete model as a draft.</p>`;
    const count = root.querySelector('[data-floor-count]'), selector = root.querySelector('[data-edit-floor]'), publish = root.querySelector('[data-building-published]');
    const status = root.querySelector('[data-building-status]');
    count.value = building.floors.length; publish.checked = building.published;
    const preview = window.FloorPlanUI.createViewer(root.querySelector('[data-building-viewer]'), building, 'Combined building preview', { editable: true });
    function report(error) { status.textContent = error?.message || ''; status.classList.toggle('error-message', !!error); }
    function showPreview() {
      if (!root.isConnected) return;
      preview.update(building);
      root.querySelector('[data-floor-summary]').textContent = G.floorsOf(building).map(f => `${f.name}: ${f.plan ? `${f.elevation.toFixed(1)} ft elevation` : 'drawing needed'}`).join(' · ');
    }
    function capture() {
      if (designing) throw new Error('Wait for the house design to finish before saving or changing floors.');
      if (child) building.floors[selected].plan = child.getValue();
      root.querySelectorAll('[data-position]').forEach(input => { building.floors[selected][input.dataset.position] = Number(input.value); });
      building = G.validate({ ...building, published: false });
    }
    function mount() {
      mounting = true; child = null;
      selector.replaceChildren(...building.floors.map((floor, i) => new Option(floor.name, String(i)))); selector.value = selected;
      const floor = building.floors[selected];
      const floorIndex = selected;
      root.querySelectorAll('[data-position]').forEach(input => { input.value = floor[input.dataset.position]; });
      const host = root.querySelector('[data-floor-host]'), panel = document.createElement('div'); host.replaceChildren(panel);
      child = singleFloorEditor(panel, floor.plan ? { ...floor.plan, published: false } : null, { ...options, hideDesigner: true, onChange(plan) {
        if (mounting) return;
        building.floors[floorIndex].plan = plan ? { ...plan, published: false } : null;
        designer?.sync();
        clearTimeout(timer); timer = setTimeout(showPreview, 180);
      } });
      // Publication belongs to the building; removal still applies to this floor.
      panel.querySelector('#fp-published').closest('label').hidden = true;
      panel.querySelector('.fp-publish p').hidden = true;
      panel.querySelector('#fp-upload').setAttribute('aria-label', `${floor.name} floor-plan drawing`);
      mounting = false; showPreview();
    }
    selector.onchange = () => {
      try { capture(); selected = Number(selector.value); mount(); report(); }
      catch (error) { selector.value = selected; report(error); }
    };
    count.onchange = () => {
      try {
        capture(); const next = Number(count.value);
        if (next < building.floors.length && building.floors.slice(next).some(f => f.plan) && !window.confirm('Remove the upper floors and their drawings from this draft? Save the property to confirm.')) { count.value = building.floors.length; return; }
        building.floors = Array.from({ length: next }, (_, i) => building.floors[i] || blank(i));
        selected = Math.min(selected, next - 1); mount(); report();
      } catch (error) { count.value = building.floors.length; report(error); }
    };
    root.querySelectorAll('[data-position]').forEach(input => input.onchange = () => { try { capture(); showPreview(); report(); } catch (error) { report(error); } });
    mount();
    if (window.FloorPlanDesign) {
      const designRoot = root.querySelector('[data-building-designer]'); designRoot.hidden = false;
      designer = window.FloorPlanDesign.createControls(designRoot, {
        getModel() { capture(); return building; }, peekModel: () => building,
        applyModel(next) { building = G.validate(next); count.value = building.floors.length; mount(); report(); },
        isReady: () => G.hasGeometry(building),
        onBusy(value) {
          designing = value; root.querySelector('[data-floor-host]').inert = value;
          root.querySelectorAll('[data-floor-count],[data-edit-floor],[data-position],[data-building-published]').forEach(control => { control.disabled = value; });
        }
      });
    }
    return { getValue() {
      capture();
      if (building.floors.length === 1 && !building.floors[0].plan && !publish.checked) return null;
      return G.validate({ ...building, published: publish.checked });
    } };
  };
})();
