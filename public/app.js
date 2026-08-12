'use strict';

const state = {
  settings: null,
  listings: [],
  currentListing: null,
  filters: { status: 'all', location: 'all', price: 'all', sort: 'newest' },
  admin: { tab: 'listings', data: null, editing: null, gallery: [], mainImage: '', progress: [] }
};

const main = document.querySelector('#main');
const header = document.querySelector('#site-header');
const footer = document.querySelector('#site-footer');
const floating = document.querySelector('#floating-contact');
const modalRoot = document.querySelector('#modal-root');

const icon = (name) => {
  const icons = {
    arrow: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8.6 3.6 6.8 2.9a2 2 0 0 0-2.4.8L3.2 5.5c-.6.9-.6 2-.1 2.9 2.7 5.4 7.1 9.7 12.4 12.4.9.5 2.1.4 2.9-.1l1.8-1.2a2 2 0 0 0 .8-2.4l-.7-1.8a2 2 0 0 0-2.3-1.2l-2.1.5a2 2 0 0 1-1.8-.5l-4.3-4.3a2 2 0 0 1-.5-1.8l.5-2.1a2 2 0 0 0-1.2-2.3Z" stroke="currentColor" stroke-width="1.6"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="1" stroke="currentColor" stroke-width="1.7"/><path d="m4 7 8 6 8-6" stroke="currentColor" stroke-width="1.7"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.7 11.8a8.7 8.7 0 0 1-12.9 7.6L3 20.7l1.3-4.6a8.7 8.7 0 1 1 16.4-4.3Z" stroke="currentColor" stroke-width="1.7"/><path d="M8.2 7.4c.2-.4.4-.4.7-.4h.4c.1 0 .3.1.4.4l.8 2c.1.2.1.4-.1.6l-.6.8c-.1.1-.1.3 0 .5.4.8 1.7 2.1 2.7 2.6.2.1.3.1.5-.1l.9-1c.2-.2.4-.2.6-.1l2 .9c.2.1.3.3.3.5 0 .6-.3 1.4-.8 1.8-.5.5-1.2.8-2.2.6-1.1-.2-2.5-.8-4.3-2.4-2.3-2.1-3-4.2-3.1-5.1 0-.7.2-1.2.5-1.6.4-.5.8-.7 1.3 0Z" fill="currentColor"/></svg>',
    zoom: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.6" stroke="currentColor" stroke-width="1.7"/><path d="m16 16 4.4 4.4M10.8 7.8v6M7.8 10.8h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
  };
  return icons[name] || '';
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function formatPrice(price) {
  const value = Number(price || 0);
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(value % 10000000 ? 2 : 0)} Cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(value % 100000 ? 1 : 0)} L`;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
}

function formatDate(date) {
  if (!date) return '';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(date));
}

function phoneHref(phone) { return `tel:${String(phone || '').replace(/[^+\d]/g, '')}`; }
function whatsappHref(listingTitle = '') {
  const message = listingTitle ? `Hi, I'm interested in ${listingTitle}. Could you share more details?` : "Hi, I'd like to know more about your available homes.";
  return `https://wa.me/${state.settings?.whatsapp || ''}?text=${encodeURIComponent(message)}`;
}

function emailHref(listingTitle = '') {
  if (!state.settings?.email) return '';
  const subject = listingTitle ? `Enquiry about ${listingTitle}` : `Property enquiry for ${state.settings.brandName}`;
  return `mailto:${state.settings.email}?subject=${encodeURIComponent(subject)}`;
}

function contactButtons(listingTitle = '', light = false) {
  const buttons = [];
  if (state.settings?.whatsapp) buttons.push(`<a class="btn ${light ? 'btn-bronze' : ''}" href="${whatsappHref(listingTitle)}" target="_blank" rel="noreferrer">${icon('whatsapp')} WhatsApp</a>`);
  if (state.settings?.phone) buttons.push(`<a class="btn ${light ? 'btn-light' : 'btn-outline'}" href="${phoneHref(state.settings.phone)}">${icon('phone')} Call now</a>`);
  if (state.settings?.email) buttons.push(`<a class="btn ${light ? 'btn-light' : 'btn-outline'}" href="${emailHref(listingTitle)}">${icon('mail')} Email</a>`);
  return buttons.join('');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) throw new Error(payload.error || 'The request could not be completed.');
  return payload;
}

function toast(message) {
  const item = document.createElement('div');
  item.className = 'toast';
  item.textContent = message;
  document.querySelector('#toast-region').append(item);
  setTimeout(() => item.remove(), 3600);
}

