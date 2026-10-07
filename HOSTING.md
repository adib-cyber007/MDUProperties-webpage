# Hosting Madurai Dream Properties

The website and FLRplanner-derived walkthrough are self-contained in this project. Three.js and the walkthrough are compiled into `public/floor-plan-renderer.js`. Visitors need a modern browser with WebGL 2; they do not need FLRplanner, Python, a desktop application or an AI key.

## Vercel

Import this repository into Vercel, with the repository root as the project directory. The checked-in `vercel.json` selects the Node framework, installs with `npm ci`, builds with `npm run build` and includes the public assets in the server function. Use Node.js 24. Leave Output Directory unset: this project has a Node backend and API routes.

Configure these encrypted server environment variables before using the owner dashboard:

| Variable | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | Your production owner password |
| `SUPABASE_URL` | The existing project's durable listing/model store |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only access to that store |

The existing `public.site_store` table must be provisioned using `supabase/migrations/20260813000000_create_site_store.sql`. Saved property, portfolio and standalone 3D models share this store. Public pages can display the demonstration inventory without storage credentials; production management requires the durable store. Keep credentials in the hosting settings, outside browser code and source control.

`server.js` calls `listen()` when Vercel imports it, as required by the [Node.js runtime](https://vercel.com/docs/functions/runtimes/node-js). The same entrypoint handles public routes, the dashboard, property APIs and the existing Telegram webhook. The public viewer uses same-origin assets and API requests. Deployment excludes local data, test output and Python model files.

The existing Telegram and AI-design features remain optional; their environment variables are listed in `.env.example`. Floor-plan recognition is also optional and separate from viewing a saved model. To enable automatic recognition for uploads, host the recognition service separately and set `FLOORPLAN_RECOGNITION_URL` to its reachable HTTPS URL, with a matching `FLOORPLAN_SERVICE_TOKEN`. Leave this URL empty when that service is unavailable. Reviewed layout JSON can be imported without recognition.

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
The container recipe has not been built locally because Docker is unavailable.

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

The hosting test imports the server in Vercel production mode and checks startup, network binding, website/API routing, the compiled viewer asset and owner access configuration. The browser test uses a temporary store to verify published property, portfolio and 3D showcase walkthroughs, keyboard movement through doors, collision, touch controls, floor elevations and offsets, look direction during resize, Escape/overview restoration, image export and idle rendering. Its report and screenshots are written to ignored `work/` files.

These checks verify deployment readiness locally. They do not create or publish a deployment.
