(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PageSEO = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
'use strict';
// Use identical page metadata for initial HTML and browser navigation.

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function plainText(html) {
  return String(html || '')
    .replace(/<\/(p|li|h\d|div)>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(text, max = 158) {
  const value = String(text || '').trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).trim()}…`;
}

function formatPrice(price) {
  const value = Number(price || 0);
  if (!value) return '';
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(value % 10000000 ? 2 : 0)} Cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(value % 100000 ? 1 : 0)} lakh`;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
}

const imageTypes = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };

function mediaUrl(origin, kind, id, index, value) {
  const type = String(value || '').match(/^data:(image\/(?:webp|jpeg|png));base64,/)?.[1];
  return type ? `${origin}/media/${kind}/${encodeURIComponent(id)}/${index}.${imageTypes[type]}` : absoluteUrl(origin, value);
}

function itemImages(origin, kind, item) {
  return [item.mainImage, ...(item.gallery || [])].map((src, index) => mediaUrl(origin, kind, item.id, index, src)).filter(Boolean);
}

function absoluteUrl(origin, value) {
  const url = String(value || '');
  if (/^https:\/\//i.test(url)) return url;
  if (url.startsWith('/') && !url.startsWith('//')) return origin + url;
  return '';
}

const statusLabel = { ready: 'Ready to move in', construction: 'Under construction', upcoming: 'Upcoming project' };

function organization(settings, origin) {
  const org = {
    '@type': 'RealEstateAgent',
    '@id': `${origin}/#business`,
    name: settings.brandName || 'Madurai Dream Properties',
    url: `${origin}/`,
    logo: `${origin}/mark.svg`,
    image: `${origin}/mark.svg`,
    areaServed: { '@type': 'City', name: 'Madurai' },
    address: { '@type': 'PostalAddress', addressLocality: 'Madurai', addressRegion: 'Tamil Nadu', addressCountry: 'IN' }
  };
  if (settings.officeAddress) org.address.streetAddress = settings.officeAddress;
  if (settings.phone) org.telephone = settings.phone;
  if (settings.email) org.email = settings.email;
  const sameAs = [settings.instagram].filter(link => /^https:\/\//i.test(link || ''));
  if (sameAs.length) org.sameAs = sameAs;
  return org;
}

function breadcrumbs(origin, items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: origin + item.path }))
  };
}

function listingCard(listing) {
  const facts = [listing.area, listing.location, statusLabel[listing.status], formatPrice(listing.price) && `${listing.status === 'upcoming' ? 'Estimated ' : ''}${formatPrice(listing.price)}`].filter(Boolean);
  return `<li><a href="/listing/${encodeURIComponent(listing.id)}">${esc(listing.title)}</a> — ${esc(facts.join(' · '))}</li>`;
}

function projectCard(project) {
  const facts = [project.projectType, project.area, project.location, project.completedYear && `Completed ${project.completedYear}`].filter(Boolean);
  return `<li><a href="/project/${encodeURIComponent(project.id)}">${esc(project.title)}</a> — ${esc(facts.join(' · '))}</li>`;
}

function contactBlock(settings) {
  const parts = [];
  if (settings.phone) parts.push(`Call <a href="tel:${esc(settings.phone.replace(/[^\d+]/g, ''))}">${esc(settings.phone)}</a>`);
  if (settings.whatsapp) parts.push(`WhatsApp <a href="https://wa.me/${esc(settings.whatsapp)}">+${esc(settings.whatsapp)}</a>`);
  return parts.length ? `<p>${parts.join(' · ')}</p>` : '';
}

function nav() {
  return '<nav aria-label="Site"><a href="/">Home</a> · <a href="/listings">Available homes</a> · <a href="/upcoming-projects">Upcoming projects</a> · <a href="/portfolio">Previous projects</a></nav>';
}