function navigate(path) {
  if (location.pathname !== path) history.pushState({}, '', path);
  renderRoute();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function brandMarkup() {
  return `<a class="brand" href="/" data-link aria-label="${escapeHtml(state.settings?.brandName || 'Madurai Dream Properties')} home">
    <img src="/mark.svg" alt="" width="34" height="34">
    <span><strong>${escapeHtml(state.settings?.brandName || 'Madurai Dream Properties')}</strong><span>Owner-managed properties</span></span>
  </a>`;
}

function renderChrome() {
  const adminRoute = location.pathname.startsWith('/admin');
  header.className = 'site-header';
  header.innerHTML = `<div class="header-inner">
    ${brandMarkup()}
    <button class="menu-toggle" type="button" aria-label="Open menu" aria-expanded="false"><span></span><span></span></button>
    <nav class="site-nav" aria-label="Main navigation">
      <a href="/" data-link class="${location.pathname === '/' ? 'active' : ''}">Home</a>
      <a href="/listings" data-link class="${location.pathname.startsWith('/listing') ? 'active' : ''}">Available homes</a>
      ${state.settings.email ? `<a href="mailto:${escapeHtml(state.settings.email)}">${escapeHtml(state.settings.email)}</a>` : ''}
      ${state.settings.phone ? `<a class="header-call" href="${phoneHref(state.settings.phone)}">${escapeHtml(state.settings.phone)}</a>` : ''}
      ${adminRoute ? '<a href="/admin" data-link class="active">Owner</a>' : ''}
    </nav>
  </div>`;

  footer.innerHTML = `<div class="container">
    <div class="footer-grid">
      <div>${brandMarkup()}<p>Newly built homes, planned and delivered with care. Every listing is managed directly by our team.</p></div>
      <div class="footer-column"><h3>Explore</h3><a href="/listings" data-link>Available homes</a><a href="/#approach" data-scroll>Our approach</a><a href="/admin" data-link>Owner sign in</a></div>
      <div class="footer-column"><h3>Contact</h3>${state.settings.phone ? `<a href="${phoneHref(state.settings.phone)}">${escapeHtml(state.settings.phone)}</a>` : ''}${state.settings.email ? `<a href="mailto:${escapeHtml(state.settings.email)}">${escapeHtml(state.settings.email)}</a>` : ''}${state.settings.whatsapp ? `<a href="${whatsappHref(state.currentListing?.title)}" target="_blank" rel="noreferrer">WhatsApp us</a>` : ''}${state.settings.instagram ? `<a href="${escapeHtml(state.settings.instagram)}" target="_blank" rel="noreferrer">Instagram</a>` : ''}${state.settings.officeAddress ? `<address>${escapeHtml(state.settings.officeAddress)}</address>` : ''}</div>
    </div>
    <div class="footer-bottom"><span>© ${new Date().getFullYear()} ${escapeHtml(state.settings.brandName)}.</span><span>Owner-managed · Direct enquiries</span></div>
  </div>`;
  floating.innerHTML = state.settings.whatsapp ? `<div class="mobile-contact-dock" aria-label="Quick contact"><a href="${phoneHref(state.settings.phone)}" aria-label="Call ${escapeHtml(state.settings.phone)}">${icon('phone')}<span>Call</span></a><a href="${whatsappHref(state.currentListing?.title)}" target="_blank" rel="noreferrer" aria-label="Chat about ${escapeHtml(state.currentListing?.title || 'available homes')} on WhatsApp">${icon('whatsapp')}<span>WhatsApp</span></a></div><a class="floating-whatsapp" href="${whatsappHref(state.currentListing?.title)}" target="_blank" rel="noreferrer" aria-label="Chat about ${escapeHtml(state.currentListing?.title || 'available homes')} on WhatsApp">${icon('whatsapp')}<span>WhatsApp us</span></a>` : '';

  const toggle = header.querySelector('.menu-toggle');
  toggle.addEventListener('click', () => {
    const nav = header.querySelector('.site-nav');
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  });
}

function badges(listing) {
  const items = [listing.status === 'ready'
    ? '<span class="badge badge-ready">Ready for sale</span>'
    : '<span class="badge badge-building">Under construction</span>'];
  if (listing.trustBadge === 'verified') items.push('<span class="badge badge-trust">Verified listing</span>');
  if (listing.trustBadge === 'direct') items.push('<span class="badge badge-trust">Direct from builder</span>');
  if (listing.tags?.isNew) items.push('<span class="badge badge-new">New listing</span>');
  if (listing.tags?.isUpdated) items.push('<span class="badge badge-updated">Recently updated</span>');
  return items.join('');
}

function listingCard(listing) {
  return `<article class="listing-card reveal">
    <a class="card-image" href="/listing/${encodeURIComponent(listing.id)}" data-link aria-label="View ${escapeHtml(listing.title)}">
      <img src="${escapeHtml(listing.mainImage)}" alt="Exterior of ${escapeHtml(listing.title)} in ${escapeHtml(listing.location)}" width="800" height="650" loading="lazy">
      <div class="card-badges">${badges(listing)}</div>
    </a>
    <div class="card-body">
      <p class="card-location">${escapeHtml(listing.location)}</p>
      <div class="card-title-row"><h3 class="card-title"><a href="/listing/${encodeURIComponent(listing.id)}" data-link>${escapeHtml(listing.title)}</a></h3><p class="card-price">${formatPrice(listing.price)}</p></div>
      <div class="card-meta"><span>${escapeHtml(listing.area)}</span><span>${listing.status === 'ready' ? 'Available now' : 'Build in progress'}</span><a href="/listing/${encodeURIComponent(listing.id)}" data-link aria-label="View details for ${escapeHtml(listing.title)}">View details ${icon('arrow')}</a></div>
    </div>
  </article>`;
}

function renderHome() {
  state.currentListing = null;
  const selectedFeatured = state.listings.filter(item => item.featured);
  const featured = (selectedFeatured.length ? selectedFeatured : state.listings).slice(0, 3);
  const heroListing = featured[0] || state.listings[0];
  const heroVisual = heroListing ? `<a class="hero-visual" href="/listing/${encodeURIComponent(heroListing.id)}" data-link aria-label="View ${escapeHtml(heroListing.title)}">
      <img src="${escapeHtml(heroListing.mainImage)}" alt="${escapeHtml(heroListing.title)}, a newly built home in ${escapeHtml(heroListing.location)}" width="1400" height="1200">
      <div class="hero-caption"><span>${heroListing.status === 'ready' ? 'Ready to visit' : 'Now in progress'}</span><strong>${escapeHtml(heroListing.title)} · ${escapeHtml(heroListing.location)}</strong></div>
    </a>` : `<div class="hero-visual hero-visual-empty">
      <img src="https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1600&q=82" alt="A thoughtfully designed contemporary home" width="1400" height="1200">
      <div class="hero-caption"><span>Portfolio update</span><strong>New owner-listed homes are coming soon.</strong></div>
    </div>`;
  document.title = `${state.settings.brandName} — Owner-managed property listings`;
  setMeta('Explore verified, owner-managed property listings with direct WhatsApp and phone contact.');
  main.innerHTML = `<section class="hero">
    <div class="hero-copy reveal">
      <span class="eyebrow">Owner-led property service</span>
      <h1>Homes with <em>room to live.</em></h1>
      <p>Newly built residences shaped by light, landscape, and practical family life. See every detail, speak directly with the owner team.</p>
      <div class="hero-actions"><a class="btn" href="/listings" data-link>Browse available homes ${icon('arrow')}</a><a class="btn btn-outline" href="${whatsappHref()}" target="_blank" rel="noreferrer">Ask on WhatsApp</a></div>
    </div>
    ${heroVisual}
  </section>
  <section class="trust-strip" aria-label="How we work"><div class="trust-strip-inner">
    <div class="trust-point"><span>01</span><div><strong>One accountable builder</strong><small>No brokers or third-party listings</small></div></div>
    <div class="trust-point"><span>02</span><div><strong>Current build information</strong><small>Dated progress and verified status</small></div></div>
    <div class="trust-point"><span>03</span><div><strong>Direct conversations</strong><small>Call or message the owner team</small></div></div>
  </div></section>
  <section class="listings-section"><div class="container">
    <div class="section-top"><div><span class="eyebrow">Available now</span><h2 class="section-heading small">A small, considered collection.</h2></div><a class="btn btn-outline" href="/listings" data-link>See all homes ${icon('arrow')}</a></div>
    <div class="listing-grid">${featured.length ? featured.map(listingCard).join('') : '<div class="empty-state"><h2>New homes are being prepared.</h2><p>Contact the owner directly to hear about upcoming availability.</p></div>'}</div>
  </div></section>
  <section id="approach" class="philosophy"><div class="container philosophy-grid">
    <div><span class="eyebrow">How we build</span><h2>Quiet choices. Enduring homes.</h2></div>
    <div class="principles">
      <article class="principle"><span>A</span><div><h3>Climate before fashion</h3><p>Shade, cross-ventilation, and daylight lead every plan. Materials follow.</p></div></article>
      <article class="principle"><span>B</span><div><h3>Clarity at every stage</h3><p>Progress photographs, status, specification, and pricing stay current.</p></div></article>
      <article class="principle"><span>C</span><div><h3>Fewer, better homes</h3><p>A deliberately small portfolio lets our team stay close to the work and the people buying it.</p></div></article>
    </div>
  </div></section>
  <section class="contact-band"><div class="container contact-band-inner"><div><span class="eyebrow">Begin a conversation</span><h2>Looking for your next home?</h2><p>Tell us the neighbourhood, size, and timeline you have in mind. You’ll speak with someone who knows each home first-hand.</p></div><div class="contact-actions">${contactButtons()}</div></div></section>`;
}

function renderListings() {
  state.currentListing = null;
  document.title = `Available homes — ${state.settings.brandName}`;
  setMeta('Browse owner-managed homes. Filter by build status, neighbourhood, and price.');
  const locations = [...new Set(state.listings.map(item => item.location))].sort();
  main.innerHTML = `<section class="page-hero"><div class="container"><span class="eyebrow">The collection</span><h1>Find a home that fits.</h1><p>Every property here is managed directly by our team. Filter the collection, then call or message us for plans, specifications, and a visit.</p></div></section>
  <section class="filter-bar" aria-label="Listing filters"><form class="container filters" id="filter-form">
    <div class="field compact"><label for="filter-status">Build status</label><select id="filter-status" name="status"><option value="all">All homes</option><option value="ready">Ready for sale</option><option value="construction">Under construction</option></select></div>
    <div class="field compact"><label for="filter-location">Location</label><select id="filter-location" name="location"><option value="all">All locations</option>${locations.map(loc => `<option value="${escapeHtml(loc)}">${escapeHtml(loc)}</option>`).join('')}</select></div>
    <div class="field compact"><label for="filter-price">Price</label><select id="filter-price" name="price"><option value="all">Any price</option><option value="20000000">Up to ₹2 Cr</option><option value="30000000">Up to ₹3 Cr</option><option value="30000001">Above ₹3 Cr</option></select></div>
    <div class="field compact"><label for="filter-sort">Sort</label><select id="filter-sort" name="sort"><option value="newest">Newest first</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option></select></div>
    <button class="btn btn-outline btn-small" id="clear-filters" type="button">Clear</button>
  </form></section>
  <section class="all-listings"><div class="container"><div class="results-meta"><span id="result-count"></span><span>Prices shown are owner-listed</span></div><div class="listing-grid" id="listing-results"></div></div></section>`;
  const form = document.querySelector('#filter-form');
  Object.entries(state.filters).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value; });
  form.addEventListener('change', () => {
    state.filters = Object.fromEntries(new FormData(form));
    drawFilteredListings();
  });
  form.querySelector('#clear-filters').addEventListener('click', () => {
    form.reset();
    state.filters = { status: 'all', location: 'all', price: 'all', sort: 'newest' };
    drawFilteredListings();
  });
  drawFilteredListings();
}

