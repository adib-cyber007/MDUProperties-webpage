'use strict';
// Exercise the owner workflow against an isolated local store and synthetic model.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), work = path.join(root, 'work');
fs.mkdirSync(work, { recursive: true });
const dir = fs.mkdtempSync(path.join(work, 'editor-workspace-test-'));
fs.cpSync(path.join(root, 'public'), path.join(dir, 'public'), { recursive: true });
for (const file of ['server.js', 'seo.js', 'telegram-bot.js', 'floor-plan-recognition.js', 'floor-plan-ai.js']) fs.copyFileSync(path.join(root, file), path.join(dir, file));
for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL', 'TELEGRAM_BOT_TOKEN', 'AI_DESIGN_API_KEY', 'OPENAI_API_KEY', 'FLOORPLAN_RECOGNITION_URL']) delete process.env[key];
process.env.NODE_ENV = 'production'; process.env.ADMIN_PASSWORD = 'editor-workspace-test';
const server = require(path.join(dir, 'server.js'));
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=';
const segment = (kind, a, b) => ({ kind, a, b });
const floor = { version: 1, image: pixel, width: 24, depth: 20, height: 10, thickness: .5, scaleConfirmed: true, openingDetectionVersion: 4,
  walls: [segment('wall', [.05, .05], [.95, .05]), segment('wall', [.95, .05], [.95, .95]),
    segment('wall', [.95, .95], [.05, .95]), segment('wall', [.05, .95], [.05, .05]),
    segment('door', [.4, .95], [.6, .95])],
  furniture: [{ type: 'sofa', center: [.7, .7], width: 5, depth: 2.8, rotation: 0 }] };
const building = { version: 2, published: false, floors: [{ plan: floor }, { plan: { ...floor, height: 9 }, offsetX: 2 }] };