// Returns { status, title, description, canonicalPath, image, robots, jsonLd, body } for a page path.
function describePage(pathname, store, origin) {
  const settings = store.settings || {};
  const brand = settings.brandName || 'Madurai Dream Properties';
  const listings = store.listings || [];
  const available = listings.filter(item => item.status !== 'upcoming');
  const upcoming = listings.filter(item => item.status === 'upcoming');
  const projects = store.projects || [];
  const org = organization(settings, origin);
  const page = { status: 200, robots: 'index, follow', image: `${origin}/mark.svg` };
  const route = (pathname.replace(/\/+$/, '') || '/');
  const slug = prefix => decodeURIComponent(route.slice(prefix.length));

  if (route === '/') {
    Object.assign(page, {
      canonicalPath: '/',
      title: `${brand} — New Houses for Sale in Madurai`,
      description: clip(`Buy new individual houses and villas in Madurai directly from the builder. ${available.length ? `${available.length} home${available.length === 1 ? '' : 's'} available now` : 'Homes available now'}, ${projects.length ? `${projects.length} completed projects, ` : ''}direct WhatsApp and phone contact.`),
      body: `<h1>${esc(brand)} — new houses for sale in Madurai</h1><p>Owner-managed, newly built individual houses in Madurai, Tamil Nadu, sold directly with no middlemen.</p>${contactBlock(settings)}${available.length ? `<h2>Available homes</h2><ul>${available.map(listingCard).join('')}</ul>` : ''}${upcoming.length ? `<h2>Upcoming projects</h2><ul>${upcoming.map(listingCard).join('')}</ul>` : ''}${projects.length ? `<h2>Previous projects</h2><ul>${projects.map(projectCard).join('')}</ul>` : ''}`,
      jsonLd: [{ '@type': 'WebSite', '@id': `${origin}/#website`, name: brand, url: `${origin}/`, publisher: { '@id': `${origin}/#business` } }, org]
    });
  } else if (route === '/listings') {
    Object.assign(page, {
      canonicalPath: '/listings',
      title: `Houses for Sale in Madurai — ${brand}`,
      description: clip(`Newly built houses for sale in Madurai: ${available.map(item => item.title).slice(0, 4).join(', ') || 'ready and under-construction homes'}. Prices, sizes and direct owner contact.`),
      body: `<h1>Houses for sale in Madurai</h1>${available.length ? `<ul>${available.map(listingCard).join('')}</ul>` : '<p>New homes are listed here as soon as they are ready.</p>'}${contactBlock(settings)}`,
      jsonLd: [org, breadcrumbs(origin, [{ name: 'Home', path: '/' }, { name: 'Available homes', path: '/listings' }]),
        { '@type': 'ItemList', itemListElement: available.map((item, index) => ({ '@type': 'ListItem', position: index + 1, url: `${origin}/listing/${encodeURIComponent(item.id)}`, name: item.title })) }]
    });
  } else if (route === '/upcoming-projects') {
    Object.assign(page, {
      canonicalPath: '/upcoming-projects',
      title: `Upcoming Housing Projects in Madurai — ${brand}`,
      description: clip(`Upcoming new house projects in Madurai by ${brand}. Book early with estimated prices and expected completion dates.`),
      body: `<h1>Upcoming housing projects in Madurai</h1>${upcoming.length ? `<ul>${upcoming.map(listingCard).join('')}</ul>` : '<p>New projects are announced here first.</p>'}${contactBlock(settings)}`,
      jsonLd: [org, breadcrumbs(origin, [{ name: 'Home', path: '/' }, { name: 'Upcoming projects', path: '/upcoming-projects' }])]
    });
  } else if (route === '/portfolio') {
    Object.assign(page, {
      canonicalPath: '/portfolio',
      title: `Completed Houses in Madurai — ${brand} Portfolio`,
      description: clip(`Individual houses ${brand} has built and sold in Madurai${projects.length ? `, including ${projects.slice(0, 3).map(item => item.title).join(', ')}` : ''}.`),
      body: `<h1>Completed houses by ${esc(brand)}</h1>${projects.length ? `<ul>${projects.map(projectCard).join('')}</ul>` : ''}`,
      jsonLd: [org, breadcrumbs(origin, [{ name: 'Home', path: '/' }, { name: 'Previous projects', path: '/portfolio' }])]
    });
  } else if (route.startsWith('/listing/')) {
    const listing = listings.find(item => item.id === slug('/listing/'));
    if (listing) {
      const price = formatPrice(listing.price);
      const text = plainText(listing.description);
      const kind = listing.status === 'upcoming' ? 'Upcoming project' : 'House for sale';
      const canonicalPath = `/listing/${encodeURIComponent(listing.id)}`;
      const images = itemImages(origin, 'listing', listing);
      const residence = { '@type': 'SingleFamilyResidence', name: listing.title, url: origin + canonicalPath, address: { '@type': 'PostalAddress', streetAddress: listing.address || undefined, addressLocality: listing.location || 'Madurai', addressRegion: 'Tamil Nadu', addressCountry: 'IN' } };
      if (text) residence.description = clip(text, 500);
      if (images.length) residence.image = images.slice(0, 6);
      const sqft = Number(String(listing.area || '').replace(/,/g, '').match(/\d+(\.\d+)?/)?.[0]);
      if (sqft) residence.floorSize = { '@type': 'QuantitativeValue', value: sqft, unitCode: 'FTK' };
      Object.assign(page, {
        canonicalPath,
        title: `${listing.title}${listing.location ? `, ${listing.location}` : ''} — ${kind}${price ? ` ${price}` : ''}`,
        description: clip(`${kind}${listing.location ? ` in ${listing.location}` : ' in Madurai'}${listing.area ? `, ${listing.area}` : ''}${price ? `, ${listing.status === 'upcoming' ? 'estimated ' : ''}${price}` : ''}. ${text}`),
        image: images[0] || page.image,
        body: `<article><h1>${esc(listing.title)}</h1><p>${esc([kind, listing.location, listing.area, statusLabel[listing.status], price].filter(Boolean).join(' · '))}</p>${listing.address ? `<p>${esc(listing.address)}</p>` : ''}${text ? `<p>${esc(text)}</p>` : ''}${contactBlock(settings)}</article>`,
        jsonLd: [org, breadcrumbs(origin, [{ name: 'Home', path: '/' }, listing.status === 'upcoming' ? { name: 'Upcoming projects', path: '/upcoming-projects' } : { name: 'Available homes', path: '/listings' }, { name: listing.title, path: canonicalPath }]),
          { '@type': 'Offer', name: listing.title, url: origin + canonicalPath, price: Number(listing.price) || undefined, priceCurrency: 'INR', availability: listing.status === 'ready' ? 'https://schema.org/InStock' : 'https://schema.org/PreOrder', seller: { '@id': `${origin}/#business` }, itemOffered: residence }]
      });
    }
  } else if (route.startsWith('/project/')) {
    const project = projects.find(item => item.id === slug('/project/'));
    if (project) {
      const text = plainText(project.description);
      const canonicalPath = `/project/${encodeURIComponent(project.id)}`;
      const images = itemImages(origin, 'project', project);
      Object.assign(page, {
        canonicalPath,
        title: `${project.title} — Completed ${project.completedYear || ''} by ${brand}`.replace(/\s+/g, ' '),
        description: clip(`${project.projectType || 'House'} completed${project.completedYear ? ` in ${project.completedYear}` : ''}${project.location ? ` at ${project.location}` : ''}${project.area ? `, ${project.area}` : ''}. ${text}`),
        image: images[0] || page.image,
        body: `<article><h1>${esc(project.title)}</h1><p>${esc([project.projectType, project.area, project.location, project.completedYear && `Completed ${project.completedYear}`, 'Sold'].filter(Boolean).join(' · '))}</p>${text ? `<p>${esc(text)}</p>` : ''}</article>`,
        jsonLd: [org, breadcrumbs(origin, [{ name: 'Home', path: '/' }, { name: 'Previous projects', path: '/portfolio' }, { name: project.title, path: canonicalPath }])]
      });
    }
  } else if (route === '/3d-projects' || route.startsWith('/3d-project/')) {
    const models = (store.models || []).filter(item => item.floorPlan?.published);
    const model = route.startsWith('/3d-project/') ? models.find(item => item.id === slug('/3d-project/')) : null;
    if (route === '/3d-projects' || model) {
      Object.assign(page, {
        canonicalPath: model ? `/3d-project/${encodeURIComponent(model.id)}` : '/3d-projects',
        title: model ? `${model.title} — 3D walkthrough — ${brand}` : `3D House Walkthroughs — ${brand}`,
        description: clip(model ? `Explore ${model.title}${model.location ? ` in ${model.location}` : ''} in 3D. ${plainText(model.description)}` : `Walk through ${brand} house designs in 3D before you visit.`),
        body: model ? `<h1>${esc(model.title)}</h1><p>${esc(model.location)}</p><p>${esc(plainText(model.description))}</p>` : `<h1>3D house walkthroughs</h1><ul>${models.map(item => `<li><a href="/3d-project/${encodeURIComponent(item.id)}">${esc(item.title)}</a>${item.location ? ` — ${esc(item.location)}` : ''}</li>`).join('')}</ul>`,
        jsonLd: [org]
      });
    }
  } else if (route === '/admin' || route.startsWith('/admin/')) {
    Object.assign(page, { canonicalPath: '/admin', title: `Owner dashboard — ${brand}`, description: 'Owner sign-in.', robots: 'noindex, nofollow', body: '', jsonLd: [] });
  }

  if (!page.title) {
    Object.assign(page, { status: 404, canonicalPath: route, title: `Page not found — ${brand}`, description: `This page is not available on ${brand}.`, robots: 'noindex, follow', body: '<h1>Page not found</h1><p><a href="/listings">See available homes in Madurai</a></p>', jsonLd: [] });
  }
  page.body = `<div class="seo-prerender">${nav()}${page.body}</div>`;
  return page;
}

