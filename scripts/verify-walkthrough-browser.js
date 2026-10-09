'use strict';
// An isolated website/store and public pages; no live property data is changed.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), work = path.join(root, 'work');
fs.mkdirSync(work, { recursive: true });
const dir = fs.mkdtempSync(path.join(work, 'walkthrough-test-'));
fs.cpSync(path.join(root, 'public'), path.join(dir, 'public'), { recursive: true });
for (const file of ['server.js', 'seo.js', 'telegram-bot.js', 'floor-plan-recognition.js']) fs.copyFileSync(path.join(root, file), path.join(dir, file));
for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL', 'TELEGRAM_BOT_TOKEN', 'AI_DESIGN_API_KEY', 'OPENAI_API_KEY', 'FLOORPLAN_RECOGNITION_URL']) delete process.env[key];
process.env.NODE_ENV = 'production'; process.env.ADMIN_PASSWORD = 'walkthrough-browser-test';
const server = require(path.join(dir, 'server.js'));
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=';
const segment = (kind, a, b) => ({ kind, a, b });
const floor = { version: 1, image: pixel, width: 24, depth: 20, height: 10, thickness: .5, scaleConfirmed: true,
  walls: [segment('wall', [.05, .05], [.95, .05]), segment('wall', [.95, .05], [.95, .95]),
    segment('wall', [.95, .95], [.05, .95]), segment('wall', [.05, .95], [.05, .05]),
    segment('wall', [.5, .05], [.5, .95]), segment('door', [.5, .4], [.5, .6]),
    segment('window', [.7, .05], [.85, .05])],
  furniture: [{ type: 'sofa', center: [.78, .78], width: 5, depth: 2.8, rotation: -15 }],
  finishes: { wall: { pattern: 'solid', color: '#dbe3e8', accent: '#ffffff', scale: 2, rotation: 0 },
    floor: { pattern: 'wood', color: '#bea27c', accent: '#8d7050', scale: 4, rotation: 0 },
    ceiling: { pattern: 'solid', color: '#ffffff', accent: '#ffffff', scale: 2, rotation: 0 } } };
const building = { version: 2, published: true, floors: [{ plan: floor },
  { plan: { ...floor, height: 9 }, offsetX: 3, offsetZ: -2, slabThickness: .75 }] };