function drawFilteredListings() {
  let results = [...state.listings];
  const { status, location, price, sort } = state.filters;
  if (status !== 'all') results = results.filter(item => item.status === status);
  if (location !== 'all') results = results.filter(item => item.location === location);
  if (price !== 'all') results = price === '30000001' ? results.filter(item => item.price >= 30000001) : results.filter(item => item.price <= Number(price));
  if (sort === 'price-asc') results.sort((a, b) => a.price - b.price);
  else if (sort === 'price-desc') results.sort((a, b) => b.price - a.price);
  else results.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  document.querySelector('#result-count').textContent = `${results.length} ${results.length === 1 ? 'home' : 'homes'} found`;
  document.querySelector('#listing-results').innerHTML = results.length ? results.map(listingCard).join('') : `<div class="empty-state"><h2>No homes match these filters.</h2><p>Clear the filters to see the full collection.</p><button class="btn btn-outline" type="button" id="empty-clear">Clear filters</button></div>`;
  document.querySelector('#empty-clear')?.addEventListener('click', () => document.querySelector('#clear-filters').click());
}

function renderListing(id) {
  const listing = state.listings.find(item => item.id === id);
  if (!listing) return renderNotFound();
  state.currentListing = listing;
  document.title = `${listing.title} — ${state.settings.brandName}`;
  const plainDescription = listing.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  setMeta(`${listing.title} in ${listing.location}. ${plainDescription.slice(0, 120)}`);
  const allGallery = listing.gallery || [];
  const galleryMarkup = allGallery.length ? `<section class="gallery-section"><div class="container"><div class="gallery-header"><div><span class="eyebrow">Inside the home</span><h2>Gallery</h2></div><p class="muted">${listing.zoomEnabled ? 'Select an image to view it full screen.' : `${allGallery.length} photographs`}</p></div><div class="gallery-grid count-${Math.min(allGallery.length, 3)} ${listing.zoomEnabled ? 'zoomable' : ''}">${allGallery.map((src, index) => `<button class="gallery-item" type="button" ${listing.zoomEnabled ? `data-lightbox-index="${index}"` : 'disabled'} aria-label="${listing.zoomEnabled ? `Open photograph ${index + 1}` : `Photograph ${index + 1}`}"><img src="${escapeHtml(src)}" alt="${escapeHtml(listing.title)} photograph ${index + 1}" loading="lazy">${listing.zoomEnabled ? `<span class="zoom-cue">${icon('zoom')}</span>` : ''}</button>`).join('')}</div></div></section>` : '';
  const timelineMarkup = listing.status === 'construction' && listing.progress?.length ? `<section class="timeline-section"><div class="container"><span class="eyebrow">Dated from site</span><h2>Construction progress</h2><p class="timeline-intro">A visible record of how the home is taking shape. Contact us for the current programme or a supervised site visit.</p><div class="timeline" style="--count:${listing.progress.length}">${listing.progress.map(item => `<article class="timeline-item"><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.stage)} construction progress" loading="lazy"><time datetime="${escapeHtml(item.date)}">${formatDate(item.date)}</time><h3>${escapeHtml(item.stage)}</h3></article>`).join('')}</div></div></section>` : '';
  const mapMarkup = listing.mapPin ? `<section class="map-section" aria-label="Map showing ${escapeHtml(listing.address || listing.location)}"><iframe title="Map of ${escapeHtml(listing.address || listing.location)}" loading="lazy" src="https://www.google.com/maps?q=${encodeURIComponent(listing.mapPin)}&output=embed" referrerpolicy="no-referrer-when-downgrade"></iframe></section>` : '';
  main.innerHTML = `<article>
    <header class="detail-hero"><img src="${escapeHtml(listing.mainImage)}" alt="Exterior of ${escapeHtml(listing.title)} in ${escapeHtml(listing.location)}" width="1800" height="1100"><div class="detail-hero-content"><div class="card-badges">${badges(listing)}</div><h1>${escapeHtml(listing.title)}</h1><p class="detail-hero-place">${escapeHtml(listing.address || listing.location)}</p></div></header>
    <section class="container detail-summary"><div><div class="detail-facts"><div class="detail-fact"><span>Asking price</span><strong>${formatPrice(listing.price)}</strong></div><div class="detail-fact"><span>Built area</span><strong>${escapeHtml(listing.area)}</strong></div><div class="detail-fact"><span>Availability</span><strong>${listing.status === 'ready' ? 'Ready now' : 'In progress'}</strong></div></div><span class="eyebrow">About this home</span><div class="prose">${listing.description}</div></div>
      <aside class="detail-aside"><span class="detail-aside-label">Direct owner contact</span><h2>See it first-hand.</h2><p>Ask for the floor plan, full specification, or arrange a visit directly with our team.</p>${contactButtons(listing.title)}</aside>
    </section>
    ${galleryMarkup}${timelineMarkup}${mapMarkup}
    <section class="bottom-contact"><div class="container bottom-contact-inner"><div><h2>Would you like to walk through?</h2><p>Visits are arranged directly with the owner team. No broker hand-off.</p></div><div class="bottom-contact-actions">${contactButtons(listing.title, true)}</div></div></section>
  </article>`;
  renderChrome();
  if (listing.zoomEnabled) document.querySelectorAll('[data-lightbox-index]').forEach(button => button.addEventListener('click', () => openLightbox(allGallery, Number(button.dataset.lightboxIndex), listing.title)));
}