async function run() {
  let browser, page;
  const errors = [], checks = [];
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true });
    const login = await context.request.post(base + '/api/login', { data: { password: process.env.ADMIN_PASSWORD } });
    assert.equal(login.status(), 200);
    const create = async (endpoint, data, key) => {
      const response = await context.request.post(base + endpoint, { data });
      assert.equal(response.status(), 201, await response.text()); return (await response.json())[key];
    };
    const model = await create('/api/admin/models', { title: 'Courtyard house', location: 'Madurai', floorPlan: building }, 'model');
    const project = await create('/api/admin/projects', { title: 'Completed courtyard home', completedYear: 2025, mainImage: pixel, floorPlan: building }, 'project');
    const data = await (await context.request.get(base + '/api/admin/data')).json();
    const listing = data.listings[0];
    assert.equal((await context.request.put(base + '/api/admin/listings/' + listing.id, { data: { ...listing, floorPlan: building } })).status(), 200);
    page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    // Readiness is deterministic; recognition itself is outside this layout test.
    await page.route('**/api/admin/floor-plan-recognition', route => route.request().method() === 'GET'
      ? route.fulfill({ json: { ready: false, engine: 'cubicasa5k', visionReview: { enabled: false } } }) : route.continue());
    await page.goto(base + '/admin');
    await page.locator('[data-admin-tab="models"]').click();
    await page.locator(`[data-edit-model="${model.id}"]`).click();
    const outerTabs = () => page.getByRole('tablist', { name: 'Property editor sections' });
    const floorTabs = () => page.getByRole('tablist', { name: 'Floor editor tools' });
    const tab = name => floorTabs().getByRole('tab', { name, exact: true });
    const preview = () => page.locator('.fp-preview-panel');
    await preview().locator('canvas[data-engine="three"]').waitFor();
    assert.equal(await preview().locator('[data-view="walls"]').getAttribute('aria-pressed'), 'true', 'editor preview starts with full walls');
    assert.equal(await outerTabs().getByRole('tab', { name: 'Floor plan & 3D', exact: true }).getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('.fp-source-settings').getAttribute('open'), null);
    assert.equal(await page.locator('.building-alignment').getAttribute('open'), null);
    assert.equal(await page.locator('.building-preview').getAttribute('open'), null);
    assert.equal(await page.locator('[data-building-viewer] canvas').count(), 0, 'hidden combined preview does not build a second model');
    await page.locator('.building-preview > summary').click();
    await page.locator('[data-building-viewer] canvas[data-engine="three"]').waitFor();
    assert.equal(await page.locator('[data-building-viewer] [data-view="walls"]').getAttribute('aria-pressed'), 'true', 'combined building preview starts with full walls');
    await page.locator('.building-preview > summary').click();
    const boxes = await Promise.all([page.locator('.fp-editor-main').boundingBox(), preview().boundingBox()]);
    assert.ok(boxes[1].x > boxes[0].x + boxes[0].width, 'desktop shows tools and preview side by side');
    checks.push('focused sections, collapsed advanced controls and side-by-side desktop preview');

    await tab('Walls & openings').focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await tab('Finishes').getAttribute('aria-selected'), 'true');
    await page.locator('#fp-finish-color').fill('#457a68');
    await page.locator('#fp-finish-color').dispatchEvent('input');
    await tab('Furniture').click();
    await page.locator('#fp-items').selectOption('0');
    await page.locator('#fp-item-width').fill('6');
    await page.getByRole('button', { name: 'Update selected item', exact: true }).click();
    await tab('Drawing & scale').click(); await page.locator('#fp-height').fill('11'); await page.locator('#fp-height').press('Tab');
    await tab('Finishes').click(); assert.equal(await page.locator('#fp-finish-color').inputValue(), '#457a68');
    await tab('Furniture').click(); assert.equal(await page.locator('#fp-item-width').inputValue(), '6');
    checks.push('keyboard tab navigation and finish, furniture and dimension edits survive section changes');

    await page.getByLabel('Edit floor', { exact: true }).selectOption('1');
    await tab('Drawing & scale').click(); assert.equal(await page.locator('#fp-height').inputValue(), '9');
    await page.getByLabel('Edit floor', { exact: true }).selectOption('0');
    await tab('Drawing & scale').click(); assert.equal(await page.locator('#fp-height').inputValue(), '11');
    const exportEvent = page.waitForEvent('download');
    await page.locator('.fp-exports > summary').click();
    await page.getByRole('button', { name: 'Download layout (.json)', exact: true }).click();
    const exported = await exportEvent; const exportPath = path.join(work, 'editor-workspace-layout.json'); await exported.saveAs(exportPath);
    const exportedFloor = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
    assert.equal(exportedFloor.height, 11); assert.equal(exportedFloor.furniture[0].width, 6); assert.equal(exportedFloor.finishes.wall.color, '#457a68');
    checks.push('multifloor switching preserves edits and JSON export contains them');

    await outerTabs().getByRole('tab', { name: 'Project details', exact: true }).click();
    await page.locator('#model-title').fill('Courtyard house revised');
    await outerTabs().getByRole('tab', { name: 'Floor plan & 3D', exact: true }).click();
    await page.getByRole('button', { name: 'Save 3D project', exact: true }).click();
    await page.locator(`[data-edit-model="${model.id}"]`).waitFor();
    const saved = (await (await context.request.get(base + '/api/admin/data')).json()).models.find(item => item.id === model.id);
    assert.equal(saved.title, 'Courtyard house revised');
    assert.equal(saved.floorPlan.floors[0].plan.height, 11);
    assert.equal(saved.floorPlan.floors[0].plan.finishes.wall.color, '#457a68');
    assert.equal(saved.floorPlan.floors[0].plan.furniture[0].width, 6);
    assert.equal(saved.floorPlan.floors[1].plan.height, 9);
    await page.locator(`[data-edit-model="${model.id}"]`).click();
    await tab('Finishes').click(); assert.equal(await page.locator('#fp-finish-color').inputValue(), '#457a68');
    await tab('Walls & openings').click();
    await page.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, 0); });
    await page.screenshot({ path: path.join(work, 'editor-workspace-desktop.png'), fullPage: true });
    checks.push('save, API persistence and reopening keep all draft changes');

    await page.setViewportSize({ width: 390, height: 844 });
    await tab('Furniture').click(); await page.locator('#fp-items').selectOption('0');
    await page.getByRole('button', { name: 'Place item on drawing', exact: true }).click();
    const canvas = page.locator('.fp-trace-canvas');
    const rect = await canvas.boundingBox(); await canvas.click({ position: { x: rect.width * .35, y: rect.height * .4 } });
    assert.equal(await page.locator('#fp-items option').count(), 3);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile layout fits');
    await preview().locator('canvas[data-engine="three"]').waitFor();
    await preview().scrollIntoViewIfNeeded();
    await preview().screenshot({ path: path.join(work, 'editor-workspace-mobile-preview.png') });
    await page.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, 0); });
    await page.screenshot({ path: path.join(work, 'editor-workspace-mobile.png'), fullPage: true });
    checks.push('mobile tabs, drawing placement, live preview and no horizontal overflow');

    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const [dashboard, edit, id, title] of [
      ['listings', 'data-edit', listing.id, '#title'], ['portfolio', 'data-edit-project', project.id, '#project-title']
    ]) {
      await page.locator(`[data-admin-tab="${dashboard}"]`).click(); await page.locator(`[${edit}="${id}"]`).click();
      const original = await page.locator(title).inputValue(); await page.locator(title).fill(original + ' edited');
      await outerTabs().getByRole('tab', { name: /Photos/ }).click();
      assert.ok(await page.locator('#main-preview').isVisible());
      await outerTabs().getByRole('tab', { name: 'Floor plan & 3D', exact: true }).click();
      await preview().locator('canvas[data-engine="three"]').waitFor();
      await page.locator(title).evaluate(input => { input.value = ''; });
      await page.locator('button[type="submit"]').click();
      assert.ok(await page.locator(title).isVisible(), 'validation reveals the hidden details field');
      assert.equal(await page.locator(title).evaluate(input => input === document.activeElement), true);
      await page.locator(title).fill(original);
      await outerTabs().getByRole('tab', { name: 'Floor plan & 3D', exact: true }).click();
      await tab('Furniture').click();
      await page.locator('#fp-width').evaluate(input => { input.value = ''; });
      await page.locator('button[type="submit"]').click();
      assert.ok(await page.locator('#fp-width').isVisible(), 'validation reveals a hidden nested scale field');
      await page.locator('#fp-width').fill('24'); await page.locator('#fp-width').press('Tab');
      await page.locator('button[type="submit"]').click();
      await page.locator(`[${edit}="${id}"]`).waitFor();
    }
    checks.push('listing and portfolio forms share sections, validate hidden fields and save');
    await page.locator('[data-admin-tab="models"]').click(); await page.locator('#add-model').click();
    await page.locator('#model-title').fill('Draft without drawing');
    await outerTabs().getByRole('tab', { name: 'Floor plan & 3D', exact: true }).click();
    assert.ok(await page.locator('#fp-upload').isVisible());
    assert.equal(await page.locator('.fp-workspace').isVisible(), false);
    await page.getByRole('button', { name: 'Save 3D project', exact: true }).click();
    await page.getByRole('heading', { name: '3D Projects', exact: true }).waitFor();
    checks.push('new project guides drawing upload and saves without a floor plan');

    await page.locator('[data-admin-tab="upcoming"]').click(); await page.locator('#add-listing').click();
    assert.equal(await page.locator('#status').inputValue(), 'upcoming');
    await page.locator('#title').fill('Vaigai planned villas');
    await page.locator('#location').fill('Madurai'); await page.locator('#price').fill('8200000');
    await page.locator('#area').fill('2,400 sq ft'); await page.locator('#projectType').fill('Independent villas');
    await page.locator('#expectedCompletion').fill('Q4 2027');
    await page.locator('#description').fill('Planned family homes with a reviewed 3D layout.');
    await outerTabs().getByRole('tab', { name: 'Floor plan & 3D', exact: true }).click();
    await page.locator('#fp-upload').setInputFiles({ name: 'reviewed-floor.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(floor)) });
    await preview().locator('canvas[data-engine="three"]').waitFor();
    await page.locator('[data-building-published]').check();
    let releaseSave, posts = 0;
    const savingGate = new Promise(resolve => { releaseSave = resolve; });
    const holdSave = async route => { ++posts; await savingGate; await route.continue(); };
    await page.route('**/api/admin/listings', holdSave);
    await page.locator('#listing-form [type="submit"]').click();
    const saving = page.getByRole('button', { name: 'Saving project…', exact: true });
    await saving.waitFor(); assert.equal(await saving.isDisabled(), true);
    assert.equal(await saving.getAttribute('aria-busy'), 'true');
    assert.ok(await page.locator('.action-progress').isVisible());
    releaseSave();
    await page.locator('.admin-listing').filter({ hasText: 'Vaigai planned villas' }).waitFor();
    await page.unroute('**/api/admin/listings', holdSave); assert.equal(posts, 1);
    const upcoming = (await (await context.request.get(base + '/api/admin/data')).json()).listings.find(item => item.title === 'Vaigai planned villas');
    assert.equal(upcoming.floorPlan.published, true); assert.equal(upcoming.floorPlan.floors[0].plan.walls.length, floor.walls.length);
    assert.equal(upcoming.price, 8200000); assert.equal(upcoming.expectedCompletion, 'Q4 2027');
    checks.push('upcoming project creation imports a reviewed floor plan, publishes 3D and gives immediate save feedback');

    await page.locator(`[data-edit="${upcoming.id}"]`).click();
    assert.equal(await page.locator('#projectType').inputValue(), 'Independent villas');
    assert.equal(await page.locator('#expectedCompletion').inputValue(), 'Q4 2027');
    await page.locator('#expectedCompletion').fill('Q1 2028');
    const failSave = route => route.fulfill({ status: 503, json: { error: 'Temporary test failure. Try saving again.' } });
    await page.route('**/api/admin/listings/' + upcoming.id, failSave);
    await page.locator('#listing-form [type="submit"]').click();
    await page.getByText('Temporary test failure. Try saving again.').waitFor();
    assert.equal(await page.locator('#listing-form [type="submit"]').isDisabled(), false);
    assert.equal(await page.locator('.action-progress').count(), 0);
    assert.equal(await page.locator('#expectedCompletion').inputValue(), 'Q1 2028');
    await page.unroute('**/api/admin/listings/' + upcoming.id, failSave);
    await page.locator('#listing-form [type="submit"]').click();
    await page.locator(`[data-edit="${upcoming.id}"]`).waitFor();
    checks.push('reopening keeps project metadata; failed saves restore controls and retain edits for retry');

    const visitors = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const publicPage = await visitors.newPage(); publicPage.on('pageerror', error => errors.push(error.message));
    await publicPage.goto(base + '/upcoming-projects');
    const card = publicPage.locator('.listing-card').filter({ hasText: upcoming.title });
    await card.waitFor(); assert.ok(await card.getByText('Estimated', { exact: true }).isVisible());
    await card.getByRole('link', { name: upcoming.title, exact: true }).click();
    await publicPage.locator('canvas[data-engine="three"]').waitFor();
    assert.ok(await publicPage.getByText('Q1 2028', { exact: true }).isVisible());
    assert.ok(await publicPage.getByText('Estimated price', { exact: true }).isVisible());
    const walk = publicPage.getByRole('button', { name: 'Walk through', exact: true });
    await walk.click(); await publicPage.getByRole('button', { name: 'Exit walkthrough', exact: true }).waitFor();
    await publicPage.screenshot({ path: path.join(work, 'upcoming-project-desktop.png'), fullPage: true });
    await publicPage.goto(base + '/listings'); await publicPage.locator('.listing-grid').waitFor();
    assert.equal(await publicPage.getByRole('link', { name: upcoming.title, exact: true }).count(), 0);
    await publicPage.goto(base); await publicPage.locator('.upcoming-section').waitFor();
    assert.ok(await publicPage.locator('.upcoming-section').getByRole('link', { name: upcoming.title, exact: true }).isVisible());
    await publicPage.setViewportSize({ width: 390, height: 844 });
    await publicPage.goto(base + '/upcoming-projects'); await publicPage.locator('.listing-card').waitFor();
    assert.ok(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await publicPage.locator('.listing-card').evaluate(async card => { await Promise.all(card.getAnimations().map(animation => animation.finished)); });
    await publicPage.screenshot({ path: path.join(work, 'upcoming-projects-mobile.png'), fullPage: true });
    await visitors.close();
    checks.push('public upcoming pages show estimates and walkthrough, stay separate from available homes and fit mobile');
    assert.deepEqual(errors, []);
    const report = { pass: true, checks, browserErrors: errors };
    fs.writeFileSync(path.join(work, 'editor-workspace-browser-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(work, 'editor-workspace-failure.png'), fullPage: true }).catch(() => {});
    console.error(JSON.stringify({ checks, browserErrors: errors })); throw error;
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