async function run() {
  let browser, page;
  const errors = [], checks = [];
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await fetch(base + '/api/login', { method: 'POST', body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const headers = { cookie, 'content-type': 'application/json' };
    const create = async (endpoint, body, key) => {
      const response = await fetch(base + endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
      const result = await response.json(); assert.equal(response.status, 201, JSON.stringify(result)); return result[key];
    };
    const model = await create('/api/admin/models', { title: 'Walkthrough verification', location: 'Madurai', floorPlan: building }, 'model');
    const data = await (await fetch(base + '/api/admin/data', { headers })).json();
    const listing = data.listings[0];
    const update = await fetch(base + '/api/admin/listings/' + listing.id, { method: 'PUT', headers, body: JSON.stringify({ ...listing, floorPlan: building }) });
    assert.equal(update.status, 200);
    const project = await create('/api/admin/projects', { title: 'Completed home walkthrough', completedYear: 2025, mainImage: pixel, floorPlan: building }, 'project');
    const modelUrl = base + '/3d-project/' + model.id;
    if (process.argv.includes('--serve')) {
      console.log(JSON.stringify({ base, modelUrl, listingUrl: base + '/listing/' + listing.id, projectUrl: base + '/project/' + project.id }));
      const shutdown = () => { server.close(); clean(); process.exit(0); };
      process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
      await new Promise(() => {}); return;
    }
    browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true, hasTouch: true });
    page.on('pageerror', error => errors.push(error.message));
    const network = [];
    page.on('request', request => { if (/FLRplanner|localhost:8765|127\.0\.0\.1:8765|\.tsx?(\?|$)/i.test(request.url())) network.push(request.url()); });
    await page.addInitScript(() => {
      let factory;
      Object.defineProperty(window, 'FloorPlanRenderer', { configurable: true, get: () => factory, set(value) {
        factory = (...args) => { const viewer = value(...args); window.__walkViewer = viewer; return viewer; };
      } });
    });
    const stats = () => page.evaluate(() => window.__walkViewer.getStats());
    const wait = fn => page.waitForFunction(fn, null, { timeout: 15000 });
    const holdUntil = async (key, fn) => { await page.keyboard.down(key); try { await wait(fn); } finally { await page.keyboard.up(key); } };
    await page.goto(modelUrl);
    const viewer = page.locator('#project-floor-plan');
    await viewer.locator('canvas[data-engine="three"]').waitFor(); await viewer.scrollIntoViewIfNeeded();
    await wait(() => window.__walkViewer.getStats().renderCount > 0);
    const overview = await stats();
    assert.equal(overview.fullWalls, true, 'public viewer starts with full walls');
    const wallsButton = viewer.locator('[data-view="walls"]');
    assert.equal(await wallsButton.textContent(), 'Show cutaway walls');
    assert.equal(await wallsButton.getAttribute('aria-pressed'), 'true');
    await wallsButton.click();
    assert.equal((await stats()).fullWalls, false, 'cutaway remains available');
    assert.equal(await wallsButton.textContent(), 'Show full walls');
    await wallsButton.click();
    assert.equal((await stats()).fullWalls, true);
    checks.push('full walls by default with an optional cutaway toggle');
    await page.waitForTimeout(250); const settled = (await stats()).renderCount;
    await page.waitForTimeout(350); assert.equal((await stats()).renderCount, settled, 'overview stops rendering when idle');
    checks.push('public overview renders and sleeps when idle');
    await viewer.getByRole('button', { name: 'Walk through', exact: true }).click();
    await wait(() => window.__walkViewer.getStats().walking);
    assert.equal((await stats()).walkFloor, 0); assert.ok(Math.abs((await stats()).cameraPosition[1] - 1.65) < .001);
    const groundStart = (await stats()).cameraPosition;
    assert.ok(Math.abs(groundStart[0]) > .7, 'walkthrough starts in a clear room, away from the central doorway');
    assert.equal(await viewer.getByLabel('View floor').inputValue(), '0');
    assert.equal(await wallsButton.isEnabled(), false);
    assert.equal(await viewer.getByRole('group', { name: 'Walkthrough movement' }).isVisible(), true);
    await holdUntil('d', () => window.__walkViewer.getStats().cameraPosition[0] > .6);
    checks.push('keyboard movement crosses the doorway at eye level');
    const canvas = viewer.locator('canvas'), box = await canvas.boundingBox();
    await page.keyboard.down('w');
    await page.mouse.move(box.x + box.width * .45, box.y + box.height * .45); await page.mouse.down();
    await page.mouse.move(box.x + box.width * .6, box.y + box.height * .5, { steps: 6 }); await page.mouse.up();
    assert.ok((await stats()).pressedKeys.includes('w'), 'releasing look preserves held movement'); await page.keyboard.up('w');
    const heading = (await stats()).cameraRotation;
    assert.ok(Math.abs(heading[1]) > .1);
    await page.setViewportSize({ width: 1220, height: 920 }); await page.waitForTimeout(180);
    assert.deepEqual((await stats()).cameraRotation, heading, 'resize preserves the walkthrough heading');
    await viewer.getByRole('button', { name: 'Expand 3D view', exact: true }).click(); await page.waitForTimeout(180);
    assert.deepEqual((await stats()).cameraRotation, heading);
    await canvas.press('Escape'); await wait(() => !window.__walkViewer.getStats().walking);
    assert.equal(await page.locator('.fp-view-expanded').count(), 1, 'first Escape exits walking, keeping the large view');
    await page.keyboard.press('Escape'); assert.equal(await page.locator('.fp-view-expanded').count(), 0);
    assert.ok((await stats()).cameraPosition.every((value,i)=>Math.abs(value-overview.cameraPosition[i])<1e-9),
      'overview camera position is restored within floating-point precision');
    assert.equal((await stats()).fullWalls, true, 'exit walkthrough restores full walls');
    checks.push('drag look, resize, expansion, Escape and overview restoration');
    await viewer.getByRole('button', { name: 'Walk through', exact: true }).click();
    await holdUntil('w', () => window.__walkViewer.getStats().cameraPosition[2] < -2);
    // The north exterior wall is at z=-2.7432 metres; maintain body clearance.
    await page.keyboard.down('w'); await page.waitForTimeout(900); await page.keyboard.up('w');
    const stopped = (await stats()).cameraPosition[2];
    assert.ok(stopped > -2.7432 && stopped < -2, 'solid exterior wall stops movement');
    await viewer.getByLabel('View floor').selectOption('1');
    const upper = await stats(); assert.equal(upper.walkFloor, 1);
    assert.ok(Math.abs(upper.cameraPosition[1] - (10.75 * .3048 + 1.65)) < .001);
    assert.ok(Math.abs(upper.cameraPosition[0] - groundStart[0] - 3 * .3048) < .001);
    assert.ok(Math.abs(upper.cameraPosition[2] - groundStart[2] + 2 * .3048) < .001);
    await viewer.getByRole('button', { name: 'Restart walkthrough', exact: true }).click();
    assert.deepEqual((await stats()).cameraPosition, upper.cameraPosition);
    checks.push('wall collision, floor switching, floor offsets and restart');
    await page.waitForTimeout(180); const idle = (await stats()).renderCount;
    await page.waitForTimeout(350); assert.equal((await stats()).renderCount, idle, 'walkthrough sleeps when idle');
    await page.keyboard.down('w'); await wait(() => window.__walkViewer.getStats().pressedKeys.includes('w'));
    await viewer.getByRole('button', { name: 'Exit walkthrough', exact: true }).focus(); await page.keyboard.up('w');
    assert.deepEqual((await stats()).pressedKeys, [], 'moving focus clears held movement');
    await viewer.screenshot({ path: path.join(work, 'walkthrough-desktop.png') });
    checks.push('idle scheduling and focus cleanup');
    await page.setViewportSize({ width: 390, height: 844 });
    await viewer.getByRole('button', { name: 'Restart walkthrough', exact: true }).click();
    await viewer.scrollIntoViewIfNeeded();
    const beforeTouch = (await stats()).cameraPosition[0];
    const touch = viewer.getByRole('button', { name: 'Walk right', exact: true });
    const touchBox = await touch.boundingBox();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchBox.x + touchBox.width / 2, y: touchBox.y + touchBox.height / 2, id: 77 }] });
    await page.waitForFunction(x => window.__walkViewer.getStats().cameraPosition[0] > x, beforeTouch + .12, { timeout: 15000 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
    assert.ok((await stats()).cameraPosition[0] > beforeTouch + .1);
    assert.deepEqual((await stats()).pressedKeys, []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile layout fits');
    await viewer.screenshot({ path: path.join(work, 'walkthrough-mobile.png') });
    checks.push('mobile movement buttons and layout');
    const download = page.waitForEvent('download'); await viewer.getByRole('button', { name: 'Save image', exact: true }).click();
    const image = await download; const imagePath = path.join(work, 'walkthrough-capture.png'); await image.saveAs(imagePath);
    assert.ok(fs.statSync(imagePath).size > 1000);
    checks.push('walkthrough image export');
    await viewer.getByRole('button', { name: 'Exit walkthrough', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1080 });
    for (const route of ['/listing/' + listing.id, '/project/' + project.id]) {
      await page.goto(base + route); await viewer.locator('canvas[data-engine="three"]').waitFor();
      assert.equal((await stats()).fullWalls, true, 'listing and portfolio viewers start with full walls');
      await viewer.getByRole('button', { name: 'Walk through', exact: true }).click();
      await wait(() => window.__walkViewer.getStats().walking);
    }
    checks.push('walkthrough available on listings, portfolio and 3D showcases');
    assert.deepEqual(network, [], 'walkthrough does not call FLRplanner or local services');
    assert.deepEqual(errors, []);
    const report = { pass: true, checks, browserErrors: errors, localServiceRequests: network };
    fs.writeFileSync(path.join(work, 'walkthrough-browser-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (error) {
    if (page) { await page.screenshot({ path: path.join(work, 'walkthrough-failure.png') }).catch(() => {}); console.error(JSON.stringify({ errors, checks, stats: await page.evaluate(() => window.__walkViewer?.getStats()).catch(() => null) })); }
    throw error;
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve)); clean();
  }
}
function clean() {
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(work + path.sep) || !path.basename(resolved).startsWith('walkthrough-test-')) throw Error('Unexpected test cleanup path');
  fs.rmSync(resolved, { recursive: true, force: true });
}
run().catch(error => { console.error(error); process.exitCode = 1; });
