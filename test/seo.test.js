'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const seo = require('../seo');

const pixel = 'data:image/png;base64,' + Buffer.from('fake-png').toString('base64');
const store = {
  settings: { brandName: 'Madurai Dream Properties', phone: '+91 98423 46313', whatsapp: '919585595590' },
  listings: [
    { id: 'max-towers', title: 'Max Towers', location: 'Vilangudi, Madurai', area: '1,100 sq ft', price: 4500000, status: 'ready', description: '<p>Corner <b>house</b> & garden</p>', mainImage: pixel, gallery: [], updatedAt: '2026-10-01T00:00:00Z' },
    { id: 'soon', title: 'Soon Homes', location: 'Madurai', price: 6000000, status: 'upcoming', mainImage: '/mark.svg', gallery: [] }
  ],
  projects: [{ id: 'done-house', title: '3BHK House', completedYear: 2025, location: 'Sikandar Savadi, Madurai', mainImage: pixel, gallery: [] }],
  models: []
};
const origin = 'https://example.test';

test('listing pages carry crawlable title, description, canonical, image and structured data', () => {
  const page = seo.describePage('/listing/max-towers', store, origin);
  assert.equal(page.status, 200);
  assert.match(page.title, /Max Towers, Vilangudi, Madurai — House for sale ₹45 lakh/);
  assert.match(page.description, /Corner house & garden/);
  assert.equal(page.image, 'https://example.test/media/listing/max-towers/0.png');
  const html = seo.renderHtml(page, origin);
  assert.match(html, /<link rel="canonical" href="https:\/\/example.test\/listing\/max-towers">/);
  assert.match(html, /<h1>Max Towers<\/h1>/);
  assert.equal((html.match(/<title>/g) || []).length, 1);
  assert.equal((html.match(/name="description"/g) || []).length, 1);
  const json = JSON.parse(html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)[1]);
  const offer = json['@graph'].find(item => item['@type'] === 'Offer');
  assert.equal(offer.price, 4500000);
  assert.equal(offer.itemOffered.floorSize.value, 1100);
  const unusualTitle = 'A $& $1 <Home>';
  const unusualPage = seo.describePage('/listing/max-towers', { ...store, listings: [{ ...store.listings[0], title: unusualTitle }] }, origin);
  const unusualHtml = seo.renderHtml(unusualPage, origin);
  assert.ok(unusualHtml.includes('<h1>A $&amp; $1 &lt;Home&gt;</h1>'));
  assert.ok(unusualHtml.includes('<title>A $&amp; $1 &lt;Home&gt;,'));
});

test('unknown pages are 404 and the owner page is not indexed', () => {
  assert.equal(seo.describePage('/listing/missing', store, origin).status, 404);
  assert.equal(seo.describePage('/random', store, origin).robots, 'noindex, follow');
  assert.equal(seo.describePage('/admin', store, origin).robots, 'noindex, nofollow');
});

