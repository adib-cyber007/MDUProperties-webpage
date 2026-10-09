'use strict';

function floorPlanSources(plan, title) {
  return FloorPlanGeometry.floorsOf(plan).filter(f => f.plan).map(f => `<details class="fp-source"><summary>${escapeHtml(f.name)} drawing</summary><img src="${escapeHtml(f.plan.image)}" alt="${escapeHtml(f.name)} plan for ${escapeHtml(title)}" loading="lazy"><p>Drawing: ${f.plan.width} × ${f.plan.depth} ft · Wall height: ${f.plan.height} ft · Elevation: ${f.elevation.toFixed(1)} ft</p></details>`).join('');
}

function portfolioFloorPlanMarkup(project, sold = true) {
  const plan = project.floorPlan;
  if (!plan?.published || !FloorPlanGeometry.hasGeometry(plan)) return '';
  return `<section class="model-section" aria-labelledby="portfolio-3d-title"><div class="container"><div class="fp-public-heading"><div><h2 id="portfolio-3d-title">Explore this property in 3D.</h2><p>View the whole building or choose an individual floor.</p></div>${sold ? '<span class="badge badge-sold">Sold · Not for sale</span>' : ''}</div><div id="project-floor-plan"></div><p class="fp-note">Layout model based on supplied floor plans. Furniture, finishes and opening heights are illustrative.</p>${floorPlanSources(plan, project.title)}</div></section>`;
}

function drawAdminModels() {
  const models = state.admin.data.models || [];
  document.querySelector('#admin-content').innerHTML = `<div class="admin-top"><div><h1>3D Projects</h1><p>Create a standalone project from a floor plan. You can add the drawing later.</p></div><button class="btn" id="add-model" type="button">Add 3D project</button></div><div class="admin-panel"><div class="admin-list">${models.length ? models.map(model => `<article class="admin-listing"><img src="${escapeHtml(FloorPlanGeometry.coverImage(model.floorPlan) || '/mark.svg?v=3')}" alt=""><div><div class="admin-listing-flags"><span>${model.floorPlan?.published ? 'Published 3D layout' : 'Draft'}</span></div><h3>${escapeHtml(model.title)}</h3><p>${escapeHtml(model.location)}</p><small>${model.floorPlan ? `${FloorPlanGeometry.floorsOf(model.floorPlan).length} floor(s)` : 'Floor plan not uploaded yet'}</small></div><div class="admin-listing-actions">${model.floorPlan?.published ? `<a class="btn btn-outline btn-small" href="/3d-project/${encodeURIComponent(model.id)}" data-link>View</a>` : ''}<button class="btn btn-outline btn-small" type="button" data-edit-model="${escapeHtml(model.id)}">Edit</button><button class="btn btn-danger btn-small" type="button" data-delete-model="${escapeHtml(model.id)}">Delete</button></div></article>`).join('') : '<div class="empty-state"><h2>Your 3D showcase starts here.</h2><p>Add a project name now, then upload its floor plan when it is ready.</p></div>'}</div></div>`;
  document.querySelector('#add-model').onclick = () => { state.admin.editing = 'new'; drawAdminTab(); };
  document.querySelectorAll('[data-edit-model]').forEach(button => button.onclick = () => { state.admin.editing = button.dataset.editModel; drawAdminTab(); });
  document.querySelectorAll('[data-delete-model]').forEach(button => button.onclick = async () => {
    const model = models.find(item => item.id === button.dataset.deleteModel);
    if (!window.confirm(`Delete “${model.title}” and its floor-plan model?`)) return;
    const finish = EditorWorkspace.busy(button, 'Deleting project…');
    try {
      await api(`/api/admin/models/${encodeURIComponent(model.id)}`, { method: 'DELETE' });
      await refreshModels(); drawAdminModels(); toast('3D project deleted.');
    } catch (error) { toast(error.message); } finally { finish(); }
  });
}

async function refreshModels() {
  const [adminData, modelsData] = await Promise.all([api('/api/admin/data'), api('/api/models')]);
  state.admin.data = adminData; state.models = modelsData.models;
  renderChrome();
}