function openLightbox(images, startIndex, title) {
  let index = startIndex;
  const draw = () => {
    modalRoot.innerHTML = `<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Image gallery"><div class="lightbox"><button class="modal-close" type="button" aria-label="Close gallery">✕</button><img src="${escapeHtml(images[index])}" alt="${escapeHtml(title)} photograph ${index + 1} of ${images.length}">${images.length > 1 ? '<button class="modal-nav prev" type="button" aria-label="Previous photograph">←</button><button class="modal-nav next" type="button" aria-label="Next photograph">→</button>' : ''}</div></div>`;
    document.body.classList.add('no-scroll');
    modalRoot.querySelector('.modal-close').focus();
    modalRoot.querySelector('.modal-close').onclick = closeModal;
    modalRoot.querySelector('.modal-backdrop').onclick = event => { if (event.target.classList.contains('modal-backdrop')) closeModal(); };
    modalRoot.querySelector('.prev')?.addEventListener('click', () => { index = (index - 1 + images.length) % images.length; draw(); });
    modalRoot.querySelector('.next')?.addEventListener('click', () => { index = (index + 1) % images.length; draw(); });
  };
  draw();
}

function closeModal() { modalRoot.innerHTML = ''; document.body.classList.remove('no-scroll'); }

function renderNotFound() {
  state.currentListing = null;
  document.title = `Page not found — ${state.settings.brandName}`;
  main.innerHTML = `<section class="not-found"><div><span class="eyebrow">Page not found</span><h1>404</h1><p class="muted">This address does not point to a current home or page.</p><a class="btn" href="/listings" data-link>Browse available homes</a></div></section>`;
}