test('sitemap, robots and inline photos are served for crawlers', () => {
  const sitemap = seo.sitemapXml(store, origin);
  for (const loc of ['/', '/listings', '/listing/max-towers', '/listing/soon', '/project/done-house']) assert.ok(sitemap.includes(`<loc>${origin}${loc}</loc>`), loc);
  const robots = seo.robotsTxt(origin);
  assert.match(robots, /Disallow: \/admin\nDisallow: \/api\//);
  for (const endpoint of ['settings', 'listings', 'projects', 'models']) assert.ok(robots.includes(`Allow: /api/${endpoint}\n`));
  assert.ok(robots.includes(`Sitemap: ${origin}/sitemap.xml`));
  assert.equal(seo.decodeMedia(store, '/media/project/done-house/0.png').body.toString(), 'fake-png');
  assert.equal(seo.decodeMedia(store, '/media/project/done-house/0.webp'), null);
  assert.equal(seo.decodeMedia(store, '/media/listing/soon/0.png'), null);
});

test('published 3D models are discoverable without exposing draft names or URLs', () => {
  const data = { ...store, models: [
    { id: 'published-house', title: 'Published house', location: 'Madurai', description: 'Reviewed layout', floorPlan: { published: true } },
    { id: 'private-house', title: 'Private house', floorPlan: { published: false } }
  ] };
  for (const content of [seo.sitemapXml(data, origin), seo.describePage('/3d-projects', data, origin).body]) {
    assert.ok(content.includes('/3d-project/published-house')); assert.ok(!content.includes('private-house'));
  }
  assert.equal(seo.describePage('/3d-project/private-house', data, origin).status, 404);
  assert.match(seo.describePage('/3d-project/published-house', data, origin).body, /Reviewed layout/);
});

test('SEO reads are shared and expire, saves invalidate them, and owner sign-in avoids storage', async t => {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdu-seo-test-'));
  fs.mkdirSync(path.join(dir, 'public'));
  for (const file of ['server.js', 'seo.js', 'telegram-bot.js', 'public/page-seo.js', 'public/index.html', 'public/floor-plan-geometry.js']) fs.copyFileSync(path.join(__dirname, '..', file), path.join(dir, file));
  for (const key of ['VERCEL', 'TELEGRAM_BOT_TOKEN', 'SITE_URL']) delete process.env[key];
  process.env.NODE_ENV = 'production'; process.env.ADMIN_PASSWORD = 'seo-unit-test';
  process.env.SUPABASE_URL = 'https://seo-store.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  const nativeFetch = global.fetch, now = Date.now;
  let reads = 0, fail = false, data = structuredClone(store);
  global.fetch = async (url, options = {}) => {
    if (!String(url).startsWith('https://seo-store.invalid/')) return nativeFetch(url, options);
    if (fail) return new Response('{}', { status: 503 });
    if (options.method === 'POST') { data = JSON.parse(options.body)[0].data; return new Response(null, { status: 201 }); }
    ++reads; await new Promise(resolve => setTimeout(resolve, 15));
    return new Response(JSON.stringify([{ data }]), { status: 200 });
  };
  const server = require(path.join(dir, 'server.js'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { global.fetch = nativeFetch; Date.now = now; await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const owner = await fetch(base + '/admin'); assert.equal(owner.status, 200); assert.equal(reads, 0);
  assert.equal(owner.headers.get('x-robots-tag'), 'noindex, nofollow');
  await fetch(base + '/robots.txt'); assert.equal(reads, 0);
  const pages = await Promise.all(['/listings', '/upcoming-projects', '/portfolio', '/sitemap.xml'].map(route => fetch(base + route)));
  assert.ok(pages.every(response => response.status === 200)); assert.equal(reads, 1, 'concurrent public pages share one query');
  assert.match(await (await fetch(base + '/listing/max-towers')).text(), /Max Towers/); assert.equal(reads, 1);
  assert.equal((await fetch(base + '/missing')).status, 404);
  const publicApi = await fetch(base + '/api/listings'); assert.equal(reads, 2, 'public APIs still read current data');
  assert.equal(publicApi.headers.get('x-robots-tag'), 'noindex');
  Date.now = () => now() + 16000;
  await fetch(base + '/listings'); assert.equal(reads, 3, 'another instance update becomes visible after expiry');
  Date.now = now;
  const login = await fetch(base + '/api/login', { method: 'POST', body: JSON.stringify({ password: 'seo-unit-test' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0]; assert.equal(reads, 3);
  await fetch(base + '/api/admin/data', { headers: { cookie } }); assert.equal(reads, 4, 'owner dashboard bypasses SEO cache');
  const saved = await fetch(base + '/api/admin/listings/max-towers', { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Updated house' }) });
  assert.equal(saved.status, 200); assert.equal(reads, 5);
  assert.match(await (await fetch(base + '/listings')).text(), /Updated house/); assert.equal(reads, 6, 'save invalidates public SEO immediately');
  fail = true; Date.now = () => now() + 32000;
  const unavailable = await fetch(base + '/listings'); assert.equal(unavailable.status, 503);
  assert.doesNotMatch(await unavailable.text(), /Willow|Yelahanka|Lake Edge/);
  assert.equal((await fetch(base + '/admin')).status, 200, 'sign-in remains available during a storage outage');
  assert.equal((await fetch(base + '/sitemap.xml')).status, 503);
});
