# Hosting Madurai Dream Properties

The website and FLRplanner-derived walkthrough are self-contained in this project. Three.js and the walkthrough are compiled into `public/floor-plan-renderer.js`. Visitors need a modern browser with WebGL 2; they do not need FLRplanner, Python, a desktop application or an AI key.

## Vercel

Import this repository into Vercel, with the repository root as the project directory. The checked-in `vercel.json` defines the Node website and a private CPU recognition container using Vercel Services (beta). The website installs with `npm ci`, builds with `npm run build` and includes the public assets in its server function. Use Node.js 24. Leave Output Directory unset.

Configure these encrypted server environment variables before using the owner dashboard:

| Variable | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | Your production owner password |
| `ADMIN_SESSION_SECRET` | Random private cookie-signing key; use separate production and preview values |
| `SUPABASE_URL` | The existing project's durable listing/model store |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only access to that store |
| `FLOORPLAN_SERVICE_TOKEN` | Private website-to-recognizer authentication; use separate production and preview values |

The existing `public.site_store` table must be provisioned using `supabase/migrations/20260813000000_create_site_store.sql`. Saved property, portfolio and standalone 3D models share this store. Public pages can display the demonstration inventory without storage credentials; production management requires the durable store. Keep credentials in the hosting settings, outside browser code and source control.

`server.js` exposes a default Node.js request handler for the [Vercel runtime](https://vercel.com/docs/functions/runtimes/node-js). Importing it does not open a port; `npm start` still starts the conventional local server. The same entrypoint handles public routes, the dashboard, property APIs and the existing Telegram webhook. The public viewer uses same-origin assets and API requests. Deployment excludes local data, test output and Python model files.

Production owner cookies are HMAC-signed using `ADMIN_SESSION_SECRET` and bound to `ADMIN_PASSWORD`, so an authenticated request remains valid across server instances and cold starts. Set a random signing secret with at least 32 bytes of entropy; the password-only fallback is for hosts that have not configured one. Cookies expire after 12 hours and use HttpOnly, SameSite=Strict and Secure over HTTPS. Sign-out clears the browser cookie; changing either secret and redeploying invalidates all previously issued cookies. Immediate revocation of a copied cookie across every instance would require a shared session store. Local development retains its in-memory sessions.

The website's service binding injects `FLOORPLAN_RECOGNITION_URL` at runtime. Do not set that variable manually for this Vercel Services deployment. All public routes go to the website; the recognition container has no public rewrite. Owner authentication and the private service token protect uploads. Preview calls its own recognition container, and production calls its own. The container installs pinned CPU dependencies and downloads the hash-verified CubiCasa checkpoint during its build; local checkpoints and virtual environments are excluded. Cold startup may take longer than a warm request, so recognition health checks allow 20 seconds.

The existing Telegram and AI-design features remain optional; their environment variables are listed in `.env.example`. Saved-model viewing and walkthroughs need no recognition service. For other hosts, the separate service setup remains supported: set `FLOORPLAN_RECOGNITION_URL` to its HTTPS URL with the matching token. Reviewed layout JSON can be imported without recognition.

The default recognizer is the restored FLRplanner-derived CubiCasa5K pipeline
for walls, doors, windows, room predictions and fixed fixtures. It requires only
the CubiCasa checkpoint; the browser also proposes movable furniture for review.
Automatic colour-based routing uses the same Python/OpenCV CPU service and
checkpoint for details, with no extra external AI endpoint or wall-model download.
The MitUNet/OCR combination remains optional through `FLOORPLAN_ENGINE=mitunet`
and requires its extra dependencies and checkpoint. A container recipe and setup
instructions are in [services/floorplan/README.md](services/floorplan/README.md).
Published CubiCasa and MitUNet weights are CC-BY-NC 4.0: commercial inference
hosting requires appropriate permission or separately trained, appropriately
licensed weights.
Local Docker verification requires Docker, which is unavailable on this computer. Verify the hosted container build, model readiness and an owner upload before promoting a deployment.

## Other Node.js hosts

The same site can run on a conventional Node.js web service:

```text
Install: npm ci
Build:   npm run build
Start:   npm start
```

Set `NODE_ENV=production` and `ADMIN_PASSWORD`. The server then binds to `0.0.0.0` and respects the host's `PORT`; the local demo password is disabled. Serve the site over HTTPS. Use the existing Supabase settings for durable data, or mount persistent storage at `data/` for the local JSON store. An ephemeral filesystem will lose changes when the service restarts.

The model viewer runs on the visitor's device. Larger model/image uploads should use a Node host with adequate request limits; keep Vercel saves within its [4.5 MB request limit](https://vercel.com/docs/functions/limitations#request-body-size).

## Verification

```text
npm run check
npm test
npm run test:walkthrough:browser
```

The hosting test imports the server in production mode with and without Vercel system variables and checks the exported handler, website/API routing, the compiled viewer asset and owner access configuration without opening a port. The browser test uses a temporary store to verify published property, portfolio and 3D showcase walkthroughs, keyboard movement through doors, collision, touch controls, floor elevations and offsets, look direction during resize, Escape/overview restoration, image export and idle rendering. Its report and screenshots are written to ignored `work/` files.

These checks verify deployment readiness locally. They do not create or publish a deployment.
