'use strict';

function upcomingHomeMarkup() {
  const projects = state.listings.filter(item => item.status === 'upcoming');
  const featured = projects.filter(item => item.featured);
  const upcoming = (featured.length ? featured : projects).slice(0, 3);
  return `<section class="upcoming-section"><div class="container"><div class="section-top"><div><h2 class="section-heading small">Upcoming projects</h2><p>Explore planned homes, estimated pricing, and their proposed layouts.</p></div><a class="btn btn-outline" href="/upcoming-projects" data-link>Explore upcoming projects</a></div>${upcoming.length ? `<div class="listing-grid">${upcoming.map(listingCard).join('')}</div>` : '<p class="muted">New project plans will appear here as they are announced.</p>'}</div></section>`;
}

function renderUpcomingProjects() {
  state.currentListing = null;
  document.title = `Upcoming projects — ${state.settings.brandName}`;
  setMeta('Explore upcoming homes in Madurai, estimated prices, locations, expected completion and interactive 3D floor plans.');
  const projects = state.listings.filter(item => item.status === 'upcoming').sort((a, b) => Number(b.featured) - Number(a.featured) || new Date(b.publishedAt) - new Date(a.publishedAt));
  main.innerHTML = `<section class="page-hero"><div class="container"><h1>Upcoming projects</h1><p>See what we are planning next. Explore locations, estimated prices, and proposed homes in 3D before construction begins.</p><p class="upcoming-price-note">Prices, layouts and completion dates are estimates and may change as plans develop.</p></div></section><section class="all-listings"><div class="container"><div class="results-meta"><span>${projects.length} ${projects.length === 1 ? 'upcoming project' : 'upcoming projects'}</span></div><div class="listing-grid">${projects.length ? projects.map(listingCard).join('') : '<div class="empty-state"><h2>New projects are being planned.</h2><p>Contact us for upcoming locations and launch details.</p>' + contactButtons() + '</div>'}</div></div></section>`;
}

function adminListingRow(listing) {
  const upcoming = listing.status === 'upcoming';
  return `<article class="admin-listing"><img src="${escapeHtml(listing.mainImage)}" alt=""><div><div class="admin-listing-flags">${listing.featured ? '<span>Homepage</span>' : ''}<span>${upcoming ? 'Upcoming' : listing.status === 'ready' ? 'Ready' : 'Building'}</span>${upcoming && listing.floorPlan ? `<span>${listing.floorPlan.published ? '3D model published' : '3D model draft'}</span>` : ''}</div><h3>${escapeHtml(listing.title)}</h3><p>${escapeHtml(listing.location)} · ${upcoming ? 'Est. ' : ''}${formatPrice(listing.price)}</p><small>${upcoming && listing.expectedCompletion ? 'Expected ' + escapeHtml(listing.expectedCompletion) : 'Updated ' + formatDate(listing.updatedAt)}</small></div><div class="admin-listing-actions"><a class="btn btn-outline btn-small" href="/listing/${encodeURIComponent(listing.id)}" data-link>View</a><button class="btn btn-outline btn-small" type="button" data-edit="${escapeHtml(listing.id)}">Edit</button><button class="btn btn-danger btn-small" type="button" data-delete="${escapeHtml(listing.id)}">Delete</button></div></article>`;
}

function updateUpcomingFields() {
  const upcoming = document.querySelector('#status').value === 'upcoming';
  document.querySelector('[data-upcoming-fields]').hidden = !upcoming;
  document.querySelector('label[for="price"]').textContent = upcoming ? 'Estimated price (INR)' : 'Price in INR';
  document.querySelector('#location').required = upcoming;
  document.querySelector('#price').min = upcoming ? '1' : '0';
  document.querySelector('#price').step = upcoming ? '1' : '10000';
}