async function renderAdmin() {
  state.currentListing = null;
  document.title = `Owner dashboard — ${state.settings.brandName}`;
  const session = await api('/api/session');
  if (!session.authenticated) return renderLogin();
  state.admin.data = await api('/api/admin/data');
  renderAdminShell();
}

function renderLogin() {
  main.innerHTML = `<section class="admin-page"><div class="login-wrap"><form class="login-card" id="login-form">${brandMarkup()}<span class="eyebrow">Owner access</span><h1>Welcome back.</h1><p class="muted">Sign in to manage listings and contact details.</p><div id="login-error"></div><div class="field"><label for="owner-password">Password</label><input id="owner-password" name="password" type="password" autocomplete="current-password" required></div><button class="btn" style="width:100%;margin-top:18px" type="submit">Open dashboard ${icon('arrow')}</button><p class="login-note">Local demo password: <strong>aaranya-demo</strong>. Set <code>ADMIN_PASSWORD</code> before deploying.</p></form></div></section>`;
  document.querySelector('#login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      await api('/api/login', { method: 'POST', body: JSON.stringify({ password: event.currentTarget.password.value }) });
      await renderAdmin();
      toast('Signed in.');
    } catch (error) { document.querySelector('#login-error').innerHTML = `<p class="error-message">${escapeHtml(error.message)}</p>`; }
    finally { button.disabled = false; }
  });
}