function drawModelForm(id) {
  const isNew = id === 'new';
  const model = isNew ? { title: '', location: '', description: '', floorPlan: null } : (state.admin.data.models || []).find(item => item.id === id);
  if (!model) { state.admin.editing = null; return drawAdminModels(); }
  document.querySelector('#admin-content').innerHTML = `<div class="admin-top"><div><h1>${isNew ? 'Add 3D project' : 'Edit 3D project'}</h1><p>Save a draft now or publish a reviewed floor-plan model.</p></div></div><form class="admin-panel" id="model-form"><div id="model-error" role="alert"></div><section data-editor-section="details" data-editor-title="Project details"><div class="form-grid"><div class="field full"><label for="model-title">Project name</label><input id="model-title" name="title" maxlength="90" required value="${escapeHtml(model.title)}"></div><div class="field full"><label for="model-location">Location (optional)</label><input id="model-location" name="location" maxlength="140" value="${escapeHtml(model.location)}"></div><div class="field full"><label for="model-description">About this model (optional)</label><textarea id="model-description" name="description" rows="3" maxlength="2000">${escapeHtml(model.description)}</textarea></div></div></section><section data-editor-section="model" data-editor-title="Floor plan &amp; 3D"><div id="floor-plan-editor"></div></section><div class="form-actions"><button class="btn btn-outline" id="cancel-model" type="button">Cancel</button><button class="btn" type="submit">Save 3D project</button></div></form>`;
  EditorWorkspace.organizeForm(document.querySelector('#model-form'), model.floorPlan ? 'model' : 'details');
  const editor = FloorPlanUI.createEditor(document.querySelector('#floor-plan-editor'), model.floorPlan, { compressImage });
  document.querySelector('#cancel-model').onclick = () => { state.admin.editing = null; drawAdminModels(); };
  document.querySelector('#model-form').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget, button = form.querySelector('[type="submit"]');
    const finish = EditorWorkspace.busy(button, 'Saving 3D project…');
    await EditorWorkspace.paint();
    try {
      const payload = { ...Object.fromEntries(new FormData(form)), floorPlan: editor.getValue() };
      await api(isNew ? '/api/admin/models' : `/api/admin/models/${encodeURIComponent(model.id)}`, { method: isNew ? 'POST' : 'PUT', body: JSON.stringify(payload) });
      await refreshModels(); state.admin.editing = null; drawAdminModels();
      toast(payload.floorPlan?.published ? '3D project saved and published.' : '3D project draft saved.');
    } catch (error) { document.querySelector('#model-error').textContent = error.message; }
    finally { finish(); }
  };
}

function renderModelShowcase() {
  state.currentListing = null;
  document.title = `3D Projects — ${state.settings.brandName}`;
  setMeta('Explore interactive floor-plan layouts in our 3D project showcase.');
  main.innerHTML = `<section class="page-hero"><div class="container"><span class="eyebrow">3D Projects</span><h1>Explore the spaces in 3D.</h1><p>Interactive layouts built from project floor plans. These previews illustrate space and layout; they are not property listings.</p></div></section><section class="portfolio-index"><div class="container"><div class="listing-grid">${state.models.length ? state.models.map(model => `<article class="listing-card"><a class="card-image" href="/3d-project/${encodeURIComponent(model.id)}" data-link><img src="${escapeHtml(FloorPlanGeometry.coverImage(model.floorPlan))}" alt="Floor plan of ${escapeHtml(model.title)}" loading="lazy"><div class="card-badges"><span class="badge badge-signature">3D layout</span></div></a><div class="card-body"><p class="card-location">${escapeHtml(model.location || 'Project layout')}</p><h2 class="card-title"><a href="/3d-project/${encodeURIComponent(model.id)}" data-link>${escapeHtml(model.title)}</a></h2></div></article>`).join('') : '<div class="empty-state"><h2>3D projects are being prepared.</h2><p>Reviewed floor-plan models will appear here when published.</p></div>'}</div></div></section>`;
}

function renderModelProject(id) {
  state.currentListing = null;
  const model = state.models.find(item => item.id === id);
  if (!model) return renderNotFound();
  const plan = model.floorPlan;
  document.title = `${model.title} — 3D project`;
  setMeta(`Explore the floor-plan layout of ${model.title} in 3D.`);
  main.innerHTML = `<section class="page-hero"><div class="container"><a href="/3d-projects" data-link>All 3D projects</a><h1>${escapeHtml(model.title)}</h1><p>${escapeHtml(model.location)}</p>${model.description ? `<p style="white-space:pre-line">${escapeHtml(model.description)}</p>` : ''}</div></section><section class="model-section"><div class="container"><div class="fp-public-heading"><h2>Explore the floor plan.</h2><span class="badge badge-signature">3D layout showcase</span></div><div id="project-floor-plan"></div><p class="fp-note">Layout preview traced from the supplied floor plan. Finishes and opening heights are illustrative. This showcase does not indicate that the property is for sale.</p>${floorPlanSources(plan, model.title)}</div></section>`;
  FloorPlanUI.createViewer(document.querySelector('#project-floor-plan'), plan, `3D floor-plan layout of ${model.title}`);
}