function update(pathname, store) {
  const origin = document.querySelector('meta[name="site-origin"]')?.content || location.origin;
  const page = describePage(pathname, store, origin);
  document.title = page.title;
  function meta(attribute, name, content) {
    let node = document.head.querySelector('meta[' + attribute + '="' + name + '"]');
    if (!node) { node = document.createElement('meta'); node.setAttribute(attribute, name); document.head.append(node); }
    node.content = content;
  }
  meta('name', 'description', page.description); meta('name', 'robots', page.robots);
  for (const [key, value] of Object.entries({ type: 'website', locale: 'en_IN', title: page.title, description: page.description, url: origin + page.canonicalPath, image: page.image })) meta('property', 'og:' + key, value);
  meta('name', 'twitter:card', 'summary_large_image');
  let canonical = document.head.querySelector('link[rel="canonical"]');
  if (page.status === 200) {
    if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.append(canonical); }
    canonical.href = origin + page.canonicalPath;
  } else canonical?.remove();
  document.head.querySelector('script[data-page-seo]')?.remove();
  if (page.jsonLd.length) {
    const script = document.createElement('script'); script.type = 'application/ld+json'; script.dataset.pageSeo = '';
    script.textContent = JSON.stringify({ '@context': 'https://schema.org', '@graph': page.jsonLd }); document.head.append(script);
  }
  return page;
}

return { esc, plainText, describePage, update };
});
