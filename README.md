# Madurai Dream Properties

A boutique real-estate listing site with a single-owner dashboard, optional 3D building previews and first-person walkthroughs. A Node.js server serves the site; Three.js is bundled locally and loaded when a 3D view opens.

## Development with Codex Cloud

See [CODEX-CLOUD.md](CODEX-CLOUD.md) for Linux dependency installation, model
downloads, cloud environment publishing, startup and verification. `AGENTS.md`
describes the project and recognition behavior that future changes must preserve.
Use `bash scripts/codex-setup.sh` for the full CPU recognition environment, or
append `web` for website-only work. Generated environments and model weights are
not committed; a fresh checkout prepares them through the setup script.

## 3D walkthrough and hosting

Published models on listings, previous projects and 3D showcases now include **Walk through**, adapted from FLRplanner. Drag to look and hold W A S D, arrow keys or the on-screen movement buttons to explore rooms and doorways. Choose a floor for multi-floor buildings, use Home to restart, and Escape or **Exit walkthrough** to return to the overview. Walls, windows and furniture block movement. The owner previews use the same controls.

The walkthrough runs in the browser using saved models, with no local FLRplanner or recognition service required. See [HOSTING.md](HOSTING.md) for the Vercel configuration, server environment and verification commands. See [FLOOR-PLAN-3D.md](FLOOR-PLAN-3D.md) for creating and publishing a model.

## Durable listings with Supabase

Production listings and contact settings live in Supabase's RLS-protected `public.site_store` table. Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as encrypted, server-side Vercel environment variables; the service-role credential must never be exposed to browser code. For local development, copy `.env.example` to `.env.local` and fill in the same values.

## Run locally

```powershell
npm ci
npm run build
$env:ADMIN_PASSWORD='choose-a-strong-password'
npm start
```

Open `http://127.0.0.1:43821`. The owner dashboard is at `/admin`. You can choose another port with the `PORT` environment variable.

For pretrained floor-plan recognition, use `npm run start:floorplan` instead of
`npm start` once the Python environment and checkpoint are installed. This starts
both the recognition service and the website with their connection configured.
See [services/floorplan/README.md](services/floorplan/README.md) for setup.
Automatic recognition uses the restored FLRplanner-derived CubiCasa5K pipeline
for walls, doors, windows, room predictions and fixture suggestions, together with
the browser's movable furniture proposals. Review the tracing and accept furniture
suggestions before saving. Saved models remain unchanged until re-detected and
saved. The MitUNet/OCR combination is an optional comparison engine selected with
`FLOORPLAN_ENGINE=mitunet`; it is no longer the default. Published model weights
restrict commercial use; the service setup documents online hosting and licensing.

The editor also has a separate **Coloured walls** method for solid coloured,
horizontal/vertical wall strips. **Automatic** selects it only when a strong
filled-wall network is found; other images use the original FLRplanner detector.
Choose **FLRplanner** to force the original output. See
[the research and image verification](FLOOR-PLAN-RECOGNITION-RESEARCH.md).

If `ADMIN_PASSWORD` is not set, the local demo password is `aaranya-demo`. Always set a unique password before making the site publicly accessible.

## Private Telegram listing bot

The Telegram bot is part of this same Node backend. It receives Telegram updates at `/api/telegram/webhook`, uses the same listing validation and write functions as the browser admin panel, and saves listings to the same Supabase `site_store` row. Vercel hosts it as an HTTPS webhook, so there is no long-running polling process to keep alive. Multiple authorized owners can use the bot, with an independent saved conversation for each owner.

The public site also has a separate Previous Projects portfolio at `/portfolio`. Portfolio projects are stored in the same Supabase site store but are never mixed with available listings. Every portfolio card and detail page is permanently labelled sold/not for sale. Owners can add and edit project photography, completion details, signature-project status, homepage visibility, and an optional Sketchfab embed URL from the Previous Projects dashboard tab.

Available owner commands:

- `/newlisting` — guided listing creation with main photo, gallery, badge, zoom, and optional construction progress
- `/editlisting` — choose a live listing and edit any field or photo collection
- `/addprogress` — add a dated progress photo to an under-construction listing
- `/deletelisting` — choose and confirm deletion
- `/mylistings` — show the current live inventory
- `/cancel` and `/help`

### 1. Create the bot and find your private chat ID