function renderAdminShell() {
  main.innerHTML = `<section class="admin-page"><div class="admin-shell"><aside class="admin-sidebar"><h2>Owner dashboard</h2><nav class="admin-nav" aria-label="Dashboard"><button type="button" data-admin-tab="listings">Listings</button><button type="button" data-admin-tab="settings">Contact & tags</button></nav><button class="btn btn-light btn-small" id="admin-logout" type="button">Sign out</button></aside><div class="admin-content" id="admin-content"></div></div></section>`;
  document.querySelectorAll('[data-admin-tab]').forEach(button => button.addEventListener('click', () => {
    state.admin.tab = button.dataset.adminTab;
    state.admin.editing = null;
    drawAdminTab();
  }));
  document.querySelector('#admin-logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); state.admin.data = null; renderLogin(); toast('Signed out.'); });
  drawAdminTab();
}

function drawAdminTab() {
  document.querySelectorAll('[data-admin-tab]').forEach(button => button.classList.toggle('active', button.dataset.adminTab === state.admin.tab));
  if (state.admin.tab === 'settings') drawSettingsForm();
  else if (state.admin.editing !== null) drawListingForm(state.admin.editing);
  else drawAdminListings();
}

function drawAdminListings() {
  const listings = state.admin.data.listings;
  const readyCount = listings.filter(item => item.status === 'ready').length;
  const buildCount = listings.length - readyCount;
  const featuredCount = listings.filter(item => item.featured).length;
  document.querySelector('#admin-content').innerHTML = `<div class="admin-top"><div><span class="eyebrow">Portfolio overview</span><h1>Your homes</h1><p>Manage every detail buyers see on the public site.</p></div><button class="btn" id="add-listing" type="button">Add a listing</button></div><div class="admin-stats"><div><span>Published</span><strong>${listings.length}</strong></div><div><span>Ready for sale</span><strong>${readyCount}</strong></div><div><span>In progress</span><strong>${buildCount}</strong></div><div><span>Homepage</span><strong>${featuredCount}</strong></div></div><div class="admin-panel"><div class="admin-list">${listings.map(listing => `<article class="admin-listing"><img src="${escapeHtml(listing.mainImage)}" alt=""><div><div class="admin-listing-flags">${listing.featured ? '<span>Homepage</span>' : ''}<span>${listing.status === 'ready' ? 'Ready' : 'Building'}</span></div><h3>${escapeHtml(listing.title)}</h3><p>${escapeHtml(listing.location)} · ${formatPrice(listing.price)}</p><small>Updated ${formatDate(listing.updatedAt)}</small></div><div class="admin-listing-actions"><a class="btn btn-outline btn-small" href="/listing/${encodeURIComponent(listing.id)}" data-link>View</a><button class="btn btn-outline btn-small" type="button" data-edit="${escapeHtml(listing.id)}">Edit</button><button class="btn btn-danger btn-small" type="button" data-delete="${escapeHtml(listing.id)}">Delete</button></div></article>`).join('')}</div></div>`;
  document.querySelector('#add-listing').onclick = () => { state.admin.editing = 'new'; drawAdminTab(); };
  document.querySelectorAll('[data-edit]').forEach(button => button.onclick = () => { state.admin.editing = button.dataset.edit; drawAdminTab(); });
  document.querySelectorAll('[data-delete]').forEach(button => button.onclick = () => confirmDelete(button.dataset.delete));
}

function confirmDelete(id) {
  const listing = state.admin.data.listings.find(item => item.id === id);
  modalRoot.innerHTML = `<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="delete-title"><div class="confirm-card"><h2 id="delete-title">Delete this listing?</h2><p>“${escapeHtml(listing.title)}” will be removed from the public site. This cannot be undone.</p><div class="confirm-actions"><button class="btn btn-outline" type="button" id="cancel-delete">Keep listing</button><button class="btn btn-danger" type="button" id="confirm-delete">Delete</button></div></div></div>`;
  document.body.classList.add('no-scroll');
  document.querySelector('#cancel-delete').onclick = closeModal;
  document.querySelector('#confirm-delete').onclick = async () => {
    try {
      await api(`/api/admin/listings/${encodeURIComponent(id)}`, { method: 'DELETE' });
      state.admin.data = await api('/api/admin/data');
      state.listings = (await api('/api/listings')).listings;
      closeModal(); drawAdminListings(); toast('Listing deleted.');
    } catch (error) { toast(error.message); }
  };
}

function drawListingForm(id) {
  const isNew = id === 'new';
  const listing = isNew ? { title: '', area: '', location: '', address: '', mapPin: '', price: '', status: 'ready', trustBadge: '', description: '<p></p>', mainImage: '', gallery: [], zoomEnabled: true, featured: false, progress: [] } : state.admin.data.listings.find(item => item.id === id);
  if (!listing) { state.admin.editing = null; return drawAdminListings(); }
  state.admin.mainImage = listing.mainImage || '';
  state.admin.gallery = [...(listing.gallery || [])];
  state.admin.progress = (listing.progress || []).map(item => ({ ...item }));
  document.querySelector('#admin-content').innerHTML = `<div class="admin-top"><div><h1>${isNew ? 'Add a home' : 'Edit home'}</h1><p>${isNew ? 'Publish a new listing to the collection.' : `Changes will add an Updated tag for ${state.admin.data.settings.updatedDays} days.`}</p></div></div>
  <form class="admin-panel" id="listing-form"><div id="form-error"></div><div class="form-grid">
    <div class="field full"><label for="title">Listing title</label><input id="title" name="title" value="${escapeHtml(listing.title)}" required maxlength="90"></div>
    <div class="field"><label for="area">Housing area</label><input id="area" name="area" value="${escapeHtml(listing.area)}" placeholder="e.g. 3,200 sq ft"></div>
    <div class="field"><label for="price">Price in INR</label><input id="price" name="price" type="number" min="0" step="10000" value="${escapeHtml(listing.price)}" required></div>
    <div class="field"><label for="location">Area / neighbourhood</label><input id="location" name="location" value="${escapeHtml(listing.location)}" placeholder="Whitefield, Bengaluru"></div>
    <div class="field"><label for="status">Build status</label><select id="status" name="status"><option value="ready" ${listing.status === 'ready' ? 'selected' : ''}>Ready for sale</option><option value="construction" ${listing.status === 'construction' ? 'selected' : ''}>Under construction</option></select></div>
    <div class="field full"><label for="address">Full address</label><input id="address" name="address" value="${escapeHtml(listing.address)}"></div>
    <div class="field full"><label for="mapPin">Map pin or place search</label><input id="mapPin" name="mapPin" value="${escapeHtml(listing.mapPin)}" placeholder="Paste coordinates or enter an address"><small>Leave blank to hide the map.</small></div>
    <div class="field"><label for="trustBadge">Trust badge</label><select id="trustBadge" name="trustBadge"><option value="">No trust badge</option><option value="verified" ${listing.trustBadge === 'verified' ? 'selected' : ''}>Verified listing</option><option value="direct" ${listing.trustBadge === 'direct' ? 'selected' : ''}>Direct from builder</option></select></div>
    <div class="field toggle-field"><input id="featured" name="featured" type="checkbox" ${listing.featured ? 'checked' : ''}><label for="featured">Show on homepage</label></div>
  </div>
  <div class="form-section"><h2>Description</h2><p>Describe the plan, materials, readiness, and practical details in a clear voice.</p></div>
  <div class="editor-toolbar" aria-label="Text formatting"><button type="button" data-command="bold" title="Bold"><strong>B</strong></button><button type="button" data-command="italic" title="Italic"><em>I</em></button><button type="button" data-command="insertUnorderedList" title="Bulleted list">• List</button></div><div class="rich-editor" id="description" contenteditable="true" role="textbox" aria-multiline="true">${listing.description}</div>
  <div class="form-section"><h2>Photography</h2><p>Uploads are resized and compressed to WebP in your browser before saving.</p></div>
  <div class="form-grid"><div class="field full"><span>Main hero image</span><div class="upload-zone"><input id="main-image-upload" type="file" accept="image/*"><small>Recommended: landscape, at least 1600px wide.</small><div class="image-previews" id="main-preview"></div></div></div>
  <div class="field full"><span>Image gallery</span><div class="upload-zone"><input id="gallery-upload" type="file" accept="image/*" multiple><small>Add up to 16 images. Existing images stay until removed.</small><div class="image-previews" id="gallery-previews"></div></div></div>
  <div class="field toggle-field full"><input id="zoomEnabled" name="zoomEnabled" type="checkbox" ${listing.zoomEnabled ? 'checked' : ''}><label for="zoomEnabled">Enable full-screen zoom when a visitor selects a gallery image</label></div></div>
  <div class="form-section" id="progress-heading"><h2>Construction progress</h2><p>Shown only while the listing is marked Under construction. Add dated stages in order.</p></div><div class="progress-editor" id="progress-editor"></div><button class="btn btn-outline btn-small" type="button" id="add-progress">Add progress stage</button>
  <div class="form-actions"><button class="btn btn-outline" type="button" id="cancel-listing">Cancel</button><button class="btn" type="submit">${isNew ? 'Publish listing' : 'Save changes'}</button></div></form>`;
  drawImagePreviews();
  drawProgressEditor();
  updateProgressVisibility();
  document.querySelector('#status').addEventListener('change', updateProgressVisibility);
  document.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', () => { document.execCommand(button.dataset.command, false); document.querySelector('#description').focus(); }));
  document.querySelector('#main-image-upload').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    try { state.admin.mainImage = await compressImage(file, 1900, .82); drawImagePreviews(); toast('Main image optimized.'); } catch (error) { toast(error.message); }
  });
  document.querySelector('#gallery-upload').addEventListener('change', async event => {
    const files = [...event.target.files].slice(0, 16 - state.admin.gallery.length);
    try { for (const file of files) state.admin.gallery.push(await compressImage(file, 1600, .78)); drawImagePreviews(); toast(`${files.length} ${files.length === 1 ? 'image' : 'images'} optimized.`); } catch (error) { toast(error.message); }
  });
  document.querySelector('#add-progress').onclick = () => { state.admin.progress.push({ stage: '', date: new Date().toISOString().slice(0, 10), image: '' }); drawProgressEditor(); };
  document.querySelector('#cancel-listing').onclick = () => { state.admin.editing = null; drawAdminTab(); };
  document.querySelector('#listing-form').addEventListener('submit', event => saveListing(event, listing, isNew));
}

