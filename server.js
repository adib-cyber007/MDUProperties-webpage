'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 43821);
const HOST = process.env.HOST || '127.0.0.1';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (process.env.VERCEL ? '' : 'aaranya-demo');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const SESSION_TTL = 12 * 60 * 60 * 1000;
const sessions = new Map();
const loginAttempts = new Map();
let serverlessStore = null;

function isoDaysAgo(days, hour = 10) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function image(id, width = 1600) {
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=82`;
}

function defaultData() {
  return {
    settings: {
      brandName: 'Madurai Dream Properties',
      whatsapp: '919442636313',
      phone: '+91 94426 36313',
      email: '',
      instagram: '',
      officeAddress: '',
      newDays: 14,
      updatedDays: 7
    },
    listings: [
      {
        id: 'courtyard-house',
        title: 'The Courtyard House',
        area: '3,480 sq ft',
        location: 'Whitefield, Bengaluru',
        address: 'ECC Road, Whitefield, Bengaluru, Karnataka',
        mapPin: 'ECC Road, Whitefield, Bengaluru, Karnataka',
        price: 28500000,
        status: 'ready',
        trustBadge: 'direct',
        description: '<p>A calm four-bedroom home planned around a private, tree-lined courtyard. The ground floor keeps living, dining, and the garden visually connected, while the bedrooms sit quietly above.</p><p>Natural stone floors, solid teak details, shaded glazing, and cross-ventilation were selected for Bengaluru’s climate. The home is complete, documented, and available for a private walkthrough.</p><ul><li>Four bedrooms and four-and-a-half baths</li><li>Two covered car parks</li><li>Private landscaped court</li><li>Rainwater harvesting and solar-ready roof</li></ul>',
        mainImage: image('photo-1600585154340-be6161a56a0c'),
        gallery: [
          image('photo-1600607687939-ce8a6c25118c'),
          image('photo-1600566753086-00f18fb6b3ea'),
          image('photo-1600607688969-a5bfcd646154')
        ],
        zoomEnabled: true,
        featured: true,
        progress: [],
        publishedAt: isoDaysAgo(3),
        updatedAt: isoDaysAgo(3)
      },
      {
        id: 'grove-residence',
        title: 'Grove Residence',
        area: '3,120 sq ft',
        location: 'Sarjapur, Bengaluru',
        address: 'Dommasandra, Sarjapur Road, Bengaluru, Karnataka',
        mapPin: 'Dommasandra, Sarjapur Road, Bengaluru, Karnataka',
        price: 23200000,
        status: 'construction',
        trustBadge: 'verified',
        description: '<p>A north-facing family home with broad verandahs, a double-height living room, and a quiet study overlooking the garden. The structure is complete and interior work is now underway.</p><p>Buyers joining at this stage can choose from a considered palette of stone, timber, and joinery finishes with our architect.</p><ul><li>Expected completion: December 2026</li><li>Four bedrooms and dedicated study</li><li>Community of eight independent homes</li><li>Weekly build updates shared directly</li></ul>',
        mainImage: image('photo-1600566753190-17f0baa2a6c3'),
        gallery: [
          image('photo-1600573472550-8090b5e0745e'),
          image('photo-1600210492486-724fe5c67fb0')
        ],
        zoomEnabled: false,
        featured: true,
        progress: [
          { stage: 'Foundation', date: '2026-01-18', image: image('photo-1503387762-592deb58ef4e') },
          { stage: 'Structure', date: '2026-04-26', image: image('photo-1541888946425-d81bb19240f5') },
          { stage: 'Finishing', date: '2026-07-30', image: image('photo-1504307651254-35680f356dfd') }
        ],
        publishedAt: isoDaysAgo(46),
        updatedAt: isoDaysAgo(2)
      },
      {
        id: 'terrace-home',
        title: 'Terrace Home No. 03',
        area: '2,760 sq ft',
        location: 'Jakkur, Bengaluru',
        address: 'Jakkur Plantation, Bengaluru, Karnataka',
        mapPin: 'Jakkur Plantation, Bengaluru, Karnataka',
        price: 19800000,
        status: 'ready',
        trustBadge: 'verified',
        description: '<p>A finished three-bedroom home where every shared room opens to a planted terrace. The plan is compact but never compressed, with daylight brought into the stairwell and upper landing.</p><p>The house is ready to occupy, with built-in wardrobes, a fitted kitchen, landscape, and lighting included.</p>',
        mainImage: image('photo-1600047509807-ba8f99d2cdde'),
        gallery: [
          image('photo-1600607687920-4e2a09cf159d'),
          image('photo-1615874694520-474822394e73')
        ],
        zoomEnabled: true,
        featured: true,
        progress: [],
        publishedAt: isoDaysAgo(21),
        updatedAt: isoDaysAgo(21)
      },
      {
        id: 'lake-edge-villa',
        title: 'Lake Edge Villa',
        area: '4,050 sq ft',
        location: 'Yelahanka, Bengaluru',
        address: 'Rajanukunte, Yelahanka, Bengaluru, Karnataka',
        mapPin: 'Rajanukunte, Yelahanka, Bengaluru, Karnataka',
        price: 34500000,
        status: 'construction',
        trustBadge: 'direct',
        description: '<p>A generous four-bedroom villa set along the quieter edge of a natural lake. Deep overhangs and screened balconies keep the interiors cool while preserving long water views.</p><p>Ground work has begun. The construction programme, material schedule, and legal documents are available during an owner-led consultation.</p>',
        mainImage: image('photo-1600585154526-990dced4db0d'),
        gallery: [image('photo-1600563438938-a9a27216b4f5')],
        zoomEnabled: true,
        featured: false,
        progress: [
          { stage: 'Site preparation', date: '2026-07-12', image: image('photo-1504307651254-35680f356dfd') }
        ],
        publishedAt: isoDaysAgo(8),
        updatedAt: isoDaysAgo(8)
      }
    ]
  };
}

function ensureStore() {
  if (process.env.VERCEL) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) writeStore(defaultData());
}

function readStore() {
  if (process.env.VERCEL) {
    serverlessStore ||= defaultData();
    return serverlessStore;
  }
  ensureStore();
  return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
}

function writeStore(data) {
  if (process.env.VERCEL) {
    serverlessStore = data;
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${STORE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(temp, STORE_FILE);
}

function publicListing(listing, settings) {
  const now = Date.now();
  const published = new Date(listing.publishedAt).getTime();
  const updated = new Date(listing.updatedAt).getTime();
  return {
    ...listing,
    tags: {
      isNew: now - published <= Number(settings.newDays || 14) * 86400000,
      isUpdated: updated > published && now - updated <= Number(settings.updatedDays || 7) * 86400000
    }
  };
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(payload);
}

function readJson(req, maxBytes = 28 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('Request is too large.'), { status: 413 }));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(Object.assign(new Error('Invalid JSON.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(part => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
  }));
}

function getSession(req) {
  const token = cookies(req).aaranya_session;
  const session = token && sessions.get(token);
  if (!session || session.expires < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  return session;
}

function requireAuth(req, res) {
  if (!getSession(req)) {
    sendJson(res, 401, { error: 'Please sign in to continue.' });
    return false;
  }
  return true;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; }
  catch { return false; }
}

function cleanText(value, max = 300) {
  return String(value || '').trim().replace(/[<>]/g, '').slice(0, max);
}

function cleanUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (url.startsWith('data:image/')) return url;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch { return ''; }
}

function cleanDescription(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '')
    .slice(0, 12000);
}

function slugify(title, existing, currentId = '') {
  const base = cleanText(title, 90).toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'listing';
  let slug = base;
  let count = 2;
  while (existing.some(item => item.id === slug && item.id !== currentId)) slug = `${base}-${count++}`;
  return slug;
}

function validateListing(input, existing, current) {
  const title = cleanText(input.title, 90);
  const price = Number(input.price);
  const mainImage = cleanUrl(input.mainImage);
  if (!title || !Number.isFinite(price) || price < 0 || !mainImage) {
    throw Object.assign(new Error('Title, a valid price, and a main image are required.'), { status: 400 });
  }
  const status = input.status === 'construction' ? 'construction' : 'ready';
  const now = new Date().toISOString();
  return {
    id: current?.id || slugify(title, existing),
    title,
    area: cleanText(input.area, 60),
    location: cleanText(input.location, 140),
    address: cleanText(input.address, 240),
    mapPin: cleanText(input.mapPin, 300),
    price,
    status,
    trustBadge: ['verified', 'direct'].includes(input.trustBadge) ? input.trustBadge : '',
    description: cleanDescription(input.description),
    mainImage,
    gallery: Array.isArray(input.gallery) ? input.gallery.map(cleanUrl).filter(Boolean).slice(0, 16) : [],
    zoomEnabled: Boolean(input.zoomEnabled),
    featured: Boolean(input.featured),
    progress: status === 'construction' && Array.isArray(input.progress) ? input.progress.map(item => ({
      stage: cleanText(item.stage, 60),
      date: /^\d{4}-\d{2}-\d{2}$/.test(item.date || '') ? item.date : '',
      image: cleanUrl(item.image)
    })).filter(item => item.stage && item.image).slice(0, 10) : [],
    publishedAt: current?.publishedAt || now,
    updatedAt: current ? now : (input.publishedAt || now)
  };
}

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https://images.unsplash.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; frame-src https://www.google.com; connect-src 'self'"
  };
}

async function handleApi(req, res, url) {
  if (!sameOrigin(req) && !['GET', 'HEAD'].includes(req.method)) return sendJson(res, 403, { error: 'Request origin was rejected.' });
  const store = readStore();

  if (req.method === 'GET' && url.pathname === '/api/listings') {
    return sendJson(res, 200, { listings: store.listings.map(item => publicListing(item, store.settings)) });
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/listings/')) {
    const id = decodeURIComponent(url.pathname.split('/').pop());
    const listing = store.listings.find(item => item.id === id);
    return listing ? sendJson(res, 200, { listing: publicListing(listing, store.settings) }) : sendJson(res, 404, { error: 'Listing not found.' });
  }
  if (req.method === 'GET' && url.pathname === '/api/settings') {
    return sendJson(res, 200, { settings: store.settings });
  }
  if (req.method === 'GET' && url.pathname === '/api/session') {
    return sendJson(res, 200, { authenticated: Boolean(getSession(req)) });
  }
  if (req.method === 'POST' && url.pathname === '/api/login') {
    if (!ADMIN_PASSWORD) return sendJson(res, 503, { error: 'Owner access is not configured. Set ADMIN_PASSWORD in the production environment.' });
    const key = req.socket.remoteAddress || 'local';
    const attempt = loginAttempts.get(key) || { count: 0, reset: 0 };
    if (attempt.reset > Date.now() && attempt.count >= 7) return sendJson(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
    const body = await readJson(req, 2048);
    const supplied = Buffer.from(String(body.password || ''));
    const expected = Buffer.from(ADMIN_PASSWORD);
    const valid = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
    if (!valid) {
      loginAttempts.set(key, { count: attempt.reset > Date.now() ? attempt.count + 1 : 1, reset: Date.now() + 5 * 60 * 1000 });
      return sendJson(res, 401, { error: 'That password is not correct.' });
    }
    loginAttempts.delete(key);
    const token = crypto.randomBytes(32).toString('base64url');
    sessions.set(token, { expires: Date.now() + SESSION_TTL });
    const secure = req.socket.encrypted ? '; Secure' : '';
    return sendJson(res, 200, { authenticated: true }, { 'Set-Cookie': `aaranya_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${secure}` });
  }
  if (req.method === 'POST' && url.pathname === '/api/logout') {
    const token = cookies(req).aaranya_session;
    if (token) sessions.delete(token);
    return sendJson(res, 200, { authenticated: false }, { 'Set-Cookie': 'aaranya_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/data') {
    if (!requireAuth(req, res)) return;
    return sendJson(res, 200, store);
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/listings') {
    if (!requireAuth(req, res)) return;
    const listing = validateListing(await readJson(req), store.listings);
    store.listings.unshift(listing);
    writeStore(store);
    return sendJson(res, 201, { listing: publicListing(listing, store.settings) });
  }
  const listingMatch = url.pathname.match(/^\/api\/admin\/listings\/([^/]+)$/);
  if (listingMatch && req.method === 'PUT') {
    if (!requireAuth(req, res)) return;
    const index = store.listings.findIndex(item => item.id === decodeURIComponent(listingMatch[1]));
    if (index < 0) return sendJson(res, 404, { error: 'Listing not found.' });
    store.listings[index] = validateListing(await readJson(req), store.listings, store.listings[index]);
    writeStore(store);
    return sendJson(res, 200, { listing: publicListing(store.listings[index], store.settings) });
  }
  if (listingMatch && req.method === 'DELETE') {
    if (!requireAuth(req, res)) return;
    const before = store.listings.length;
    store.listings = store.listings.filter(item => item.id !== decodeURIComponent(listingMatch[1]));
    if (store.listings.length === before) return sendJson(res, 404, { error: 'Listing not found.' });
    writeStore(store);
    return sendJson(res, 200, { deleted: true });
  }
  if (req.method === 'PUT' && url.pathname === '/api/admin/settings') {
    if (!requireAuth(req, res)) return;
    const body = await readJson(req, 10240);
    store.settings = {
      brandName: cleanText(body.brandName, 80) || store.settings.brandName,
      whatsapp: cleanText(body.whatsapp, 30).replace(/[^\d]/g, ''),
      phone: cleanText(body.phone, 40),
      email: cleanText(body.email, 120),
      instagram: cleanUrl(body.instagram),
      officeAddress: cleanText(body.officeAddress, 240),
      newDays: Math.min(90, Math.max(1, Number(body.newDays) || 14)),
      updatedDays: Math.min(30, Math.max(1, Number(body.updatedDays) || 7))
    };
    writeStore(store);
    return sendJson(res, 200, { settings: store.settings });
  }
  return sendJson(res, 404, { error: 'API route not found.' });
}

function serveStatic(req, res, url) {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const absolute = path.resolve(PUBLIC_DIR, `.${requested}`);
  const safe = absolute.startsWith(PUBLIC_DIR + path.sep);
  let file = safe && fs.existsSync(absolute) && fs.statSync(absolute).isFile() ? absolute : path.join(PUBLIC_DIR, 'index.html');
  const ext = path.extname(file).toLowerCase();
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
  const stat = fs.statSync(file);
  res.writeHead(200, {
    'Content-Type': types[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': ['.html', '.css', '.js'].includes(ext) ? 'no-cache' : 'public, max-age=3600',
    ...securityHeaders()
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (['GET', 'HEAD'].includes(req.method)) serveStatic(req, res, url);
    else sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    if (!res.headersSent) sendJson(res, error.status || 500, { error: error.status ? error.message : 'Something went wrong on the server.' });
    if (!error.status) console.error(error);
  }
});

if (require.main === module) {
  ensureStore();
  server.listen(PORT, HOST, () => {
    console.log(`Madurai Dream Properties is running at http://${HOST}:${PORT}`);
    if (!process.env.ADMIN_PASSWORD) console.log('Demo owner password: aaranya-demo (set ADMIN_PASSWORD before production use)');
  });
}

module.exports = server;