Create a bot with Telegram’s `@BotFather` and keep the token secret. Before configuring a webhook, send the new bot `/start`, then run:

```powershell
$env:TELEGRAM_BOT_TOKEN='paste-the-BotFather-token'
npm run telegram:chat-id
```

Copy each authorized person's numeric account ID from the output. The webhook rejects other accounts and group chats without replying.

### 2. Configure production environment variables

Add these encrypted Production Environment Variables in Vercel, alongside the existing Supabase and admin values:

```text
TELEGRAM_BOT_TOKEN=<BotFather token>
TELEGRAM_OWNER_CHAT_IDS=<comma-separated numeric Telegram account IDs>
TELEGRAM_WEBHOOK_SECRET=<random webhook verification secret>
TELEGRAM_API_SECRET=<separate random bearer token for /api/bot/*>
```

Generate each secret independently, for example:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Never prefix these names with `NEXT_PUBLIC_` and never commit their real values. Redeploy after adding or changing Vercel environment variables.

### 3. Apply the bot-state migration

Apply `supabase/migrations/20260909000000_create_telegram_bot_state.sql` to the same Supabase project used by the website. The table stores only the current private conversation draft and Telegram update cursor. RLS is enabled, public roles have no access, and only the server-side service role can read or modify it.

### 4. Register the deployed webhook

After the production deployment is ready, configure Telegram once from a trusted local terminal:

```powershell
$env:TELEGRAM_BOT_TOKEN='paste-the-BotFather-token'
$env:TELEGRAM_WEBHOOK_SECRET='the-same-value-stored-in-Vercel'
$env:TELEGRAM_WEBHOOK_URL='https://mdu-properties-webpage.vercel.app'
npm run telegram:webhook
```

The setup script registers the command menu, restricts Telegram to message and callback-query updates, supplies Telegram’s secret webhook header, and uses one connection so guided steps remain ordered. Every listed owner has full create, edit, progress, and delete access. For backward compatibility, `TELEGRAM_OWNER_CHAT_ID` is still accepted and may also contain comma-separated IDs; values from the singular and plural variables are merged.

### Authenticated bot REST API

The integration also exposes minimal server-to-server endpoints. Send `Authorization: Bearer <TELEGRAM_API_SECRET>` with every request:

```text
GET    /api/bot/listings
GET    /api/bot/listings/:id
POST   /api/bot/listings
PUT    /api/bot/listings/:id
DELETE /api/bot/listings/:id
POST   /api/bot/listings/:id/progress
```

These endpoints and the browser admin routes call the same listing service, so validation, `publishedAt`, `updatedAt`, New Listing tags, and Updated tags behave identically. Telegram photos are downloaded as compressed Telegram image variants and stored as data URLs, matching the website’s current image storage method. Images larger than 4 MB each or drafts larger than 24 MB are rejected with a clear chat message.

## Included

- Responsive homepage, filtered listings page, and individual property pages
- Optional per-listing gallery zoom and construction progress timeline
- Server-calculated New Listing and Recently Updated tags
- Verified Listing / Direct from Builder trust badges
- Persistent owner-managed listing and contact data
- Single-owner authentication with HttpOnly, SameSite session cookies and login rate limiting
- Main, gallery, and progress image uploads compressed to WebP before storage
- Rich description editor, sitewide contact settings, WhatsApp-prefilled messages, click-to-call, and email links
- Private authorized-owner Telegram listing management using the same Supabase data
- Semantic structure, per-page metadata, alt text, lazy-loaded gallery images, reduced-motion support, and visible keyboard focus

Runtime data is written to `data/store.json` and intentionally ignored by git. Delete that file to restore the seeded demonstration listings on the next start.

## Production notes

Set `ADMIN_PASSWORD`, serve behind HTTPS, and use durable persistent storage on your host. Image uploads are stored as compressed data URLs; for a much larger inventory, migrate both the admin and Telegram upload paths together to object storage.

### Vercel deployment

The checked-in `vercel.json` configures the Node entrypoint, reproducible installation and browser viewer build, preserving the public website, API routes, Telegram webhook and single-page navigation. Production listing/model data and Telegram conversation state are durable in the configured Supabase store. Set `ADMIN_PASSWORD` and the Supabase variables; configure the `TELEGRAM_*` secrets if using the optional bot. Owner sign-in is disabled until `ADMIN_PASSWORD` is set. See [HOSTING.md](HOSTING.md) for the complete setup.