function updateProgressVisibility() {
  const visible = document.querySelector('#status')?.value === 'construction';
  document.querySelector('#progress-heading')?.toggleAttribute('hidden', !visible);
  document.querySelector('#progress-editor')?.toggleAttribute('hidden', !visible);
  document.querySelector('#add-progress')?.toggleAttribute('hidden', !visible);
}

function drawImagePreviews() {
  const mainPreview = document.querySelector('#main-preview');
  const galleryPreview = document.querySelector('#gallery-previews');
  if (mainPreview) mainPreview.innerHTML = state.admin.mainImage ? `<div class="image-preview"><img src="${escapeHtml(state.admin.mainImage)}" alt="Main image preview"><button type="button" data-remove-main aria-label="Remove main image">×</button></div>` : '<small>No main image selected.</small>';
  if (galleryPreview) galleryPreview.innerHTML = state.admin.gallery.length ? state.admin.gallery.map((src, index) => `<div class="image-preview"><img src="${escapeHtml(src)}" alt="Gallery preview ${index + 1}"><button type="button" data-remove-gallery="${index}" aria-label="Remove image ${index + 1}">×</button></div>`).join('') : '<small>No gallery images yet.</small>';
  document.querySelector('[data-remove-main]')?.addEventListener('click', () => { state.admin.mainImage = ''; drawImagePreviews(); });
  document.querySelectorAll('[data-remove-gallery]').forEach(button => button.addEventListener('click', () => { state.admin.gallery.splice(Number(button.dataset.removeGallery), 1); drawImagePreviews(); }));
}

function drawProgressEditor() {
  const root = document.querySelector('#progress-editor');
  if (!root) return;
  root.innerHTML = state.admin.progress.length ? state.admin.progress.map((item, index) => `<div class="progress-row" data-progress-row="${index}"><div class="field"><label for="stage-${index}">Stage</label><input id="stage-${index}" data-progress-field="stage" value="${escapeHtml(item.stage)}" placeholder="e.g. Structure"></div><div class="field"><label for="date-${index}">Date</label><input id="date-${index}" type="date" data-progress-field="date" value="${escapeHtml(item.date)}"></div><div class="field"><label for="photo-${index}">Progress photo</label><input id="photo-${index}" type="file" accept="image/*" data-progress-photo>${item.image ? '<small>Photo attached · choose another to replace</small>' : '<small>A photo is required to publish this stage</small>'}</div><button class="btn btn-danger btn-small" type="button" data-remove-progress="${index}">Remove</button></div>`).join('') : '<p class="muted">No progress stages added yet.</p>';
  root.querySelectorAll('[data-progress-field]').forEach(input => input.addEventListener('input', () => { state.admin.progress[Number(input.closest('[data-progress-row]').dataset.progressRow)][input.dataset.progressField] = input.value; }));
  root.querySelectorAll('[data-progress-photo]').forEach(input => input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const index = Number(input.closest('[data-progress-row]').dataset.progressRow);
    try { state.admin.progress[index].image = await compressImage(file, 1400, .78); drawProgressEditor(); toast('Progress photo optimized.'); } catch (error) { toast(error.message); }
  }));
  root.querySelectorAll('[data-remove-progress]').forEach(button => button.addEventListener('click', () => { state.admin.progress.splice(Number(button.dataset.removeProgress), 1); drawProgressEditor(); }));
}

async function compressImage(file, maxWidth, quality) {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > 18 * 1024 * 1024) throw new Error('This image is larger than 18 MB. Choose a smaller file.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
  if (!blob) throw new Error('The image could not be optimized.');
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
}

