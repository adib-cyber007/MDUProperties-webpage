(function () {
  'use strict';
  window.FloorPlanPresentation = {
    create(root, { getPlan, commit, place, say }) {
      root.className = 'fp-presentation-panel';
      root.innerHTML = `<h3>Architecture &amp; tour</h3><p class="fp-note">Add the details and room viewpoints buyers will see. Use the project drawings and agreed specifications.</p>
        <fieldset><legend>Architectural details</legend>
          <label class="fp-snap"><input type="checkbox" data-detail="skirting" checked> Skirting boards</label>
          <label class="fp-snap"><input type="checkbox" data-detail="trims" checked> Door trims, handles &amp; window sills</label>
          <div class="form-grid"><label>Roof <select data-detail="roof"><option value="none">No roof</option><option value="flat">Flat roof with parapet</option><option value="pitched">Pitched roof</option></select></label>
          <label>Default lighting <select data-detail="lighting"><option value="day">Daylight</option><option value="evening">Evening</option></select></label></div>
          <p class="fp-note">The roof uses a rectangular outline around the reviewed walls and appears on the top floor in full-wall view. Check its shape against the elevation drawing. Add stairs, railings, curtains and lights from Furniture. Stairs are display models; use the floor selector to change levels.</p>
          <button type="button" class="btn btn-outline btn-small" data-architecture-save>Apply architectural details</button>
        </fieldset>
        <fieldset><legend>Room viewpoints</legend><p class="fp-note">Choose a clear standing position and viewing direction. Dimensions and finish notes are entered by you.</p>
          <label>Saved viewpoint <select data-tour-selected><option value="-1">Add a viewpoint</option></select></label>
          <div class="form-grid"><label>Room name <input data-tour="name" maxlength="60" placeholder="Living room"></label>
          <label>Direction (°; 0 faces drawing top) <input data-tour="heading" type="number" min="-180" max="180" step="1" value="0"></label>
          <label>Position X (ft) <input data-tour="x" type="number" min="0" step=".1"></label><label>Position Y (ft) <input data-tour="y" type="number" min="0" step=".1"></label>
          <label>Room width (ft, optional) <input data-tour="width" type="number" min=".5" step=".1"></label><label>Room depth (ft, optional) <input data-tour="depth" type="number" min=".5" step=".1"></label></div>
          <label>Finishes &amp; features <textarea data-tour="notes" rows="3" maxlength="600" placeholder="Describe the flooring, fittings and features included in this room."></textarea></label>
          <div class="fp-tools"><button type="button" data-tour-place>Place viewpoint on drawing</button><button type="button" data-tour-save>Save viewpoint</button><button type="button" data-tour-remove>Remove viewpoint</button></div>
          <p class="fp-note">Save the project to keep these changes. Select a room button in the preview to check the view before publishing.</p>
        </fieldset>`;
      const field = key => root.querySelector(`[data-tour="${key}"]`), selector = root.querySelector('[data-tour-selected]');
      let selected = -1, loaded = null;
      // Drawing clicks and existing plans can contain fractional feet/degrees.
      root.querySelectorAll('input[type="number"]').forEach(input => { input.step = 'any'; });
      const settings = () => ({ skirting: true, trims: true, roof: 'none', lighting: 'day', views: [], ...getPlan()?.presentation });
      function fill() {
        const plan = getPlan(), view = settings().views[selected];
        for (const [key, value] of Object.entries({ name: view?.name || '', heading: view?.heading ?? 0,
          x: view ? +(view.center[0] * plan.width).toFixed(2) : plan ? +(plan.width / 2).toFixed(2) : '',
          y: view ? +(view.center[1] * plan.depth).toFixed(2) : plan ? +(plan.depth / 2).toFixed(2) : '', width: view?.width ?? '', depth: view?.depth ?? '', notes: view?.notes || '' })) field(key).value = value;
      }
      function sync() {
        const plan = getPlan(), p = settings();
        root.querySelectorAll('[data-detail]').forEach(input => { if (input.type === 'checkbox') input.checked = p[input.dataset.detail]; else input.value = p[input.dataset.detail]; });
        if (selected >= p.views.length) selected = -1;
        selector.replaceChildren(new Option('Add a viewpoint', '-1'), ...p.views.map((view, index) => new Option(view.name, String(index)))); selector.value = String(selected);
        root.querySelectorAll('input, select, textarea, button').forEach(input => { input.disabled = !plan; });
        root.querySelector('[data-tour-remove]').disabled = !plan || selected < 0;
        if (plan !== loaded) { loaded = plan; fill(); }
      }
      selector.onchange = () => { selected = Number(selector.value); fill(); root.querySelector('[data-tour-remove]').disabled = selected < 0; };
      root.querySelector('[data-architecture-save]').onclick = () => {
        if (!getPlan()) return;
        const p = settings(); root.querySelectorAll('[data-detail]').forEach(input => { p[input.dataset.detail] = input.type === 'checkbox' ? input.checked : input.value; });
        try { commit({ ...getPlan(), presentation: p }); say('Architectural details applied. Save the project to keep them.'); } catch (error) { say(error.message, true); }
      };
      root.querySelector('[data-tour-place]').onclick = () => place();
      root.querySelector('[data-tour-save]').onclick = () => {
        const plan = getPlan(); if (!plan) return;
        const view = { name: field('name').value, center: [Number(field('x').value) / plan.width, Number(field('y').value) / plan.depth], heading: Number(field('heading').value), notes: field('notes').value };
        for (const key of ['width', 'depth']) if (field(key).value !== '') view[key] = Number(field(key).value);
        const p = settings(); p.views = p.views.slice(); const nextIndex = selected < 0 ? p.views.length : selected; p.views[nextIndex] = view;
        try { window.FloorPlanGeometry.validate({ ...plan, presentation: p }); selected = nextIndex; commit({ ...plan, presentation: p }); say('Viewpoint saved in this draft. Choose its room button in 3D to check the position.'); } catch (error) { say(error.message, true); }
      };
      root.querySelector('[data-tour-remove]').onclick = () => { const p = settings(); p.views = p.views.filter((_, i) => i !== selected); selected = -1; commit({ ...getPlan(), presentation: p }); say('Viewpoint removed. Save the project to keep this change.'); };
      return { sync, setCenter(point) { const plan = getPlan(); field('x').value = +(point[0] * plan.width).toFixed(2); field('y').value = +(point[1] * plan.depth).toFixed(2); say('Position selected. Enter a room name and direction, then save the viewpoint.'); } };
    }
  };
})();
