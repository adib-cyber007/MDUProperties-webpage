# Working on Madurai Dream Properties

## Project layout

- `server.js`: Node HTTP server, owner API, local persistence and optional remote
  store. `telegram-bot.js`: private owner bot. Server-side credentials stay here.
- `public/`: vanilla browser UI and shared floor-plan editors. No frontend dev
  server is required. `public/index.html` references versioned assets.
- `src/`: Three.js renderer, furniture meshes, view framing and walkthrough.
  Build with `npm run build`; do not hand-edit `public/floor-plan-renderer.js`.
- `services/floorplan/`: separate Python CPU recognizer and model downloaders.
- `test/`: Node tests. Python tests live beside the recognition service.
- `HOSTING.md`, `FLOOR-PLAN-3D.md`, `CODEX-CLOUD.md`: hosting, editor and cloud setup.

## Setup and commands

Use Node 22 (minimum 20) and Python 3.12 for recognition. On Linux:

```sh
bash scripts/codex-setup.sh               # website, CPU recognition and Chromium
bash scripts/codex-setup.sh web           # website/browser tools only
npm run check                            # syntax and renderer build
npm test                                 # Node unit/API tests
services/floorplan/.venv/bin/python -m unittest discover -s services/floorplan -p 'test_*.py'
npm run test:walkthrough:browser          # isolated synthetic models; no weights
```

Start the website with `npm start`, or both services with
`npm run start:floorplan`. The website defaults to port 43821, recognition to 8765.
The launcher waits for recognition health. `HOST=0.0.0.0` enables a cloud website
preview; the recognizer stays on loopback. Use a development `ADMIN_PASSWORD`.
Stop only processes owned by the current task.

On Windows use `.venv/Scripts/python.exe`. Real-image browser checks take an
explicit licensed PNG/JPEG/WebP path and need the recognition service running:

```sh
npm run test:floorplan:browser -- /path/to/furnished-plan.png
npm run test:floorplan:colored -- /path/to/ordinary-plan.jpeg /path/to/coloured-plan.jpeg
```

`work/reference-floorplan*.png` and the user's original photographs are local
files, not repository fixtures. Do not assume they exist in a cloud checkout.
Tests write diagnostic output and temporary stores under ignored `work/`.

## Recognition behavior to preserve

- The default is `FLOORPLAN_ENGINE=cubicasa5k`, adapted from FLRplanner. Preserve
  its walls, doors, windows, rooms and fixture proposals on ordinary plans.
- `profile=auto` routes only strong solid coloured orthogonal wall networks to
  `colored_walls.py`. Structural walls come from selected colour evidence;
  black dimensions, text, page frames and screenshot UI must not supply walls.
- `profile=standard` forces original FLRplanner inference without extra filtering.
  `profile=colored` must fail explicitly when unsupported; preserve editor work
  on failed recognition. Do not merge both structural wall detectors by default.
- MitUNet/OCR remains an explicit optional comparison engine, not a replacement
  for the default. Its extra checkpoint is not installed by default.
- Keep original-image normalized coordinates, explicit scale confirmation,
  editable geometry, individual furniture acceptance, save/reopen and exports.
- Listing, portfolio, standalone-model and multifloor editors share behavior.
  Public saved-model walkthroughs require no recognition service.
- Prediction counts and geometry checks do not establish ground-truth accuracy.

## Verification and data

Run `npm run check` and `npm test` for JavaScript changes. Run Python tests for
recognition changes. Use the walkthrough browser suite for renderer/editor flow
changes; use real-image comparisons when changing recognition behavior. Report
unavailable weights, images, browser binaries or network access explicitly.

Use isolated test stores. Do not connect a development task to production data
or message Telegram owners as part of tests. Leave production credentials unset;
the application supports a local demonstration store. Do not commit `.env*`
(except the blank `.env.example`), local store data, virtual environments,
`node_modules`, model weights, or files under `work/`. Keep model provenance and
license notices; published checkpoints retain their existing use restrictions.

Preserve unrelated edits and existing saved models. Use `codex/` when creating a
new branch. Keep `package-lock.json` consistent with dependencies and rebuild
the browser bundle after editing renderer source. Repository preparation does
not itself publish a Codex Cloud environment or deploy the application.
