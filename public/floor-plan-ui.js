(function () {
  'use strict';
  const G = window.FloorPlanGeometry;
  const F = window.FloorPlanFinishes;
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const active = new Map();
  function register(root, cleanup) { active.set(root, cleanup); }
  function prune() {
    for (const [root, cleanup] of active) if (!root.isConnected) { cleanup(); active.delete(root); }
  }
  new MutationObserver(prune).observe(document.body, { childList: true, subtree: true });

  let rendererPromise;
  function loadRenderer() {
    if (window.FloorPlanRenderer) return Promise.resolve();
    if (!rendererPromise) rendererPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = '/floor-plan-renderer.js?v=13';
      script.onload = resolve;
      script.onerror = () => { script.remove(); rendererPromise = null; reject(new Error('The 3D viewer could not load. Check your connection and choose Retry.')); };
      document.head.append(script);
    });
    return rendererPromise;
  }
  // Adapted from FLRplanner/src/recognizeDrawing.ts. Keep crisp drawing ink as
  // PNG when it fits; photo compression can erase small opening symbols.
  async function readDrawing(file) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) throw new Error('Choose a PNG, JPEG or WebP under 10 MB. Export a PDF page as an image first.');
    const bitmap = await createImageBitmap(file);
    try {
      if (Math.min(bitmap.width, bitmap.height) < 40 || bitmap.width * bitmap.height > 16000000) throw new Error('Choose a clear drawing between 40 pixels and 16 megapixels.');
      const factor = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * factor); canvas.height = Math.round(bitmap.height * factor);
      const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      let data = canvas.toDataURL('image/png');
      if (data.length > 2400000) data = canvas.toDataURL('image/jpeg', .9);
      if (data.length > 2400000) data = canvas.toDataURL('image/jpeg', .7);
      if (data.length > 2400000) throw new Error('This compressed drawing is too large. Crop to one floor.');
      return data;
    } finally { bitmap.close(); }
  }
  function createViewer(root, initial, title = '3D floor-plan layout', { editable = false, onSelectFurniture } = {}) {
    root.classList.add('fp-viewer');
    root.innerHTML = `<div class="fp-view-canvas"><canvas tabindex="0" aria-label="3D floor-plan layout"></canvas><p class="fp-view-notice" role="status">Upload a drawing and review detected walls to build the preview.</p>
      <div class="fp-walk-controls" role="group" aria-label="Walkthrough movement" hidden>
        <button type="button" data-walk="w" aria-label="Walk forward">↑</button>
        <button type="button" data-walk="a" aria-label="Walk left">←</button>
        <button type="button" data-walk="s" aria-label="Walk backward">↓</button>
        <button type="button" data-walk="d" aria-label="Walk right">→</button>
      </div></div>
      <div class="fp-view-controls" role="group" aria-label="3D view controls">
        <button type="button" class="btn btn-outline btn-small" data-view="walk" aria-pressed="false">Walk through</button>
        <label class="fp-floor-view" hidden>View <select aria-label="View floor"></select></label>
        <button type="button" class="btn btn-outline btn-small" data-view="left" aria-label="Rotate left">↶</button><button type="button" class="btn btn-outline btn-small" data-view="right" aria-label="Rotate right">↷</button>
        <button type="button" class="btn btn-outline btn-small" data-view="in" aria-label="Zoom in">+</button><button type="button" class="btn btn-outline btn-small" data-view="out" aria-label="Zoom out">−</button>
        <button type="button" class="btn btn-outline btn-small" data-view="top">Top view</button><button type="button" class="btn btn-outline btn-small" data-view="reset">Reset view</button>
        <button type="button" class="btn btn-outline btn-small" data-view="expand" aria-pressed="false">Expand 3D view</button>
        <button type="button" class="btn btn-outline btn-small" data-view="walls" aria-pressed="false">Show full walls</button>
        <button type="button" class="btn btn-outline btn-small" data-view="ceiling" aria-pressed="false">Show ceiling</button>
        <button type="button" class="btn btn-outline btn-small" data-view="ceiling-view">Ceiling view</button>
        <button type="button" class="btn btn-outline btn-small" data-view="png">Save image</button>
        ${editable ? '<button type="button" class="btn btn-outline btn-small" data-view="glb">Download detailed 3D (.glb)</button>' : ''}
        <label class="fp-quality">Rendering <select aria-label="3D rendering quality"><option value="auto">Auto</option><option value="high">High quality</option><option value="fast">Fast</option></select></label>
        <button type="button" class="btn btn-outline btn-small" data-view="retry" hidden>Retry</button>
      </div><p class="fp-view-help">Drag to orbit · Scroll or pinch to zoom · Right-drag or two-finger drag to pan. Arrow keys rotate; Home resets. Ceiling view looks upward from inside; Reset view returns to the overview. ${editable ? 'Click furniture in 3D to select it.' : ''}</p>`;
    const canvas = root.querySelector('canvas'), notice = root.querySelector('.fp-view-notice');
    canvas.setAttribute('aria-label', `${title}. Drag to rotate, scroll to zoom, right-drag to pan. Arrow keys rotate and Home resets.`);
    let plan = initial, renderer = null, loading = false, disposed = false;
    const retry = root.querySelector('[data-view="retry"]');
    function expand(value) {
      root.classList.toggle('fp-view-expanded', value);
      document.body.classList.toggle('fp-preview-open', !!document.querySelector('.fp-view-expanded'));
      const button = root.querySelector('[data-view="expand"]');
      button.textContent = value ? 'Close large view' : 'Expand 3D view'; button.setAttribute('aria-pressed', String(value));
    }
    function escape(event) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (renderer?.getViewState().walking && root.contains(document.activeElement)) { event.preventDefault(); renderer.action('walk'); root.querySelector('[data-view="walk"]').focus(); }
      else if (root.classList.contains('fp-view-expanded')) { expand(false); root.querySelector('[data-view="expand"]').focus(); }
    }
    document.addEventListener('keydown', escape);
    function controlsEnabled(enabled) { root.querySelectorAll('[data-view]:not([data-view="retry"]), [data-walk], select').forEach(control => { control.disabled = !enabled; }); }
    function error(message) { notice.hidden = false; notice.textContent = message; }
    function viewChanged(state = renderer?.getViewState()) {
      if (!state) return;
      const walking = state.walking;
      root.classList.toggle('fp-walking', walking);
      root.querySelector('.fp-walk-controls').hidden = !walking;
      const button = root.querySelector('[data-view="walk"]');
      button.textContent = walking ? 'Exit walkthrough' : 'Walk through'; button.setAttribute('aria-pressed', String(walking));
      root.querySelector('[data-view="reset"]').textContent = walking ? 'Restart walkthrough' : 'Reset view';
      root.querySelector('.fp-floor-view select').value = state.visibleFloor;
      for (const name of ['left', 'right', 'in', 'out', 'walls', 'ceiling', 'ceiling-view']) root.querySelector(`[data-view="${name}"]`).disabled = walking;
      for (const [name, value, on, off] of [['walls', state.fullWalls, 'Show cutaway walls', 'Show full walls'], ['ceiling', state.showCeiling, 'Hide ceiling', 'Show ceiling']]) {
        const control = root.querySelector(`[data-view="${name}"]`); control.setAttribute('aria-pressed', String(value)); control.textContent = value ? on : off;
      }
      const help = walking
        ? 'Drag to look. Hold W A S D, arrow keys or the on-screen arrows to move through doors. Home restarts; Escape exits. Choose a floor to explore its rooms.'
        : `Drag to orbit · Scroll or pinch to zoom · Right-drag or two-finger drag to pan. Arrow keys rotate; Home resets. Choose Walk through to explore rooms at eye level. ${editable ? 'Click furniture in 3D to select it.' : ''}`;
      root.querySelector('.fp-view-help').textContent = help;
      canvas.setAttribute('aria-label', `${title}. ${help}`);
    }
    async function sync() {
      if (disposed) return;
      const ready = G.hasGeometry(plan);
      const floorControl = root.querySelector('.fp-floor-view'), floorSelect = floorControl.querySelector('select');
      const selectedFloor = floorSelect.value;
      floorControl.hidden = plan?.version !== 2;
      floorSelect.replaceChildren(new Option('All floors', 'all'));
      G.floorsOf(plan).forEach(floor => floorSelect.add(new Option(floor.name, String(floor.index))));
      floorSelect.value = [...floorSelect.options].some(o => o.value === selectedFloor) ? selectedFloor : 'all';
      controlsEnabled(ready && !!renderer);
      if (!ready) { renderer?.update(plan); controlsEnabled(false); notice.hidden = false; notice.textContent = 'Upload a drawing and review detected walls to build the preview.'; return; }
      if (renderer) { notice.hidden = true; renderer.update(plan); renderer.setFloor(floorSelect.value); viewChanged(); return; }
      if (loading) return;
      loading = true; retry.hidden = true; error('Preparing the 3D view…');
      try {
        await loadRenderer();
        if (disposed) return;
        renderer = window.FloorPlanRenderer(canvas, { onSelectFurniture, onError: error, onRestore: () => { notice.hidden = true; }, onViewChange: viewChanged });
        canvas.dataset.engine = 'three';
        renderer.update(plan); renderer.setFloor(floorSelect.value); notice.hidden = G.hasGeometry(plan); controlsEnabled(G.hasGeometry(plan)); viewChanged();
      } catch (failure) { error(failure.message || '3D needs WebGL 2. Enable hardware acceleration and reload the page.'); retry.hidden = false; }
      finally { loading = false; }
    }
    async function download(type) {
      try {
        const data = type === 'png' ? await renderer.exportPNG() : new Blob([await renderer.exportGLB()], { type: 'model/gltf-binary' });
        const url = URL.createObjectURL(data), link = document.createElement('a'); link.href = url; link.download = `floor-plan.${type}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (failure) { error(failure.message); }
    }
    function viewAction(action) {
      if (action === 'retry') { sync(); return; }
      if (!renderer) return;
      if (action === 'expand') { expand(!root.classList.contains('fp-view-expanded')); return; }
      if (action === 'png' || action === 'glb') { download(action); return; }
      notice.hidden = true; renderer.action(action); viewChanged();
    }
    root.querySelectorAll('[data-view]').forEach(button => button.onclick = () => viewAction(button.dataset.view));
    root.querySelector('.fp-quality select').onchange = event => renderer?.setQuality(event.target.value);
    root.querySelector('.fp-floor-view select').onchange = event => { notice.hidden = true; renderer?.setFloor(event.target.value); if (renderer?.getViewState().walking) canvas.focus({ preventScroll: true }); };
    root.querySelectorAll('[data-walk]').forEach(button => {
      const release = () => { button.classList.remove('fp-walk-held'); renderer?.move(button.dataset.walk, false); };
      button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); button.classList.add('fp-walk-held'); renderer?.move(button.dataset.walk, true); });
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, release);
      button.addEventListener('keydown', event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); renderer?.move(button.dataset.walk, true); } });
      button.addEventListener('keyup', release); button.addEventListener('blur', release);
    });
    canvas.addEventListener('blur', () => root.querySelectorAll('.fp-walk-held').forEach(button => button.classList.remove('fp-walk-held')));
    register(root, () => { disposed = true; expand(false); document.removeEventListener('keydown', escape); renderer?.dispose(); });
    sync();
    return { update(next) { plan = next; sync(); }, action: viewAction, getStats() { return renderer?.getStats(); } };
  }

  function createEditor(root, initial, { compressImage, onChange, hideDesigner = false }) {
    let plan = initial ? G.validate(initial) : null;
    let pending = null, cursor = null, selected = -1, selectedFurniture = -1, tool = 'wall', history = [], uploading = false, image = null, suggestions = [];
    let uploadVersion = 0, autoOnLoad = false, editRevision = 0, analysis = null, useLargeInitialScale = false;
    let designer = null, designing = false;
    let recognitionReady = false;
    let scanSavedOpenings = !!initial && (initial.openingDetectionVersion || 0) < 4;
    root.innerHTML = `<div class="form-section"><h2>Floor plan to 3D</h2><p>Upload a clear floor-plan drawing to generate a first 3D layout automatically. Review the detected walls, dimensions and openings before publishing.</p></div>
      <div class="field"><label for="fp-upload">Floor-plan drawing</label><input id="fp-upload" type="file" accept="image/png,image/jpeg,image/webp,application/json,.json"><small>PNG, JPG or WebP, or a layout JSON exported from this editor. Crop drawings tightly first. For a PDF, export its page as an image. Replacing a drawing starts a new tracing; JSON restores a reviewed tracing.</small></div>
      <p class="fp-status" role="status" aria-live="polite"></p>
      <div class="fp-recognition-pipeline"><p>Upload drawing → Recognize walls, doors, windows and furniture → Review → Set building size → Export 3D</p><small data-recognition-status>Checking floor plan recognition…</small></div>
      <div class="field"><label for="fp-recognition-method">Recognition method</label><select id="fp-recognition-method"><option value="auto">Automatic — FLRplanner or solid coloured walls</option><option value="standard">FLRplanner — original recognition</option><option value="colored">Coloured walls — straight filled wall strips</option></select><small>Automatic keeps the original method unless it finds a strong network of solid coloured walls. Change the method, then detect again. Coloured-wall recognition currently supports horizontal and vertical wall strips.</small></div>
      <label class="fp-snap"><input type="checkbox" data-vision-enabled disabled> Ask the local vision model to review suspicious walls</label><small class="fp-note" data-vision-status>Checking local vision review…</small>
      <section class="fp-designer" data-fp-designer hidden></section>
      <div class="fp-workspace" hidden>
        <section class="fp-building-size" aria-labelledby="fp-size-title"><h3 id="fp-size-title">Building size</h3><p class="fp-note">Set the building's outside width and depth, excluding drawing margins. New uploads start with a provisional 60 ft long side. Use actual dimensions or a printed measurement before publishing.</p>
          <div class="fp-size-fields"><div class="field"><label for="fp-building-width">Building width (ft)</label><input id="fp-building-width" type="number" min="4" max="500" step=".01"></div><div class="field"><label for="fp-building-depth">Building depth (ft)</label><input id="fp-building-depth" type="number" min="4" max="500" step=".01"></div></div>
          <label class="fp-scale-check"><input id="fp-size-proportions" type="checkbox" checked> Keep drawing proportions</label><div class="fp-tools"><button type="button" data-action="building-size">Apply building size</button><button type="button" data-action="large-scale">Use 60 ft layout</button></div><p class="fp-note" data-building-size-note></p>
        </section>
        <div class="fp-dimensions form-grid">
          <div class="field"><label for="fp-width">Full drawing width (ft)</label><input id="fp-width" type="number" min="4" max="500" step="any" required></div>
          <div class="field"><label for="fp-depth">Full drawing depth (ft)</label><input id="fp-depth" type="number" min="4" max="500" step="any" required></div>
          <div class="field"><label for="fp-height">Wall height (ft)</label><input id="fp-height" type="number" min="7" max="25" step=".1" required></div>
          <div class="field"><label for="fp-thickness">Wall thickness (ft)</label><input id="fp-thickness" type="number" min=".2" max="2" step=".01" required></div>
        </div>
        <section class="fp-finishes" aria-labelledby="fp-finishes-title"><div class="fp-finish-heading"><div><h3 id="fp-finishes-title">Walls, floors &amp; ceiling</h3><p class="fp-note">Choose a finish, mix your own colors, or upload a wallpaper or flooring sample. Select a wall on the drawing to give it its own finish.</p></div><span class="fp-library-count">${F.COLORS.length} colors / ${Object.values(F.PRESETS).flat().length} finishes</span></div>
          <div class="fp-wall-sides"><div class="field"><label for="fp-wall-outside">Selected wall: inside / outside</label><select id="fp-wall-outside"><option value="auto">Automatic from layout</option><option value="none">Interior partition (both faces inside)</option><option value="left">Exterior: outside on marked Side 1</option><option value="right">Exterior: outside on opposite Side 2</option><option value="both">Both faces outdoors</option></select></div><p class="fp-note" data-wall-sides-note></p></div>
          <div class="fp-finish-fields"><div class="field"><label for="fp-finish-target">Apply finish to</label><select id="fp-finish-target"><option value="wall">Inside wall faces on this floor</option><option value="exterior">Outside wall faces on this floor</option><option value="selected-wall">Selected wall: inside face(s)</option><option value="selected-exterior">Selected wall: outside face(s)</option><option value="floor">Flooring on this floor</option><option value="ceiling">Ceiling on this floor</option></select></div><div class="field"><label for="fp-finish-color">Base color or image tint</label><div class="fp-color-input"><input id="fp-finish-color" type="color" aria-label="Choose any surface color"><input id="fp-finish-hex" type="text" maxlength="7" spellcheck="false" placeholder="#EEE8DE" aria-label="Custom surface hex color"></div></div><div class="field"><label for="fp-finish-accent">Pattern / grout color</label><input id="fp-finish-accent" type="color"></div><div class="field"><label for="fp-finish-scale">Sample repeat size (ft)</label><input id="fp-finish-scale" type="number" min=".25" max="20" step=".25"></div><div class="field"><label for="fp-finish-rotation">Pattern direction (degrees)</label><input id="fp-finish-rotation" type="number" min="-180" max="180" step="15"></div></div>
          <div class="fp-finish-locks" role="group" aria-label="Protect finishes from Surprise me"><label><input type="checkbox" data-finish-lock="wall"> Lock all walls on this floor (inside &amp; outside)</label><label><input type="checkbox" data-finish-lock="exterior"> Lock exterior on this floor</label><label><input type="checkbox" data-finish-lock="floor"> Lock flooring on this floor</label><label><input type="checkbox" data-finish-lock="ceiling"> Lock ceiling on this floor</label><label><input type="checkbox" data-finish-lock="selected-wall"> <span data-selected-lock-label>Lock selected wall</span></label></div><p class="fp-note" data-finish-lock-note>Locks protect designs from Surprise me. A selected wall lock keeps both its inside and outside finishes. You can still edit locked finishes manually.</p>
          <p class="fp-note" data-finish-description></p><div class="fp-color-palette" role="group" aria-label="Surface color library"></div>
          <div class="fp-finish-library" role="group" aria-label="Surface finish library"></div>
          <div class="fp-finish-upload"><div class="field"><label for="fp-finish-upload">Your wallpaper, flooring or ceiling texture</label><input id="fp-finish-upload" type="file" accept="image/png,image/jpeg,image/webp"><small>Upload a clear material sample. A seamless image repeats best. The preview keeps its proportions; adjust repeat size and direction above.</small></div><button type="button" class="btn btn-outline btn-small" data-action="reset-finish">Reset this finish</button></div>
          <p class="fp-note">The ceiling is a flat finish preview at the wall height. Use Ceiling view to inspect it. Save the project to keep your finishes.</p>
        </section>
        <p class="fp-note">Width and depth must describe the entire cropped image. Doorways are 6.8 ft high; windows run from 3 to 6.5 ft. These opening heights are illustrative.</p><label class="fp-scale-check"><input type="checkbox" id="fp-scale-confirmed"> I checked the drawing width and depth against the plan</label>
        <div class="fp-calibration"><div class="field"><label for="fp-reference">Known distance between two points (ft)</label><input id="fp-reference" type="number" min=".1" max="500" step=".01" value="10"><small>Enter a measured distance, choose Set scale, then click its two endpoints on the drawing. This preserves the image proportions, including margins. Use only a flat, undistorted drawing.</small></div><button class="btn btn-outline btn-small" type="button" data-tool="scale" aria-pressed="false">Set scale from measurement</button></div>
        <div class="fp-panels">
          <div class="fp-tracing-panel"><h3>Detected floor-plan walls</h3><div class="fp-tools"><button class="btn btn-outline btn-small" type="button" data-action="detect">Detect walls again</button><button class="btn btn-outline btn-small" type="button" data-action="detect-openings">Find doors &amp; windows</button></div><div class="fp-tools" role="group" aria-label="Tracing tools"><button type="button" data-tool="wall" aria-pressed="true">Wall</button><button type="button" data-tool="door" aria-pressed="false">Doorway</button><button type="button" data-tool="window" aria-pressed="false">Window</button><button type="button" data-tool="select" aria-pressed="false">Select</button></div>
            <p class="fp-trace-help">Blue lines are proposed walls, brown dashes are doors, and teal lines are windows. Check them against the drawing; select to edit or delete a mistake. Find doors &amp; windows adds candidates without replacing existing wall edits. Add missed walls or openings by tapping their endpoints. Openings should follow the wall centreline. Amber shapes are saved furniture.</p>
            <div data-room-review hidden><label class="fp-snap"><input type="checkbox" data-room-overlay checked> Show predicted rooms</label><p class="fp-note" data-room-summary></p><p class="fp-note">Room outlines are recognition suggestions. Review them against the drawing; manual wall edits do not update these outlines.</p></div>
            <div class="fp-wall-review" data-wall-review hidden><p class="fp-note" data-wall-summary></p><label class="fp-snap"><input type="checkbox" data-annotation-overlay> Show ignored measurements and text</label><label class="fp-snap"><input type="checkbox" data-candidate-overlay checked> Show uncertain walls</label><p class="fp-note">Purple dashed lines need review and stay out of the 3D model. Check each against the drawing before adding it.</p><div class="fp-wall-candidates" data-wall-candidates></div></div>
            <div class="fp-wall-review" data-vision-review hidden><p class="fp-note" data-vision-summary></p><label class="fp-snap"><input type="checkbox" data-vision-overlay checked> Highlight walls flagged by vision review</label><p class="fp-note">Flagged walls remain in 3D until you remove them. Compare the crop and geometry with the drawing. Model judgments and scores have not been calibrated on your plans. Undo restores a removal.</p><div data-vision-items></div></div>
            <canvas class="fp-trace-canvas" tabindex="0" aria-label="Floor-plan tracing. Click two endpoints to add a segment. Use the coordinate fields below as a keyboard alternative."></canvas>
            <div class="fp-tools"><label class="fp-snap"><input type="checkbox" data-snap checked> Snap straight</label><button type="button" data-action="cancel">Cancel point</button><button type="button" data-action="undo">Undo</button><button type="button" data-action="delete">Delete selected</button></div>
            <details class="fp-coordinates"><summary>Add or edit a segment with coordinates</summary><p>Feet from the image’s top-left corner. Selecting a segment fills these values.</p><div class="fp-coordinate-grid">${['Start X', 'Start Y', 'End X', 'End Y'].map((label, i) => `<div class="field"><label for="fp-coord-${i}">${label} (ft)</label><input id="fp-coord-${i}" type="number" min="0" step=".01" value="0"></div>`).join('')}</div><div class="field"><label for="fp-kind">Segment type</label><select id="fp-kind"><option value="wall">Wall</option><option value="door">Doorway</option><option value="window">Window</option></select></div><div class="fp-tools"><button type="button" data-action="add">Add segment</button><button type="button" data-action="update">Update selected</button></div></details>
            <label class="fp-segment-label" for="fp-segments">Saved segments</label><select id="fp-segments" aria-label="Select a traced segment"><option value="-1">No segment selected</option></select>
          </div>
          <div class="fp-preview-panel"><h3>3D preview</h3><div data-fp-viewer></div><p class="fp-note" data-fp-footprint></p><p class="fp-note">A layout model of this floor. Added furniture and fixtures use illustrative shapes; finishes and roof are not inferred.</p><button class="btn btn-outline btn-small" type="button" data-action="export">Download 3D model (.obj)</button><button class="btn btn-outline btn-small" type="button" data-action="export-json">Download layout (.json)</button></div>
        </div>
        <section class="fp-furniture-section" aria-labelledby="fp-furniture-title"><div class="fp-furniture-heading"><div><h3 id="fp-furniture-title">Furniture and fixtures</h3><p class="fp-note">Find possible objects in the drawing, review each suggestion, or place your own. Saved items appear in the 3D view.</p></div><button class="btn btn-outline btn-small" type="button" data-action="find-furniture">Find items in drawing</button></div>
          <div class="fp-suggestions" aria-live="polite"></div>
          <div class="fp-tools"><div class="field"><label for="fp-place-type">Item to place</label><select id="fp-place-type">${Object.entries(G.FURNITURE).map(([key,value]) => `<option value="${key}">${value.label}</option>`).join('')}</select></div><button class="btn btn-outline btn-small" type="button" data-tool="furniture" aria-pressed="false">Place item on drawing</button></div>
          <div class="fp-furniture-form"><div class="field"><label for="fp-items">Saved items</label><select id="fp-items"><option value="-1">No item selected</option></select></div><div class="fp-item-fields form-grid"><div class="field"><label for="fp-item-type">Type</label><select id="fp-item-type">${Object.entries(G.FURNITURE).map(([key,value]) => `<option value="${key}">${value.label}</option>`).join('')}</select></div><div class="field"><label for="fp-item-x">Centre X (ft)</label><input id="fp-item-x" type="number" step=".01" min="0"></div><div class="field"><label for="fp-item-y">Centre Y (ft)</label><input id="fp-item-y" type="number" step=".01" min="0"></div><div class="field"><label for="fp-item-width">Width (ft)</label><input id="fp-item-width" type="number" step=".01" min=".5" max="15"></div><div class="field"><label for="fp-item-depth">Depth (ft)</label><input id="fp-item-depth" type="number" step=".01" min=".5" max="15"></div><div class="field"><label for="fp-item-rotation">Rotation (degrees)</label><input id="fp-item-rotation" type="number" step="1" min="-180" max="180"></div></div><div class="fp-tools"><button type="button" data-action="update-furniture">Update selected item</button><button type="button" data-action="delete-furniture">Remove selected item</button></div></div>
        </section>
        <div class="fp-publish"><label><input type="checkbox" id="fp-published"> Show this 3D layout on the project page</label><p>Save the project to keep your drawing and tracing. Leave this unchecked to save your work as a draft.</p><button class="btn btn-outline btn-small" type="button" data-action="remove">Remove floor plan</button></div>
      </div>`;
    const workspace = root.querySelector('.fp-workspace'), status = root.querySelector('.fp-status');
    const canvas = root.querySelector('.fp-trace-canvas'), ctx = canvas.getContext('2d');
    const viewer = createViewer(root.querySelector('[data-fp-viewer]'), plan, '3D floor-plan preview', { editable: true, onSelectFurniture(index) { selectedFurniture = index; selected = -1; refresh(); } });
    const say = (message, error = false) => { status.textContent = message; status.classList.toggle('error-message', error); };
    const recognitionStatus = fetch('/api/admin/floor-plan-recognition', { signal: AbortSignal.timeout(3500) })
      .then(async response => { if (!response.ok) return; const state = await response.json(); recognitionReady = state.ready === true; root.dataset.recognitionEngine=state.engine;
        root.dataset.visionConfigured=String(state.visionReview?.enabled===true);
        root.querySelector('[data-vision-enabled]').disabled=state.visionReview?.enabled!==true;
        root.querySelector('[data-vision-status]').textContent=state.visionReview?.enabled===true?'Local vision review is configured. Enable it, then detect walls again.':'Local vision review is not configured. Wall recognition is available independently.'; })
      .catch(() => {})
      .finally(() => {
        if (!root.isConnected) return;
        if(root.dataset.visionConfigured===undefined)root.querySelector('[data-vision-status]').textContent='Local vision review is unavailable.';
        root.querySelector('[data-recognition-status]').textContent = recognitionReady
          ? `Pretrained recognition is ready. ${root.dataset.recognitionEngine==='mitunet'?'MitUNet walls are combined with FLRplanner door, window and furniture detection.':'FLRplanner detection is available for walls, doors, windows and furniture.'}`
          : 'Recognition service is unavailable. Start the floor plan service, then upload or choose Detect walls again. Your saved tracing stays available for manual editing.';
      });
    const pushHistory = () => { ++editRevision; history.push({ ...plan, walls: JSON.parse(JSON.stringify(plan.walls)), furniture: JSON.parse(JSON.stringify(plan.furniture || [])) }); if (history.length > 50) history.shift(); };
    const finishTarget = root.querySelector('#fp-finish-target');
    let libraryTarget = '', finishUploading = false;
    const finishKey=target=>target==='selected-wall'?'wall':target==='selected-exterior'?'exterior':target;
    const individualTarget=target=>target.startsWith('selected-');
    function currentFinish() {
      const target=finishTarget.value,key=finishKey(target),property=key==='exterior'?'exteriorFinish':'finish';
      return individualTarget(target)&&plan?.walls[selected]?.[property] ? plan.walls[selected][property] : plan?.finishes?.[key] || F.DEFAULTS[key];
    }
    function canFinish() { return !!plan && (!individualTarget(finishTarget.value) || plan.walls[selected]?.kind === 'wall'); }
    function applyFinish(value) {
      if (!canFinish()) return say('Select a wall on the drawing or in Saved segments first.', true);
      try {
        const finish=G.validateFinish(value),target=finishTarget.value,property=finishKey(target)==='exterior'?'exteriorFinish':'finish';
        const stored=individualTarget(target)?plan.walls[selected][property]:plan.finishes?.[target];
        if (stored && JSON.stringify(stored) === JSON.stringify(finish)) { syncFinishControls(); return; }
        const next=individualTarget(target)?{...plan,walls:plan.walls.map((wall,i)=>i===selected?{...wall,[property]:finish}:wall)}:{...plan,finishes:{...plan.finishes,[target]:finish}};
        G.validate(next); pushHistory(); plan = next; refresh();
        if (target === 'ceiling') viewer.action('ceiling-view');
        say('Finish updated in the preview. Save the project to keep it.');
      } catch(error) { say(error.message, true); syncFinishControls(); }
    }
    function syncFinishControls() {
      const target=finishTarget.value,key=finishKey(target),finish=currentFinish(),enabled=canFinish()&&!finishUploading&&!analysis&&!designing;
      for (const [id,value] of [['color',finish.color],['hex',finish.color.toUpperCase()],['accent',finish.accent],['scale',finish.scale],['rotation',finish.rotation]]) {
        const input = root.querySelector(`#fp-finish-${id}`); input.value = value; input.disabled = !enabled;
      }
      root.querySelector('#fp-finish-upload').disabled = !enabled;
      root.querySelector('[data-action="reset-finish"]').disabled = !enabled;
      const locksEnabled = !!plan && !finishUploading && !analysis && !designing;
      for (const control of root.querySelectorAll('[data-finish-lock]')) {
        const key=control.dataset.finishLock, individual=key==='selected-wall';
        control.checked=individual ? plan?.walls[selected]?.finishLocked===true : plan?.finishLocks?.[key]===true;
        control.disabled=!locksEnabled||(individual&&plan.walls[selected]?.kind!=='wall');
      }
      root.querySelector('[data-selected-lock-label]').textContent=plan?.walls[selected]?.kind==='wall'?`Lock selected wall (${selected+1})`:'Lock selected wall';
      const sides=G.wallSurfaces(plan),sideControl=root.querySelector('#fp-wall-outside');
      sideControl.disabled=!locksEnabled||plan?.walls[selected]?.kind!=='wall';sideControl.value=plan?.walls[selected]?.outside||'auto';
      const uncertain=sides.filter((s,i)=>plan.walls[i].kind==='wall'&&s.uncertain).length,selectedSide=sides[selected];
      root.querySelector('[data-wall-sides-note]').textContent=(selectedSide&&plan.walls[selected]?.kind==='wall'?`Selected wall: ${selectedSide.outside==='none'?'both faces inside':selectedSide.outside==='both'?'both faces exposed':`outside on Side ${selectedSide.outside==='left'?'1':'2'}`}${selectedSide.source==='manual'?' (your setting)':' (automatic)'}. `:'Select a wall to review its outside direction. ')+(uncertain?`${uncertain} wall(s) need review because the layout is open. Exposed faces use the exterior finish until corrected.`:'Inside and outside faces use separate finishes. Review courtyards and incomplete boundaries manually.');
      root.querySelector('[data-finish-description]').textContent = !enabled && !finishUploading ? 'Choose a wall in Saved segments or click one with Select, then apply its finish.' : finish.pattern === 'custom' ? 'Your uploaded image is repeated across the chosen faces. White tint keeps its original colors.' : `${finish.pattern.charAt(0).toUpperCase()+finish.pattern.slice(1)} finish. ${key==='wall'?'Applied only to inside faces. Outside faces keep their exterior finish.':key==='exterior'?'Applied only to exposed outside faces. Inside paint and wallpaper stay separate.':'Changes appear immediately in the 3D preview.'}`;
      const library = root.querySelector('.fp-finish-library');
      if (key !== libraryTarget) {
        libraryTarget = key; library.replaceChildren();
        F.PRESETS[key].forEach(preset => {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'fp-finish-sample'; button.setAttribute('aria-label',preset.name);
          const sample = document.createElement('img'); sample.src = F.canvas(preset.finish,96).toDataURL(); sample.alt = '';
          const label = document.createElement('span'); label.textContent = preset.name; button.append(sample,label); button.onclick = () => applyFinish({...preset.finish}); button.dataset.pattern = preset.finish.pattern; button.dataset.color = preset.finish.color; library.append(button);
        });
      }
      library.querySelectorAll('button').forEach(button => { button.disabled = !enabled; button.setAttribute('aria-pressed',String(button.dataset.pattern === finish.pattern && button.dataset.color === finish.color)); });
      root.querySelectorAll('.fp-color-palette button').forEach(button => { button.disabled = !enabled; button.setAttribute('aria-pressed',String(button.dataset.color === finish.color)); });
    }
    F.COLORS.forEach(({name,color}) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'fp-color-swatch'; button.style.backgroundColor = color; button.dataset.color = color; button.title = `${name} ${color}`; button.setAttribute('aria-label',`${name} ${color}`); button.onclick = () => applyFinish({...currentFinish(),color}); root.querySelector('.fp-color-palette').append(button);
    });
    finishTarget.onchange = () => { syncFinishControls(); if (finishTarget.value === 'ceiling' && plan) viewer.action('ceiling-view'); };
    root.querySelector('#fp-wall-outside').onchange=event=>{
      if(!plan||analysis||designing||finishUploading||plan.walls[selected]?.kind!=='wall')return;
      const next={...plan,walls:plan.walls.map((wall,i)=>{if(i!==selected)return wall;const {outside,...value}=wall;return event.target.value==='auto'?value:{...value,outside:event.target.value};})};
      try{G.validate(next);pushHistory();plan=next;refresh();say('Wall faces updated. Choose separate inside and outside finishes, then save the project.');}catch(error){say(error.message,true);syncFinishControls();}
    };
    root.querySelectorAll('[data-finish-lock]').forEach(control=>control.onchange=()=>{
      if(!plan||analysis||designing||finishUploading)return;
      const key=control.dataset.finishLock,locked=control.checked;
      try {
        let next;
        if(key==='selected-wall') {
          if(plan.walls[selected]?.kind!=='wall')return;
          const finish=plan.walls[selected].finish||plan.finishes?.wall||F.DEFAULTS.wall;
          const exteriorFinish=plan.walls[selected].exteriorFinish||plan.finishes?.exterior||F.DEFAULTS.exterior;
          next={...plan,walls:plan.walls.map((wall,i)=>i===selected?{...wall,finishLocked:locked,...(locked?{finish:G.validateFinish(finish),exteriorFinish:G.validateFinish(exteriorFinish)}:{})}:wall)};
        } else next={...plan,finishLocks:{...plan.finishLocks,[key]:locked}};
        G.validate(next);pushHistory();plan=next;refresh();
        say(locked?'Design locked. Surprise me will keep this finish while regenerating the others. Save the project to keep the lock.':'Design unlocked. Surprise me can change it again.');
      }catch(error){say(error.message,true);syncFinishControls();}
    });
    for (const [id,key] of [['color','color'],['hex','color'],['accent','accent'],['scale','scale'],['rotation','rotation']]) root.querySelector(`#fp-finish-${id}`).onchange = event => applyFinish({...currentFinish(),[key]: ['scale','rotation'].includes(key) ? Number(event.target.value) : event.target.value});
    root.querySelector('#fp-finish-upload').onchange = async event => {
      const file = event.target.files[0]; if (!file || !canFinish()) return;
      const revision = editRevision, version = uploadVersion, target = finishTarget.value, wallIndex = selected;
      finishUploading = true; syncFinishControls(); say('Preparing your finish sample…');
      try {
        if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPG or WebP finish sample.');
        const texture = await compressImage(file, 768, .8);
        if (!root.isConnected || revision !== editRevision || version !== uploadVersion || target !== finishTarget.value || (individualTarget(target) && wallIndex !== selected)) return;
        applyFinish({...currentFinish(),pattern:'custom',texture,color:'#ffffff'});
      } catch(error) { if (root.isConnected) say(error.message,true); }
      finally { finishUploading = false; event.target.value = ''; if (root.isConnected) syncFinishControls(); }
    };
    function renderSuggestions() {
      const list = root.querySelector('.fp-suggestions'); list.replaceChildren();
      if (!plan) return;
      if (!suggestions.length) { const note = document.createElement('p'); note.className = 'fp-note'; note.textContent = 'No pending suggestions. You can place an item directly on the drawing.'; list.append(note); return; }
      const heading = document.createElement('p'); heading.className = 'fp-note'; heading.textContent = `${suggestions.length} possible item${suggestions.length === 1 ? '' : 's'} found. Check each shape and choose its correct type before adding it.`; list.append(heading);
      suggestions.forEach((item, index) => {
        const supported = [item.width, item.depth].every(value => Number.isFinite(value) && value >= .5 && value <= 15);
        const row = document.createElement('div'); row.className = 'fp-suggestion';
        const description = document.createElement('span'); description.textContent = `${item.detector === 'cubicasa5k' ? item.label || G.FURNITURE[item.type].label : `Possible ${G.FURNITURE[item.type].label.toLowerCase()}`} · ${item.width.toFixed(1)} × ${item.depth.toFixed(1)} ft · ${item.detector === 'cubicasa5k' ? 'model suggestion' : 'local suggestion'}`;
        const select = document.createElement('select'); select.setAttribute('aria-label', `Type for suggested shape ${index+1}`);
        Object.entries(G.FURNITURE).forEach(([key,value]) => select.add(new Option(value.label,key))); select.value=item.type;
        if (!supported) description.textContent += ' · Skipped: outside the supported 0.5–15 ft item size. Check the building scale.';
        const add = document.createElement('button'); add.type='button'; add.textContent='Add to model'; add.disabled = !supported; add.onclick=()=>{
          try { const next={...item,type:select.value}; G.validate({...plan,furniture:[...(plan.furniture||[]),next]}); pushHistory(); plan.furniture.push(next); selectedFurniture=plan.furniture.length-1; suggestions.splice(index,1); refresh(); say(`${G.FURNITURE[next.type].label} added. Adjust its position and size below, then save the project.`); }
          catch(error) { say(error.message,true); }
        };
        const dismiss = document.createElement('button'); dismiss.type='button'; dismiss.textContent='Dismiss'; dismiss.onclick=()=>{ suggestions.splice(index,1); renderSuggestions(); };
        row.append(description,select,add,dismiss); list.append(row);
      });
    }
    function syncControls() {
      root.querySelector('#fp-recognition-method').disabled = !!analysis || designing;
      root.querySelector('[data-vision-enabled]').disabled = root.dataset.visionConfigured!=='true' || !!analysis || designing;
      workspace.hidden = !plan;
      workspace.querySelectorAll('input, select, button').forEach(control => { control.disabled = !plan; });
      root.querySelectorAll('.fp-dimensions input').forEach(input => { input.disabled = !plan; if (plan) input.value = plan[input.id.slice(3)]; });
      root.querySelector('#fp-published').checked = plan?.published || false;
      root.querySelector('#fp-scale-confirmed').checked = plan?.scaleConfirmed !== false;
      const footprintNote = root.querySelector('[data-fp-footprint]');
      const regions = plan?.recognition?.regions || [];
      root.querySelector('[data-room-review]').hidden = !regions.length;
      root.querySelector('[data-room-summary]').textContent = regions.length ? `${regions.length} predicted room region${regions.length === 1 ? '' : 's'}: ${regions.map(region => `${region.type} (${Math.round(region.confidence * 100)}% confidence)`).join(' · ')}` : '';
      root.querySelector('[data-wall-review]').hidden = plan?.recognition?.engine !== 'mitunet';
      const stats=plan?.recognition?.summary||{}, candidates=plan?.recognition?.candidates||[];
      root.querySelector('[data-wall-summary]').textContent = `Combined recognition · ${stats.textRegions||0} text regions and ${stats.dimensionLines||0} dimension lines checked · ${candidates.length} uncertain walls excluded from 3D.`;
      const candidateList=root.querySelector('[data-wall-candidates]');candidateList.replaceChildren();
      candidates.forEach((candidate,index)=>{
        const row=document.createElement('div');row.className='fp-wall-candidate';
        const label=document.createElement('span');label.textContent=`${index+1}. ${candidate.reason} · ${Math.round((candidate.confidence||0)*100)}% model score`;
        const add=document.createElement('button');add.type='button';add.textContent='Add reviewed wall';add.disabled=!!analysis;
        const discard=document.createElement('button');discard.type='button';discard.textContent='Discard';discard.disabled=!!analysis;
        const finish=accept=>{
          try {
            const recognition={...plan.recognition,candidates:plan.recognition.candidates.filter((_,i)=>i!==index)};
            const walls=accept?[...plan.walls,{kind:'wall',a:candidate.a,b:candidate.b,confidence:candidate.confidence}]:plan.walls;
            const next=G.validate({...plan,walls,recognition,published:false});
            pushHistory();plan=next;selected=-1;refresh();say(accept?'Reviewed wall added to the 3D model.':'Uncertain wall discarded.');
          } catch(error){say(error.message,true);}
        };
        add.onclick=()=>finish(true);discard.onclick=()=>finish(false);row.append(label,add,discard);candidateList.append(row);
      });
      const vision=plan?.recognition?.visionReview;
      root.querySelector('[data-vision-review]').hidden=!vision;
      const flagged=(vision?.items||[]).filter(item=>item.classification!=='wall' && item.decision==='pending');
      root.querySelector('[data-vision-summary]').textContent=vision?`${vision.reviewed} of ${vision.totalCandidates} suspicious regions reviewed · ${flagged.length} flags awaiting your review. ${vision.state==='unavailable'?'The local reviewer was unavailable; detected geometry is preserved.':vision.state==='disabled'?'Local vision review is disabled.':vision.state==='partial'?'Review was incomplete or reached its crop limit.':''}${vision.ocrState==='unavailable'?' OCR was unavailable.':''}`:'';
      const visionList=root.querySelector('[data-vision-items]');visionList.replaceChildren();
      (vision?.items||[]).forEach((item,index)=>{
        if(item.classification==='wall' || item.decision!=='pending')return;
        const row=document.createElement('div');row.className='fp-vision-item';
        const description=document.createElement('p');description.className='fp-note';
        const evidence=[item.evidence.connected?'joins another wall':'',item.evidence.thickSupport?'thick ink support':'',item.evidence.coloredSupport?'coloured ink support':''].filter(Boolean);
        description.textContent=`${item.classification.replaceAll('-',' ')}: ${item.reason}${item.score===null?'':` · ${Math.round(item.score*100)}% model score (uncalibrated)`}${evidence.length?` · Geometry: ${evidence.join(', ')}.`:''}${item.ocrText?` · OCR: ${item.ocrText}`:''}`;
        const crop=document.createElement('canvas');crop.className='fp-vision-crop';
        if(image?.naturalWidth){
          const [x0,y0,x1,y1]=item.cropBounds, sw=(x1-x0)*image.naturalWidth, sh=(y1-y0)*image.naturalHeight;
          const scale=Math.min(1,240/sw,180/sh);crop.width=Math.max(1,Math.round(sw*scale));crop.height=Math.max(1,Math.round(sh*scale));
          const context=crop.getContext('2d');context.drawImage(image,x0*image.naturalWidth,y0*image.naturalHeight,sw,sh,0,0,crop.width,crop.height);
          context.strokeStyle='#dc2626';context.lineWidth=2;context.setLineDash([4,3]);context.beginPath();
          context.moveTo((item.a[0]-x0)/(x1-x0)*crop.width,(item.a[1]-y0)/(y1-y0)*crop.height);
          context.lineTo((item.b[0]-x0)/(x1-x0)*crop.width,(item.b[1]-y0)/(y1-y0)*crop.height);context.stroke();
        }
        const tools=document.createElement('div');tools.className='fp-tools';
        const wallIndex=G.visionWallIndex(plan,item);
        const inspect=document.createElement('button');inspect.type='button';inspect.textContent='Inspect wall';inspect.disabled=wallIndex<0;
        inspect.onclick=()=>{selected=G.visionWallIndex(plan,item);refresh();};
        const finish=decision=>{
          try{const next=G.resolveVisionReview(plan,index,decision);pushHistory();plan=next;selected=-1;refresh();say(decision==='removed'?'Reviewed wall removed. Undo restores it.':'Reviewed wall kept.');}
          catch(error){say(error.message,true);}
        };
        const keep=document.createElement('button');keep.type='button';keep.textContent='Keep wall';keep.disabled=wallIndex<0;keep.onclick=()=>finish('kept');
        const remove=document.createElement('button');remove.type='button';remove.textContent='Remove wall';remove.disabled=wallIndex<0;remove.onclick=()=>finish('removed');
        tools.append(inspect,keep,remove);row.append(crop,description,tools);
        if(wallIndex<0){const note=document.createElement('p');note.className='fp-note';note.textContent='This wall was edited or removed. Detect again to review its current shape.';row.append(note);}
        visionList.append(row);
      });
      const span = plan && G.wallSpan(plan);
      for (const key of ['width', 'depth']) { const input = root.querySelector(`#fp-building-${key}`); input.disabled = !span; input.value = span ? +span[key].toFixed(2) : ''; }
      for (const action of ['building-size', 'large-scale']) root.querySelector(`[data-action="${action}"]`).disabled = !span;
      root.querySelector('[data-building-size-note]').textContent = span ? `Building: ${span.width.toFixed(1)} × ${span.depth.toFixed(1)} ft. Wall height: ${plan.height} ft. Scale ${plan.scaleConfirmed ? 'confirmed' : 'awaiting your confirmation'}.` : 'Upload a drawing and detect its walls to set the building size.';
      const footprint = plan?.walls?.some(wall => wall.kind === 'wall') ? G.footprint(plan) : null;
      footprintNote.textContent = footprint ? `Detected wall span: approximately ${(footprint.width - Math.max(1, plan.thickness + .5)).toFixed(1)} × ${(footprint.depth - Math.max(1, plan.thickness + .5)).toFixed(1)} ft at the ${plan.scaleConfirmed ? 'confirmed' : 'suggested'} drawing scale.${plan.scaleConfirmed ? '' : ' Use a printed measurement to calibrate before judging room and furniture sizes.'}` : '';
      if (footprint) footprintNote.textContent += ` In this model: ${plan.walls.filter(w => w.kind === 'door').length} doors and ${plan.walls.filter(w => w.kind === 'window').length} windows.`;
      root.querySelector('[data-action="undo"]').disabled = !history.length;
      root.querySelector('[data-action="cancel"]').disabled = !pending;
      root.querySelector('[data-action="delete"]').disabled = selected < 0;
      root.querySelector('[data-action="update"]').disabled = selected < 0;
      root.querySelector('[data-action="export"]').disabled = !plan?.walls.length;
      root.querySelector('[data-action="export-json"]').disabled = !plan?.walls.length;
      const segments = root.querySelector('#fp-segments');
      segments.replaceChildren(new Option('No segment selected', '-1'));
      const sides=G.wallSurfaces(plan);
      plan?.walls.forEach((w, i) => segments.add(new Option(`${i + 1}. ${w.kind === 'door' ? 'Doorway' : w.kind === 'window' ? 'Window' : sides[i].uncertain?'Wall · review faces':sides[i].outside==='none'?'Interior wall':'Exterior wall'} · ${Math.hypot((w.b[0] - w.a[0]) * plan.width, (w.b[1] - w.a[1]) * plan.depth).toFixed(1)} ft${w.kind==='wall'&&(w.finishLocked||plan.finishLocks?.wall)?' · Design locked':''}`, String(i))));
      segments.value = String(selected);
      if (selected >= 0) {
        const w = plan.walls[selected];
        [w.a[0] * plan.width, w.a[1] * plan.depth, w.b[0] * plan.width, w.b[1] * plan.depth].forEach((value, i) => { root.querySelector(`#fp-coord-${i}`).value = value.toFixed(2); });
        root.querySelector('#fp-kind').value = w.kind;
      }
      const items = root.querySelector('#fp-items'); items.replaceChildren(new Option('No item selected','-1'));
      plan?.furniture?.forEach((item,i)=>items.add(new Option(`${i+1}. ${G.FURNITURE[item.type].label}${item.source==='detected' ? ' · from drawing' : ''}`,String(i))));
      if (selectedFurniture >= (plan?.furniture?.length || 0)) selectedFurniture=-1;
      items.value=String(selectedFurniture);
      root.querySelectorAll('.fp-item-fields input, .fp-item-fields select').forEach(control=>{ control.disabled=selectedFurniture<0; });
      for (const action of ['update-furniture','delete-furniture']) root.querySelector(`[data-action="${action}"]`).disabled=selectedFurniture<0;
      if (selectedFurniture>=0) {
        const item=plan.furniture[selectedFurniture];
        for (const [key,value] of Object.entries({type:item.type,x:item.center[0]*plan.width,y:item.center[1]*plan.depth,width:item.width,depth:item.depth,rotation:item.rotation})) root.querySelector(`#fp-item-${key}`).value=typeof value==='number' ? +value.toFixed(2) : value;
      }
      renderSuggestions();
      syncFinishControls();
      workspace.setAttribute('aria-busy', String(!!analysis || designing));
      // Keep the worker's input stable; otherwise an edit silently invalidates
      // its result and an uploaded plan can remain empty after recognition.
      if (analysis || designing) workspace.querySelectorAll('input, select, button').forEach(control => { control.disabled = true; });
      root.querySelector('#fp-upload').disabled = designing;
      designer?.sync();
    }
    function draw() {
      if (!plan) return;
      const width = canvas.clientWidth, ratio = image?.naturalHeight / image?.naturalWidth || plan.depth / plan.width;
      const height = width * ratio, dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.style.height = `${height}px`; canvas.width = Math.max(1, Math.round(width * dpr)); canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
      if (image?.complete && image.naturalWidth) { ctx.globalAlpha = .7; ctx.drawImage(image, 0, 0, width, height); ctx.globalAlpha = 1; }
      if (root.querySelector('[data-room-overlay]').checked) {
        const colors = ['#3b82f6', '#10b981', '#a855f7', '#f59e0b', '#06b6d4'];
        (plan.recognition?.regions || []).forEach((region, i) => {
          ctx.save(); ctx.beginPath(); region.polygon.forEach((p, n) => ctx[n ? 'lineTo' : 'moveTo'](p[0] * width, p[1] * height)); ctx.closePath();
          ctx.fillStyle = colors[i % colors.length]; ctx.globalAlpha = .16; ctx.fill(); ctx.globalAlpha = .6; ctx.lineWidth = 1; ctx.strokeStyle = colors[i % colors.length]; ctx.stroke(); ctx.restore();
        });
      }
      function line(a, b, color, dashed = false) { ctx.beginPath(); ctx.moveTo(a[0] * width, a[1] * height); ctx.lineTo(b[0] * width, b[1] * height); ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.setLineDash(dashed ? [7, 5] : []); ctx.stroke(); ctx.setLineDash([]); }
      if(root.querySelector('[data-annotation-overlay]').checked)(plan.recognition?.annotations||[]).forEach(annotation=>{
        ctx.save();ctx.beginPath();annotation.polygon.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](p[0]*width,p[1]*height));ctx.closePath();ctx.fillStyle='rgba(234,88,12,.16)';ctx.fill();ctx.strokeStyle='#c2410c';ctx.lineWidth=1;ctx.stroke();ctx.restore();
      });
      if(root.querySelector('[data-candidate-overlay]').checked)(plan.recognition?.candidates||[]).forEach(candidate=>line(candidate.a,candidate.b,'#9333ea',true));
      plan.walls.forEach((w, i) => { line(w.a, w.b, selected === i ? '#f97316' : { wall: '#285ee7', door: '#9d5a2b', window: '#008a96' }[w.kind], w.kind === 'door'); });
      if(root.querySelector('[data-vision-overlay]').checked)(plan.recognition?.visionReview?.items||[]).forEach(item=>{
        if(item.classification!=='wall' && item.decision==='pending' && G.visionWallIndex(plan,item)>=0)line(item.a,item.b,'#dc2626',true);
      });
      const selectedWall=plan.walls[selected];
      if(selectedWall?.kind==='wall') {
        const dx=(selectedWall.b[0]-selectedWall.a[0])*width,dy=(selectedWall.b[1]-selectedWall.a[1])*height,len=Math.hypot(dx,dy),nx=-dy/len,ny=dx/len;
        const x=(selectedWall.a[0]+selectedWall.b[0])/2*width,y=(selectedWall.a[1]+selectedWall.b[1])/2*height,ex=x+nx*30,ey=y+ny*30;
        ctx.save();ctx.strokeStyle='#b45309';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(ex,ey);ctx.moveTo(ex-nx*7-ny*5,ey-ny*7+nx*5);ctx.lineTo(ex,ey);ctx.lineTo(ex-nx*7+ny*5,ey-ny*7-nx*5);ctx.stroke();
        ctx.fillStyle='#7c3907';ctx.font='600 12px Segoe UI, sans-serif';ctx.textAlign='center';ctx.fillText('Side 1',ex+nx*14,ey+ny*14);ctx.restore();
      }
      (plan.furniture || []).forEach((item,i) => {
        ctx.save(); ctx.translate(item.center[0]*width,item.center[1]*height); ctx.rotate(item.rotation*Math.PI/180);
        const w=item.width/plan.width*width,d=item.depth/plan.depth*height;
        ctx.fillStyle=i===selectedFurniture ? 'rgba(249,115,22,.36)' : 'rgba(177,120,37,.3)';
        ctx.strokeStyle=i===selectedFurniture ? '#ea580c' : '#956b29'; ctx.lineWidth=2;
        ctx.fillRect(-w/2,-d/2,w,d); ctx.strokeRect(-w/2,-d/2,w,d);
        ctx.fillStyle='#663f18'; ctx.font='600 11px Segoe UI, sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(G.FURNITURE[item.type].label,0,0,Math.max(20,w-4)); ctx.restore();
      });
      suggestions.forEach(item=>{ ctx.save(); ctx.setLineDash([5,4]); ctx.strokeStyle='#976321'; ctx.lineWidth=2; ctx.strokeRect(item.center[0]*width-item.width/plan.width*width/2,item.center[1]*height-item.depth/plan.depth*height/2,item.width/plan.width*width,item.depth/plan.depth*height); ctx.restore(); });
      if (pending) { ctx.beginPath(); ctx.arc(pending[0] * width, pending[1] * height, 6, 0, Math.PI * 2); ctx.fillStyle = '#f97316'; ctx.fill(); if (cursor) line(pending, cursor, '#f97316', true); }
    }
    function refresh() { syncControls(); draw(); viewer.update(plan); onChange?.(plan); }
    function loadImage() {
      const next = new Image(); image = next;
      next.onload = () => { if (image === next) { syncControls(); draw(); if (autoOnLoad) {
        const factor = 100 / Math.max(next.naturalWidth, next.naturalHeight);
        plan = G.resizeDrawing(plan, Math.max(4, next.naturalWidth * factor), Math.max(4, next.naturalHeight * factor));
        autoOnLoad = false; scanSavedOpenings = false; refresh(); setTimeout(() => detectWalls(false), 0); }
        else if (scanSavedOpenings) { scanSavedOpenings = false; setTimeout(() => plan.walls.length ? detectOpenings() : detectWalls(false), 0); } } };
      next.onerror = () => { if (image === next) say('The saved drawing could not be displayed. Upload a new image to continue.', true); };
      next.src = plan.image;
    }
    function validateDraft() {
      if (uploading || autoOnLoad || analysis || finishUploading || designing) throw new Error('Wait for the drawing, finish upload and design to finish before saving.');
      if (!plan) return null;
      for (const key of ['width', 'depth', 'height', 'thickness']) plan[key] = Number(root.querySelector(`#fp-${key}`).value);
      plan.scaleConfirmed = root.querySelector('#fp-scale-confirmed').checked;
      plan.published = root.querySelector('#fp-published').checked;
      return G.validate(plan);
    }
    function drawingPixels() {
      const factor=Math.min(1,1536/Math.max(image.naturalWidth,image.naturalHeight));
      const sample=document.createElement('canvas');
      sample.width=Math.max(1,Math.round(image.naturalWidth*factor)); sample.height=Math.max(1,Math.round(image.naturalHeight*factor));
      const context=sample.getContext('2d',{willReadFrequently:true});
      context.drawImage(image,0,0,sample.width,sample.height);
      return context.getImageData(0,0,sample.width,sample.height);
    }
    async function analyze(pixels, mode) {
      analysis?.cancel();
      await recognitionStatus;
      if (!root.isConnected) throw new Error('Analysis cancelled.');
      return new Promise((resolve, reject) => {
        const controller = new AbortController();
        const worker = ['all','furniture'].includes(mode) ? new Worker('/floor-plan-worker.js?v=9') : null;
        let settled = false, modelResult = null, furnitureResult = null, furnitureTimer;
        const job = { cancel() { finish(new Error('Analysis cancelled.')); } };
        const timer = setTimeout(() => finish(new Error('Recognition timed out. Try a smaller drawing.')), 95000);
        function finish(error, result) {
          if (settled) return;
          settled = true; clearTimeout(timer); clearTimeout(furnitureTimer); worker?.terminate(); controller.abort();
          if (analysis === job) { analysis = null; if (root.isConnected) syncControls(); }
          error ? reject(error) : resolve(result);
        }
        function combine() {
          if (!modelResult || !furnitureResult) return;
          const furniture = G.recognitionFurniture(modelResult, furnitureResult.furniture || [], plan.width, plan.depth);
          finish(null, { ...modelResult, furniture, walls: mode === 'furniture' ? []
            : mode === 'openings' ? modelResult.walls.filter(w => w.kind !== 'wall') : modelResult.walls });
        }
        analysis = job; syncControls();
        if (worker) {
          worker.onmessage = event => { furnitureResult = event.data.error ? { furniture: [] } : event.data; combine(); };
          worker.onerror = () => { furnitureResult = { furniture: [] }; combine(); };
        }
        say('Recognising the drawing with the pretrained floor plan model…');
        fetch('/api/admin/floor-plan-recognition', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ image: plan.image, width: plan.width, depth: plan.depth,
            profile: root.querySelector('#fp-recognition-method').value,
            ...(mode==='all' && root.querySelector('[data-vision-enabled]').checked?{visionReview:true}:{}),
            ...(mode==='all' ? root.dataset.recognitionEngine==='mitunet' ? {mode:'combined'} : {} : {mode}) }), signal: controller.signal })
          .then(async response => {
            const body = await response.json(); if (settled) return;
            if (!response.ok) throw new Error(body.error || 'Recognition failed. Restart the floor plan service and try again.');
            if (!['cubicasa5k','mitunet','color-walls'].includes(body.engine) || !Array.isArray(body.walls) || !Array.isArray(body.furniture))
              throw new Error('Recognition returned an invalid result.');
            modelResult = body;
            if (!worker) { furnitureResult = { furniture: [] }; combine(); return; }
            // The model owns walls/openings. Image rules only suggest movable
            // furniture after the recognized structural geometry is available.
            furnitureTimer = setTimeout(() => { furnitureResult = { furniture: [] }; combine(); }, 8000);
            worker.postMessage({ id: 1, pixels, mode: 'furniture', plan: {
              width: plan.width, depth: plan.depth, walls: body.walls, furniture: plan.furniture || [] } }, [pixels.data.buffer]);
          }).catch(error => { if (!settled) finish(error); });
      });
    }
    async function scanFurniture(pixels, announce = true) {
      if (!plan || !image?.naturalWidth) return say('Wait for the floor-plan drawing to finish loading.',true);
      const version = uploadVersion, revision = editRevision;
      try {
        if (announce) say('Looking for furniture in the drawing…');
        const result = await analyze(pixels || drawingPixels(), 'furniture');
        if (!root.isConnected || version !== uploadVersion || revision !== editRevision) return;
        suggestions = result.furniture; refresh();
        if (announce) say(suggestions.length ? `${suggestions.length} possible furniture or fixture shapes found. Review and label each one before adding it.` : 'No clear isolated furniture shapes found. Use Place item on drawing to add them yourself.');
      } catch(error) { if (root.isConnected && error.message !== 'Analysis cancelled.') say(error.message,true); }
    }
    async function detectWalls(confirmReplace) {
      if (!plan || !image?.naturalWidth) return say('Wait for the floor-plan drawing to finish loading.', true);
      if (confirmReplace && plan.walls.length && !window.confirm('Replace the current traced walls, individual finishes and individual design locks with newly detected walls? Your floor-wide finishes and locks stay in place. You can undo this until you leave the editor.')) return;
      say('Detecting walls, doors, windows and furniture…');
      const version = uploadVersion, revision = editRevision;
      try {
        const result = await analyze(drawingPixels(), 'all');
        if (!root.isConnected || version !== uploadVersion || revision !== editRevision) return;
        const proposed = result.walls, found = result.furniture;
        if (!proposed.some(segment => segment.kind === 'wall') && !result.candidates?.length) { suggestions=found; refresh(); return say('No clear wall lines were found. Add walls manually or upload a clearer drawing.', true); }
        let next = G.validate({ ...plan, published: false, walls: proposed, openingDetectionVersion: 4,
          recognition: { engine: result.engine, regions: result.rooms || [], inferenceMs: result.inferenceMs,
            ...(result.visionReview?{visionReview:result.visionReview}:{}),
            ...(result.engine==='mitunet'?{candidates:result.candidates||[],annotations:result.annotations||[],summary:result.summary||{}}:{}) } });
        if (useLargeInitialScale && G.wallSpan(next)) next = G.largeLayout(next, 60, image.naturalWidth, image.naturalHeight);
        const scaledSuggestions = resizeSuggestions(found, plan, next);
        pushHistory(); plan = next; useLargeInitialScale = false; selected = -1; pending = cursor = null; suggestions=scaledSuggestions; refresh();
        const count = kind => proposed.filter(segment => segment.kind === kind).length;
        const resolutionNote = Math.min(image.naturalWidth, image.naturalHeight) < 300 ? ' This image is low resolution; faint door/window symbols may be unreadable. Upload a larger original drawing for better recognition.' : '';
        say(`${count('wall')} walls, ${count('door')} doors and ${count('window')} windows proposed, plus ${scaledSuggestions.length} furniture/fixture suggestions. ${result.engine==='color-walls'?'Coloured wall recognition. Straight wall strips supply geometry; details are checked inside the building.':'Pretrained model recognition. '+(result.engine==='mitunet'?`Combined MitUNet and FLRplanner detection; ${next.recognition.candidates.length} uncertain walls need review.`:'FLRplanner recognition.')} Review openings and furniture, then confirm the real dimensions.${resolutionNote}`);
      } catch(error) { if (root.isConnected && error.message !== 'Analysis cancelled.') say(error.message,true); }
    }
    async function detectOpenings() {
      if (!plan || !image?.naturalWidth) return say('Wait for the floor-plan drawing to finish loading.', true);
      if (!plan.walls.some(wall => wall.kind === 'wall')) return say('Trace or detect the walls first, then find their openings.', true);
      const version = uploadVersion, revision = editRevision;
      say('Looking for door swings and window strips along the traced walls…');
      try {
        const result = await analyze(drawingPixels(), 'openings');
        if (!root.isConnected || version !== uploadVersion || revision !== editRevision) return;
        const scaled = point => [point[0] * image.naturalWidth, point[1] * image.naturalHeight];
        const samePlace = (existing, candidate) => {
          const [a, b] = [existing.a, existing.b].map(scaled), [c, d] = [candidate.a, candidate.b].map(scaled);
          const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
          const otherLength = Math.hypot(d[0] - c[0], d[1] - c[1]);
          if (!length || !otherLength || Math.abs((dx * (d[0] - c[0]) + dy * (d[1] - c[1])) / length / otherLength) < .995) return false;
          const project = p => [((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length,
            Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / length];
          const [p, q] = [c, d].map(project);
          const overlap = Math.min(length, Math.max(p[0], q[0])) - Math.max(0, Math.min(p[0], q[0]));
          return Math.max(p[1], q[1]) < 9 && overlap > Math.min(length, otherLength) * .45;
        };
        const additions = result.walls.filter(candidate => !plan.walls.some(existing => existing.kind !== 'wall' && samePlace(existing, candidate)))
          .slice(0, Math.max(0, G.MAX_SEGMENTS - plan.walls.length));
        if (additions.length) {
          G.validate({ ...plan, published: false, walls: [...plan.walls, ...additions] });
          pushHistory(); plan.walls.push(...additions); plan.published = false; refresh();
        }
        plan.openingDetectionVersion = 4; refresh();
        const doors = additions.filter(item => item.kind === 'door').length;
        const windows = additions.length - doors;
        say(additions.length ? `Added ${doors} door${doors === 1 ? '' : 's'} and ${windows} window${windows === 1 ? '' : 's'} to the 3D layout. Review their positions before publishing.` : 'No new clear door or window symbols were found. Use the Doorway or Window tool to add any missed openings.');
      } catch (error) { if (root.isConnected && error.message !== 'Analysis cancelled.') say(error.message, true); }
    }
    root.querySelector('#fp-upload').onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      if (plan && !window.confirm('Replace this drawing and clear its traced walls? Your current version stays saved until you save the project.')) { e.target.value = ''; return; }
      analysis?.cancel();
      const version = ++uploadVersion; uploading = true; say('Preparing your floor-plan image…');
      try {
        if (file.type === 'application/json' || /\.json$/i.test(file.name)) {
          if (file.size > 7000000) throw new Error('The layout JSON is too large. Choose a single-floor layout exported from this editor.');
          const restored = G.validate(JSON.parse(await file.text()));
          if (!restored || restored.version !== 1) throw new Error('Choose a single-floor layout JSON exported from this editor.');
          if (version !== uploadVersion || !root.isConnected) return;
          plan = restored; pending = cursor = null; selected = selectedFurniture = -1; suggestions = []; history = [];
          autoOnLoad = useLargeInitialScale = scanSavedOpenings = false; loadImage(); refresh();
          say('Reviewed layout restored. Its drawing, wall edits, dimensions, furniture and finishes are preserved.');
          return;
        }
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPG or WebP drawing.');
        const data = await readDrawing(file);
        if (version !== uploadVersion || !root.isConnected) return;
        plan = G.validate({ version: 1, image: data, width: 30, depth: 40, height: 10, thickness: .5, scaleConfirmed: false, published: false, walls: [] });
        pending = cursor = null; selected = selectedFurniture = -1; suggestions=[]; history = []; autoOnLoad = true; useLargeInitialScale = true; loadImage(); refresh(); say('Drawing added. Detecting walls, openings and possible furniture. The large preview size is provisional until you confirm actual dimensions.');
      } catch (error) { say(error.message, true); }
      finally { if (version === uploadVersion) { uploading = false; e.target.value = ''; } }
    };
    root.querySelectorAll('.fp-dimensions input').forEach(input => input.addEventListener('change', () => {
      if (!plan) return;
      try { const proposed = { ...plan, [input.id.slice(3)]: Number(input.value), published: false };
        const next = ['fp-width', 'fp-depth'].includes(input.id) ? G.resizeDrawing(plan, proposed.width, proposed.depth) : G.validate(proposed);
        suggestions = resizeSuggestions(suggestions, plan, next); pushHistory(); plan = next; refresh(); say('Dimensions updated. Confirm the drawing scale before publishing.'); }
      catch (error) { say(error.message, true); }
    }));
    function resizeSuggestions(items, previous, next) {
      const sx = next.width / previous.width, sz = next.depth / previous.depth;
      return items.map(item => { const angle = item.rotation * Math.PI / 180;
        return { ...item, width: item.width * Math.hypot(Math.cos(angle) * sx, Math.sin(angle) * sz),
          depth: item.depth * Math.hypot(Math.sin(angle) * sx, Math.cos(angle) * sz),
          rotation: Math.atan2(Math.sin(angle) * sz, Math.cos(angle) * sx) * 180 / Math.PI }; });
    }
    for (const key of ['width', 'depth']) root.querySelector(`#fp-building-${key}`).onchange = event => {
      const span = plan && G.wallSpan(plan), other = key === 'width' ? 'depth' : 'width';
      if (span && root.querySelector('#fp-size-proportions').checked) root.querySelector(`#fp-building-${other}`).value = +(Number(event.target.value) * span[other] / span[key]).toFixed(2);
    };
    root.querySelectorAll('[data-tool]').forEach(button => button.onclick = () => {
      tool = button.dataset.tool; pending = cursor = null;
      root.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
      refresh();
      if (tool === 'scale') say('Click the first endpoint of the known measurement, then its other endpoint.');
      if (tool === 'furniture') say('Click the drawing where you want to place the selected item.');
    });
    function point(e) {
      const rect = canvas.getBoundingClientRect();
      let p = [clamp((e.clientX - rect.left) / rect.width, 0, 1), clamp((e.clientY - rect.top) / rect.height, 0, 1)];
      if (tool === 'scale' || tool === 'furniture' || tool === 'select') return p;
      for (const w of plan.walls) for (const end of [w.a, w.b]) if (Math.hypot((end[0] - p[0]) * rect.width, (end[1] - p[1]) * rect.height) < 9) return [...end];
      if (pending && root.querySelector('[data-snap]').checked) {
        if (Math.abs(p[0] - pending[0]) * rect.width < Math.abs(p[1] - pending[1]) * rect.height) p[0] = pending[0]; else p[1] = pending[1];
      }
      return p;
    }
    function saveSegment(segment, index = -1) {
      try {
        if (index >= 0 && segment.kind === plan.walls[index].kind) {
          segment = { ...plan.walls[index], ...segment };
        }
        const next = plan.walls.slice(); if (index < 0) next.push(segment); else next[index] = segment;
        G.validate({ ...plan, walls: next, published: false });
        pushHistory(); plan.walls = next; selected = index < 0 ? next.length - 1 : index; selectedFurniture=-1; pending = cursor = null; refresh();
        say(`${plan.walls.length} segments traced. Save the project to keep your model.`);
      } catch (error) { say(error.message, true); }
    }
    canvas.onclick = e => {
      if (!plan || !image?.naturalWidth || analysis || designing) return;
      const p = point(e);
      if (tool === 'furniture') {
        try {
          const type=root.querySelector('#fp-place-type').value, preset=G.FURNITURE[type];
          const item={type,center:p,width:preset.width,depth:preset.depth,rotation:0,source:'manual'};
          G.validate({...plan,furniture:[...(plan.furniture||[]),item]});
          pushHistory(); plan.furniture.push(item); selectedFurniture=plan.furniture.length-1; selected=-1; refresh();
          say(`${preset.label} placed. Use the fields below to adjust its position, size and rotation.`);
        } catch(error) { say(error.message,true); }
      } else if (tool === 'select') {
        const rect = canvas.getBoundingClientRect(); let best = 15; selected = -1;
        selectedFurniture=-1;
        (plan.furniture||[]).forEach((item,i)=>{
          const dx=(p[0]-item.center[0])*plan.width,dz=(p[1]-item.center[1])*plan.depth;
          const angle=-item.rotation*Math.PI/180;
          const localX=dx*Math.cos(angle)-dz*Math.sin(angle),localZ=dx*Math.sin(angle)+dz*Math.cos(angle);
          if(Math.abs(localX)<=item.width/2 && Math.abs(localZ)<=item.depth/2) selectedFurniture=i;
        });
        if(selectedFurniture>=0) { refresh(); return; }
        plan.walls.forEach((w, i) => {
          const a = [w.a[0] * rect.width, w.a[1] * rect.height], b = [w.b[0] * rect.width, w.b[1] * rect.height], q = [p[0] * rect.width, p[1] * rect.height];
          const dx = b[0] - a[0], dy = b[1] - a[1], t = clamp(((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy), 0, 1);
          const distance = Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy);
          if (distance < best) { best = distance; selected = i; }
        }); refresh();
      } else if (pending && tool === 'scale') {
        try {
          const calibrated = G.calibrate(plan, pending, p, Number(root.querySelector('#fp-reference').value), image.naturalWidth, image.naturalHeight);
          pushHistory(); plan = calibrated; pending = cursor = null; refresh();
          suggestions=[]; scanFurniture(undefined, false);
          say(`Scale calibrated: full drawing ${plan.width.toFixed(2)} × ${plan.depth.toFixed(2)} ft. Review the layout before publishing. Choose Wall or Select to continue editing.`);
        } catch (error) { say(error.message, true); }
      } else if (pending) saveSegment({ kind: tool, a: pending, b: p });
      else { pending = p; cursor = null; refresh(); say('Tap the other end of this segment. Press Escape to cancel.'); }
    };
    canvas.onpointermove = e => { if (pending) { cursor = point(e); draw(); } };
    canvas.onpointerleave = () => { cursor = null; draw(); };
    canvas.onkeydown = e => { if (e.key === 'Escape') { pending = cursor = null; refresh(); } };
    root.querySelector('#fp-segments').onchange = e => { selected = Number(e.target.value); selectedFurniture=-1; refresh(); };
    root.querySelector('#fp-items').onchange = e => { selectedFurniture=Number(e.target.value); selected=-1; refresh(); };
    root.querySelector('#fp-published').onchange = e => { if (plan) plan.published = e.target.checked; };
    root.querySelector('#fp-scale-confirmed').onchange = e => { if (plan) plan.scaleConfirmed = e.target.checked; };
    root.querySelectorAll('[data-action]').forEach(button => button.onclick = () => {
      const action = button.dataset.action;
      if (action === 'building-size' || action === 'large-scale') {
        try {
          const next = action === 'large-scale' ? G.largeLayout(plan, 60, image?.naturalWidth || plan.width, image?.naturalHeight || plan.depth) : G.resizeBuilding(plan, Number(root.querySelector('#fp-building-width').value), Number(root.querySelector('#fp-building-depth').value));
          const resized = resizeSuggestions(suggestions, plan, next);
          pushHistory(); plan = next; suggestions = resized; useLargeInitialScale = false; refresh(); viewer.action('reset');
          say('Building size updated. Walls and openings keep their drawing positions; detected fixtures follow the new scale. Confirm the actual dimensions before publishing.');
        } catch (error) { say(error.message, true); }
        return;
      }
      if (action === 'reset-finish') {
        if (!canFinish()) return;
        if (individualTarget(finishTarget.value)) {
          const property=finishKey(finishTarget.value)==='exterior'?'exteriorFinish':'finish';
          pushHistory();plan.walls=plan.walls.map((wall,i)=>{if(i!==selected)return wall;const rest={...wall};delete rest[property];return rest;});refresh();say('This wall face now uses the floor-wide finish.');
        } else applyFinish({...F.DEFAULTS[finishTarget.value]});
        return;
      }
      if (action === 'detect') { detectWalls(true); return; }
      if (action === 'detect-openings') { detectOpenings(); return; }
      if (action === 'find-furniture') { scanFurniture(); return; }
      if (action === 'update-furniture' && selectedFurniture>=0) {
        try {
          const value=key=>Number(root.querySelector(`#fp-item-${key}`).value);
          const item={...plan.furniture[selectedFurniture],type:root.querySelector('#fp-item-type').value,center:[value('x')/plan.width,value('y')/plan.depth],width:value('width'),depth:value('depth'),rotation:value('rotation')};
          const next=plan.furniture.slice(); next[selectedFurniture]=item; G.validate({...plan,furniture:next});
          pushHistory(); plan.furniture=next; refresh(); say('Item updated. Save the project to keep this change.');
        } catch(error) { say(error.message,true); }
        return;
      }
      if (action === 'delete-furniture' && selectedFurniture>=0) { pushHistory(); plan.furniture.splice(selectedFurniture,1); selectedFurniture=-1; refresh(); say('Item removed from the draft. Save the project to keep this change.'); return; }
      if (action === 'cancel') { pending = cursor = null; refresh(); }
      if (action === 'undo' && history.length) { ++editRevision; plan = history.pop(); selected = selectedFurniture = -1; pending = cursor = null; refresh(); say('Last planner change undone.'); }
      if (action === 'delete' && selected >= 0) { pushHistory(); plan.walls.splice(selected, 1); selected = -1; refresh(); }
      if (action === 'remove' && window.confirm('Remove this floor plan, 3D tracing and furniture? Save the project to confirm removal.')) { ++uploadVersion; uploading = false; plan = null; image = null; selected = selectedFurniture = -1; pending = cursor = null; suggestions=[]; history = []; refresh(); say('Floor plan removed from this draft. Save the project to confirm.'); }
      if (action === 'add' || action === 'update') {
        const coords = [0, 1, 2, 3].map(i => root.querySelector(`#fp-coord-${i}`).value);
        if (coords.some(value => value.trim() === '')) return say('Fill in all four endpoint coordinates.', true);
        const n = coords.map(Number);
        saveSegment({ kind: root.querySelector('#fp-kind').value, a: [n[0] / plan.width, n[1] / plan.depth], b: [n[2] / plan.width, n[3] / plan.depth] }, action === 'update' ? selected : -1);
      }
      if (action === 'export' || action === 'export-json') {
        try {
          const checked = validateDraft(); if (!checked?.walls.length) return;
          const json = action === 'export-json';
          const url = URL.createObjectURL(new Blob([json ? JSON.stringify(checked, null, 2) : G.toOBJ(checked)], { type: json ? 'application/json' : 'text/plain' }));
          const link = document.createElement('a'); link.href = url; link.download = json ? 'floor-plan-layout.json' : 'floor-plan-layout.obj'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) { say(error.message, true); }
      }
    });
    const resize = new ResizeObserver(draw); resize.observe(canvas);
    root.querySelector('[data-room-overlay]').onchange = draw;
    root.querySelector('[data-annotation-overlay]').onchange = draw;
    root.querySelector('[data-candidate-overlay]').onchange = draw;
    root.querySelector('[data-vision-overlay]').onchange = draw;
    if (!hideDesigner && window.FloorPlanDesign) {
      const designRoot = root.querySelector('[data-fp-designer]'); designRoot.hidden = false;
      designer = window.FloorPlanDesign.createControls(designRoot, {
        getModel: validateDraft, peekModel: () => plan,
        applyModel(next) { pushHistory(); plan = next; refresh(); },
        isReady: () => !!plan && G.hasGeometry(plan) && !uploading && !autoOnLoad && !analysis && !finishUploading,
        onBusy(value) { designing = value; syncControls(); }
      });
    }
    register(root, () => { resize.disconnect(); ++uploadVersion; analysis?.cancel(); designer?.dispose(); });
    if (plan) loadImage(); refresh();
    return { getValue: validateDraft };
  }
  window.FloorPlanUI = { createViewer, createEditor };
})();
