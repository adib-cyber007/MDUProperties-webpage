# Work on this repository in Codex Cloud

Repository: <https://github.com/adib-cyber007/MDUProperties-webpage>.
The website, 3D renderer, walkthrough, recognition service, tests and model
provenance are included. Local listing data, environment values, uploaded plans,
virtual environments and checkpoints are deliberately not Git assets.

## Create the environment

In Codex choose **Work in > Cloud > Select environment > Create environment**,
or **Settings > Codex Cloud > Environments > Create environment**. Select
`adib-cyber007/MDUProperties-webpage` and connect GitHub if prompted. Ask the setup
task to read `AGENTS.md` and this file, use Node 22 and Python 3.12, and run:

```sh
bash scripts/codex-setup.sh
```

Use that command for the environment's **Install script**. The default installs
the locked Node dependencies, builds the renderer, runs Node tests, installs
Chromium and its Linux libraries, creates the recognition virtual environment,
installs CPU PyTorch and the pinned portable service dependencies, downloads
the hash-verified CubiCasa checkpoint, runs Python tests and loads the model.
Preparation needs internet access and several GB of disk for CPU packages and
the checkpoint. It does not start a long-running server during installation.

For website-only tasks use `bash scripts/codex-setup.sh web`. That supports all
website tests and synthetic-model walkthrough checks, but image recognition is
unavailable. `combined` additionally installs the experimental MitUNet/OCR stack
and its checkpoint; it does not change the default engine.

Review the setup report, test startup, and select **Publish**. The repository
files prepare the workflow; they do not create or publish an environment in your
account. New tasks use the published prepared filesystem. After dependencies
change, edit the environment, rerun installation and **Republish**.
These steps follow the [official OpenAI Cloud environments guide](https://learn.chatgpt.com/docs/environments/cloud-environments).

## Access settings

Choose **Package managers** for network access. Recognition setup also needs
`drive.google.com` and `drive.usercontent.google.com` for the published CubiCasa
checkpoint. Chromium downloads can use `cdn.playwright.dev`,
`playwright.download.prss.microsoft.com` and `cdn.playwright.azureedge.net`;
allow the host shown in download logs if your selected Playwright version uses
a different redirect. The combined profile additionally needs
`raw.githubusercontent.com` and `media.githubusercontent.com`.

Development uses the local demo store with no production credentials. Set a
development `ADMIN_PASSWORD` in environment variables and keep `FLOORPLAN_ENGINE`
as `cubicasa5k`. Do not copy production remote-store, Telegram, or external AI
credentials into the setup. Model downloads need no private API key. Existing
checkpoint licenses still apply; see `services/floorplan/MODEL-NOTICES.md`.

## Start skill / services

Use the following instructions for the environment's **Start skill**:

> Read AGENTS.md. From the repository root, start `npm run start:floorplan` for
> recognition work, or `npm start` for website-only work, with HOST=0.0.0.0,
> PORT=43821 and a development ADMIN_PASSWORD. Run in a retained terminal session.
> Wait for recognition /health to report ready before testing image uploads.
> Confirm the website responds at / and the owner editor loads at /admin.
> Stop only the task's own services when finished.

Equivalent shell commands for a prepared recognition environment:

```sh
HOST=0.0.0.0 PORT=43821 npm run start:floorplan
# In a second terminal:
curl --fail http://127.0.0.1:8765/health
curl --fail --output /dev/null http://127.0.0.1:43821/
```

Cloud localhost is the cloud VM, not the Windows website/recognizer. Use the
cloud preview to inspect the running website. The public viewer and walkthrough
operate on saved models and do not need the Python service.

## Verify changes

```sh
npm run check
npm test
services/floorplan/.venv/bin/python -m unittest discover -s services/floorplan -p 'test_*.py'
npm run test:walkthrough:browser
```

The last command uses isolated synthetic models and requires no sample photos
or weights. Real-image recognition tests need licensed PNG/JPEG/WebP fixtures
supplied to the task; personal download paths and ignored `work/reference-*`
files from Windows are unavailable in a fresh checkout. With both services up:

```sh
npm run test:floorplan:browser -- /path/to/furnished-plan.png
npm run test:floorplan:colored -- /path/to/ordinary-plan.jpeg /path/to/coloured-plan.jpeg
```

The coloured test compares the ordinary image against forced original inference
and verifies routing, straight geometry, saved models, exports and walkthrough.
Geometry/operational tests are not ground-truth recognition accuracy benchmarks.

GitHub Actions checks the Node build/test suite and Python geometry tests on
Linux for pushes and pull requests. It does not download model weights or access
production services. Actual cloud provisioning must be verified during the
environment's setup; it cannot be inferred from a Windows run.

Repository preparation verified on 7 October 2026: the web setup script ran from
an isolated source-only checkout, build/syntax checks and 82 Node tests passed,
25 Python tests passed, and the synthetic walkthrough browser suite passed with
no JavaScript errors. The portable Python dependency pins also resolved to Linux
Python 3.12 wheels. Full Linux CPU-model provisioning and environment publication
remain checks for the cloud environment's setup task.
