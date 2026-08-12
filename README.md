# Madurai Dream Properties

A complete boutique real-estate listing site with a single-owner dashboard. It runs on Node.js without third-party packages.

## Run locally

```powershell
$env:ADMIN_PASSWORD='choose-a-strong-password'
node server.js
```

Open `http://127.0.0.1:43821`. The owner dashboard is at `/admin`. You can choose another port with the `PORT` environment variable.

If `ADMIN_PASSWORD` is not set, the local demo password is `aaranya-demo`. Always set a unique password before making the site publicly accessible.

## Included

- Responsive homepage, filtered listings page, and individual property pages
- Optional per-listing gallery zoom and construction progress timeline
- Server-calculated New Listing and Recently Updated tags
- Verified Listing / Direct from Builder trust badges
- Persistent owner-managed listing and contact data
- Single-owner authentication with HttpOnly, SameSite session cookies and login rate limiting
- Main, gallery, and progress image uploads compressed to WebP before storage
- Rich description editor, sitewide contact settings, WhatsApp-prefilled messages, click-to-call, and email links
- Semantic structure, per-page metadata, alt text, lazy-loaded gallery images, reduced-motion support, and visible keyboard focus

Runtime data is written to `data/store.json` and intentionally ignored by git. Delete that file to restore the seeded demonstration listings on the next start.

## Production notes

Set `ADMIN_PASSWORD`, serve behind HTTPS, back up `data/store.json`, and use durable persistent storage on your host. Image uploads are stored as compressed data URLs; for a much larger inventory, connect the same upload fields to object storage.
