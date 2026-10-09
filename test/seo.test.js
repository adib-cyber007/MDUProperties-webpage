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
  const json = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const offer = json['@graph'].find(item => item['@type'] === 'Offer');
  assert.equal(offer.price, 4500000);
  assert.equal(offer.itemOffered.floorSize.value, 1100);
});

test('unknown pages are 404 and the owner page is not indexed', () => {
  assert.equal(seo.describePage('/listing/missing', store, origin).status, 404);
  assert.equal(seo.describePage('/random', store, origin).robots, 'noindex, follow');
  assert.equal(seo.describePage('/admin', store, origin).robots, 'noindex, nofollow');
});

test('sitemap, robots and inline photos are served for crawlers', () => {
  const sitemap = seo.sitemapXml(store, origin);
  for (const loc of ['/', '/listings', '/listing/max-towers', '/listing/soon', '/project/done-house']) assert.ok(sitemap.includes(`<loc>${origin}${loc}</loc>`), loc);
  assert.match(seo.robotsTxt(origin), /Disallow: \/admin\nDisallow: \/api\/\n\nSitemap: https:\/\/example.test\/sitemap.xml/);
  assert.equal(seo.decodeMedia(store, '/media/project/done-house/0.png').body.toString(), 'fake-png');
  assert.equal(seo.decodeMedia(store, '/media/project/done-house/0.webp'), null);
  assert.equal(seo.decodeMedia(store, '/media/listing/soon/0.png'), null);
});
