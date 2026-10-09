'use strict';
// Server-rendered search metadata and crawlable content for the single-page site.
// The browser app replaces <main> on load, so visitors see the same UI as before;
// search engines and link previews get real titles, descriptions, text and links.

const fs = require('node:fs');
const path = require('node:path');

const INDEX_FILE = path.join(__dirname, 'public', 'index.html');
let indexTemplate = null;

function template() {
  if (indexTemplate === null) indexTemplate = fs.readFileSync(INDEX_FILE, 'utf8');
  return indexTemplate;
}

const { esc, plainText, describePage } = require('./public/page-seo');

function siteOrigin(req) {
  const configured = String(process.env.SITE_URL || '').trim().replace(/\/+$/, '');
  if (/^https?:\/\/[^\s/]+$/i.test(configured)) return configured;
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = (forwardedHost || req.headers.host || 'localhost').replace(/[^\w.:-]/g, '');
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = forwardedProto === 'http' || (local && !forwardedProto) ? 'http' : 'https';
  return `${proto}://${host}`;
}

const imageTypes = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };

function decodeMedia(store, pathname) {
  const match = pathname.match(/^\/media\/(listing|project)\/([^/]+)\/(\d{1,2})\.(webp|jpg|png)$/);
  if (!match) return null;
  const items = match[1] === 'listing' ? store.listings || [] : store.projects || [];
  const item = items.find(entry => entry.id === decodeURIComponent(match[2]));
  const value = item && [item.mainImage, ...(item.gallery || [])][Number(match[3])];
  const data = String(value || '').match(/^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/);
  if (!data || imageTypes[data[1]] !== match[4]) return null;
  return { type: data[1], body: Buffer.from(data[2], 'base64') };
}

function renderHtml(page, origin) {
  const canonical = origin + page.canonicalPath;
  const graph = page.jsonLd.length ? JSON.stringify({ '@context': 'https://schema.org', '@graph': page.jsonLd }).replace(/</g, '\\u003c') : '';
  const head = [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}">`,
    `<meta name="robots" content="${page.robots}">`,
    `<meta name="site-origin" content="${esc(origin)}">`,
    page.status === 200 ? `<link rel="canonical" href="${esc(canonical)}">` : '',
    '<meta property="og:type" content="website">',
    '<meta property="og:locale" content="en_IN">',
    `<meta property="og:title" content="${esc(page.title)}">`,
    `<meta property="og:description" content="${esc(page.description)}">`,
    `<meta property="og:url" content="${esc(canonical)}">`,
    `<meta property="og:image" content="${esc(page.image)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    graph ? `<script type="application/ld+json" data-page-seo>${graph}</script>` : ''
  ].filter(Boolean).join('\n  ');
  return template()
    .replace(/<meta name="description"[^>]*>\s*/i, '')
    .replace(/<title>[\s\S]*?<\/title>/i, () => head)
    .replace(/(<main id="main"[^>]*>)[\s\S]*?(<\/main>)/i, (_, start, end) => start + page.body + end);
}

function robotsTxt(origin) {
  // The app needs these public responses when Google renders its JavaScript.
  return `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nAllow: /api/settings\nAllow: /api/listings\nAllow: /api/projects\nAllow: /api/models\n\nSitemap: ${origin}/sitemap.xml\n`;
}

function sitemapXml(store, origin) {
  const day = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10); };
  const listings = store.listings || [];
  const models = (store.models || []).filter(item => item.floorPlan?.published);
  const latest = [...listings, ...(store.projects || [])].map(item => item.updatedAt || item.publishedAt).filter(Boolean).sort().pop();
  const entries = [
    { loc: '/', lastmod: latest },
    { loc: '/listings', lastmod: latest },
    { loc: '/upcoming-projects' },
    { loc: '/portfolio' },
    ...listings.map(item => ({ loc: `/listing/${encodeURIComponent(item.id)}`, lastmod: item.updatedAt || item.publishedAt })),
    ...(store.projects || []).map(item => ({ loc: `/project/${encodeURIComponent(item.id)}`, lastmod: item.updatedAt || item.createdAt }))
  ];
  if (models.length) entries.push({ loc: '/3d-projects' }, ...models.map(item => ({ loc: `/3d-project/${encodeURIComponent(item.id)}`, lastmod: item.updatedAt || item.createdAt })));
  const urls = entries.map(entry => `  <url><loc>${esc(origin + entry.loc)}</loc>${entry.lastmod && day(entry.lastmod) ? `<lastmod>${day(entry.lastmod)}</lastmod>` : ''}</url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

module.exports = { decodeMedia, describePage, renderHtml, robotsTxt, sitemapXml, siteOrigin, plainText };
