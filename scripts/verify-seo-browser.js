'use strict';
// Crawl and navigate an isolated site, including unavailable public resources.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), work = path.join(root, 'work');
fs.mkdirSync(work, { recursive: true });
const dir = fs.mkdtempSync(path.join(work, 'seo-browser-test-'));
fs.cpSync(path.join(root, 'public'), path.join(dir, 'public'), { recursive: true });
for (const file of ['server.js', 'seo.js', 'telegram-bot.js']) fs.copyFileSync(path.join(root, file), path.join(dir, file));
for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL', 'TELEGRAM_BOT_TOKEN', 'SITE_URL', 'FLOORPLAN_RECOGNITION_URL']) delete process.env[key];
process.env.NODE_ENV = 'production'; process.env.ADMIN_PASSWORD = 'seo-browser-test';
const server = require(path.join(dir, 'server.js'));
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=';
const floorPlan = { version: 1, published: true, image: pixel, scaleConfirmed: true, width: 24, depth: 20, height: 10, thickness: .5,
  walls: [{ kind: 'wall', a: [.1, .1], b: [.9, .1] }], furniture: [] };
async function run() {
  let browser, page;
  const checks = [], errors = [];
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    assert.equal((await context.request.post(base + '/api/login', { data: { password: process.env.ADMIN_PASSWORD } })).status(), 200);
    const create = async (endpoint, data, key) => { const response = await context.request.post(base + endpoint, { data }); assert.equal(response.status(), 201, await response.text()); return (await response.json())[key]; };
    const upcoming = await create('/api/admin/listings', { title: 'Vaigai planned villas', status: 'upcoming', location: 'Madurai', price: 8200000, expectedCompletion: 'Q4 2027', mainImage: pixel, floorPlan }, 'listing');
    const model = await create('/api/admin/models', { title: 'Published courtyard', description: 'Reviewed 3D layout', floorPlan }, 'model');
    const draft = await create('/api/admin/models', { title: 'Private courtyard', floorPlan: { ...floorPlan, published: false } }, 'model');
    const sitemap = await (await context.request.get(base + '/sitemap.xml')).text();
    assert.ok(sitemap.includes('/3d-project/' + model.id)); assert.ok(!sitemap.includes(draft.id));
    const modelHtml = await (await context.request.get(base + '/3d-projects')).text();
    assert.ok(modelHtml.includes('/3d-project/' + model.id)); assert.ok(!modelHtml.includes(draft.title));
    assert.equal((await context.request.get(base + '/3d-project/' + draft.id)).status(), 404);
    const media = await context.request.get(base + '/media/listing/' + upcoming.id + '/0.png');
    assert.equal(media.status(), 200); assert.equal(media.headers()['content-type'], 'image/png');
    const head = await context.request.head(base + '/listing/' + upcoming.id);
    assert.equal(head.status(), 200); assert.equal((await head.body()).length, 0);
    checks.push('initial HTML, sitemap and image URLs expose published content and omit private models');

    const robots = await (await context.request.get(base + '/robots.txt')).text();
    const rules = robots.split('\n').map(line => line.match(/^(Allow|Disallow):\s*(\S+)$/)).filter(Boolean);
    const allowed = pathname => rules.filter(rule => pathname.startsWith(rule[2])).sort((a, b) => b[2].length - a[2].length || (a[1] === 'Allow' ? -1 : 1))[0]?.[1] !== 'Disallow';
    for (const endpoint of ['/api/settings', '/api/listings', '/api/projects', '/api/models']) assert.ok(allowed(endpoint), endpoint);
    for (const endpoint of ['/admin', '/api/admin/data', '/api/login', '/api/session']) assert.equal(allowed(endpoint), false, endpoint);
    page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => allowed(new URL(route.request().url()).pathname) ? route.continue() : route.abort('blockedbyclient'));
    await page.goto(base + '/upcoming-projects');
    await page.locator('.listing-card').filter({ hasText: upcoming.title }).waitFor();
    assert.equal(await page.locator('.seo-prerender').count(), 0, 'Google-allowed API requests render the interactive page');
    await page.unroute('**/api/**');
    checks.push('robots allows required public data and prevents owner/API discovery');

    async function metadata(route, robotsValue = 'index, follow') {
      assert.equal(new URL(page.url()).pathname, route);
      assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), base + route);
      assert.equal(await page.locator('meta[property="og:url"]').getAttribute('content'), base + route);
      assert.equal(await page.locator('meta[property="og:title"]').getAttribute('content'), await page.title());
      assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), robotsValue);
      assert.equal(await page.locator('link[rel="canonical"]').count(), 1);
      assert.equal(await page.locator('meta[name="description"]').count(), 1);
      assert.equal(await page.locator('script[data-page-seo]').count(), robotsValue.startsWith('noindex') ? 0 : 1);
    }
    await metadata('/upcoming-projects');
    await page.getByRole('link', { name: upcoming.title, exact: true }).click();
    await page.getByRole('heading', { name: upcoming.title, exact: true }).waitFor();
    await metadata('/listing/' + upcoming.id);
    const graph = JSON.parse(await page.locator('script[data-page-seo]').textContent());
    assert.equal(graph['@graph'].find(item => item['@type'] === 'Offer').price, 8200000);
    await page.goBack(); await page.getByRole('heading', { name: 'Upcoming projects', exact: true }).waitFor();
    await metadata('/upcoming-projects');
    await page.goto(base + '/admin'); await page.getByRole('heading', { name: 'Your homes', exact: true }).waitFor();
    await metadata('/admin', 'noindex, nofollow');
    await page.locator('#site-header').getByRole('link', { name: 'Home', exact: true }).click();
    await page.locator('.upcoming-section').waitFor(); await metadata('/');
    checks.push('navigation, history and owner-to-public transitions refresh canonical, robots, previews and schema');

    await page.route('**/api/**', route => route.abort('blockedbyclient'));
    await page.goto(base + '/listing/' + upcoming.id); await page.locator('.seo-connection-error').waitFor();
    assert.ok(await page.locator('.seo-prerender').first().getByRole('heading', { name: upcoming.title, exact: true }).isVisible());
    assert.equal(await page.getByRole('heading', { name: 'Couldn’t load.', exact: true }).count(), 0);
    await metadata('/listing/' + upcoming.id);
    await page.unroute('**/api/**'); await page.locator('#retry').click();
    await page.locator('.detail-hero').waitFor(); assert.equal(await page.locator('.seo-connection-error').count(), 0);
    checks.push('blocked or failed public requests preserve readable HTML and recover on retry');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/upcoming-projects'); await page.locator('.listing-card').waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(work, 'seo-mobile.png'), fullPage: true });
    checks.push('mobile public page fits screen');
    assert.deepEqual(errors, []);
    const report = { pass: true, checks, browserErrors: errors };
    fs.writeFileSync(path.join(work, 'seo-browser-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } catch (error) {
    await page?.screenshot({ path: path.join(work, 'seo-browser-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