async function saveListing(event, original, isNew) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  const data = Object.fromEntries(new FormData(form));
  const payload = {
    ...data,
    price: Number(data.price),
    description: document.querySelector('#description').innerHTML,
    mainImage: state.admin.mainImage,
    gallery: state.admin.gallery,
    zoomEnabled: document.querySelector('#zoomEnabled').checked,
    featured: document.querySelector('#featured').checked,
    progress: state.admin.progress
  };
  if (!payload.mainImage) {
    document.querySelector('#form-error').innerHTML = '<p class="error-message">Add a main hero image before publishing.</p>';
    submit.disabled = false;
    return;
  }
  try {
    await api(isNew ? '/api/admin/listings' : `/api/admin/listings/${encodeURIComponent(original.id)}`, { method: isNew ? 'POST' : 'PUT', body: JSON.stringify(payload) });
    state.admin.data = await api('/api/admin/data');
    state.listings = (await api('/api/listings')).listings;
    state.admin.editing = null;
    drawAdminListings();
    toast(isNew ? 'Listing published.' : 'Changes saved.');
  } catch (error) { document.querySelector('#form-error').innerHTML = `<p class="error-message">${escapeHtml(error.message)}</p>`; }
  finally { submit.disabled = false; }
}

function drawSettingsForm() {
  const settings = state.admin.data.settings;
  document.querySelector('#admin-content').innerHTML = `<div class="admin-top"><div><h1>Contact & freshness</h1><p>These details update across every public page.</p></div></div><form class="admin-panel" id="settings-form"><div id="form-error"></div><div class="form-grid">
    <div class="field full"><label for="brandName">Business name</label><input id="brandName" name="brandName" value="${escapeHtml(settings.brandName)}" required></div>
    <div class="field"><label for="whatsapp">WhatsApp number</label><input id="whatsapp" name="whatsapp" value="${escapeHtml(settings.whatsapp)}" inputmode="tel" required><small>Country code + number, digits only.</small></div>
    <div class="field"><label for="phone">Display phone number</label><input id="phone" name="phone" value="${escapeHtml(settings.phone)}" required></div>
    <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" value="${escapeHtml(settings.email)}" placeholder="Optional"><small>Leave blank to hide email links sitewide.</small></div>
    <div class="field"><label for="instagram">Instagram URL</label><input id="instagram" name="instagram" type="url" value="${escapeHtml(settings.instagram)}" placeholder="Optional"><small>Use the full URL for the owner’s actual account.</small></div>
    <div class="field full"><label for="officeAddress">Office address</label><textarea id="officeAddress" name="officeAddress">${escapeHtml(settings.officeAddress)}</textarea></div>
  </div><div class="form-section"><h2>Automatic freshness tags</h2><p>New and Updated tags disappear automatically after the periods below.</p></div><div class="form-grid"><div class="field"><label for="newDays">New listing period (days)</label><input id="newDays" name="newDays" type="number" min="1" max="90" value="${settings.newDays}"></div><div class="field"><label for="updatedDays">Updated period (days)</label><input id="updatedDays" name="updatedDays" type="number" min="1" max="30" value="${settings.updatedDays}"></div></div><div class="form-actions"><button class="btn" type="submit">Save site settings</button></div></form>`;
  document.querySelector('#settings-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
      const payload = Object.fromEntries(new FormData(form));
      const result = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(payload) });
      state.admin.data.settings = result.settings;
      state.settings = result.settings;
      state.listings = (await api('/api/listings')).listings;
      renderChrome();
      toast('Site settings saved.');
    } catch (error) { document.querySelector('#form-error').innerHTML = `<p class="error-message">${escapeHtml(error.message)}</p>`; }
    finally { button.disabled = false; }
  });
}

function setMeta(description) {
  document.querySelector('meta[name="description"]')?.setAttribute('content', description);
}

async function renderRoute() {
  try {
    if (!state.settings) {
      const [settingsData, listingsData] = await Promise.all([api('/api/settings'), api('/api/listings')]);
      state.settings = settingsData.settings;
      state.listings = listingsData.listings;
    }
    const path = decodeURIComponent(location.pathname).replace(/\/+$/, '') || '/';
    renderChrome();
    if (path === '/') renderHome();
    else if (path === '/listings') renderListings();
    else if (path.startsWith('/listing/')) renderListing(path.slice('/listing/'.length));
    else if (path === '/admin') await renderAdmin();
    else renderNotFound();
    renderChrome();
  } catch (error) {
    main.innerHTML = `<section class="not-found"><div><span class="eyebrow">Connection problem</span><h1>Couldn’t load.</h1><p class="muted">${escapeHtml(error.message)}</p><button class="btn" type="button" id="retry">Try again</button></div></section>`;
    document.querySelector('#retry')?.addEventListener('click', () => { state.settings = null; renderRoute(); });
  }
}

document.addEventListener('click', event => {
  const link = event.target.closest('a[data-link]');
  if (link && link.origin === location.origin) {
    event.preventDefault();
    navigate(link.pathname);
    header.querySelector('.site-nav')?.classList.remove('open');
  }
  const scrollLink = event.target.closest('[data-scroll]');
  if (scrollLink && location.pathname === '/') {
    event.preventDefault();
    document.querySelector(scrollLink.hash)?.scrollIntoView({ behavior: 'smooth' });
  }
});

document.addEventListener('keydown', event => { if (event.key === 'Escape' && modalRoot.innerHTML) closeModal(); });
window.addEventListener('popstate', renderRoute);
renderRoute();
