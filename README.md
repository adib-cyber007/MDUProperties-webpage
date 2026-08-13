# Madurai Dream Properties

A complete boutique real-estate listing site with a single-owner dashboard. It runs on Node.js without third-party packages.

## Durable listings with Supabase

Production listings and contact settings live in Supabase's RLS-protected `public.site_store` table. Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as encrypted, server-side Vercel environment variables; the service-role credential must never be exposed to browser code. For local development, copy `.env.example` to `.env.local` and fill in the same values.

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

### Vercel deployment

Vercel detects `server.js` as the Node entrypoint, preserving the public website, API routes, and single-page navigation. The deployment excludes the local `data/store.json` file so production begins with the built-in demonstration collection. On Vercel, that collection runs in instance memory and resets when a function instance restarts. Connect the owner dashboard to durable storage (for example Vercel Blob, Postgres, or Supabase) before relying on published listing changes. Set `ADMIN_PASSWORD` in Vercel’s Production Environment Variables before sharing the owner login. Until that variable is set, owner sign-in is intentionally disabled in production rather than falling back to the local demo password.
