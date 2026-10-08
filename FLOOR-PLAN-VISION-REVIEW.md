# Local vision review for extracted walls

Research and integration: 7 October 2026.

The existing FLRplanner/CubiCasa and coloured-wall extraction stay responsible
for walls, openings, rooms and fixtures. A separate, optional reviewer judges
suspicious **already extracted wall segments**. It does not generate geometry,
alter either detector's masks, or remove walls automatically. It is off by
default and requires the editor's request opt-in even after a provider is set up.

## Model choice and research

| Model | Verified capability | Integration decision |
| --- | --- | --- |
| [Laya](https://github.com/NandhaKishorM/laya) | A text decision model with typed classification questions. | It cannot inspect drawing pixels. OCR-only classification may be a later experiment; it adds no direct wall-shape review and is not installed here. |
| [Laya Vision](https://huggingface.co/thaitea/laya-vision) | The current recommended checkpoint is 201M parameters. It takes images plus text and typed questions, with one 512-pixel image tile. Its card recommends domain calibration. | Implemented through the independent [r33drichards fork](https://github.com/r33drichards/laya-vision), in a separate Python environment. Uses a local checkpoint and offline loading. Weights: **CC BY-NC-SA 4.0**; code: Apache 2.0. Suitable for permitted research evaluation. |
| [Qwen3-VL-4B-Instruct](https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct) | The model family supports text/image interpretation and document tasks; the 4B checkpoint is Apache 2.0. | Recommended first experiment through local Ollama. The [published `qwen3-vl:4b` package](https://ollama.com/library/qwen3-vl:4b) is a 3.3 GB Q4_K_M download. Actual memory and speed need measurement on the deployment machine. |

Neither model's published results establish accuracy on the owner's drawings.
The recommendation to try Qwen first is an engineering judgment based on its
local deployment interface, document capabilities and checkpoint license.
Using it does **not** resolve the existing CubiCasa checkpoint's noncommercial
restriction. See [the model notices](services/floorplan/MODEL-NOTICES.md).

The adapters follow primary API sources: [Ollama chat](https://docs.ollama.com/api/chat),
[vision structured outputs](https://docs.ollama.com/capabilities/structured-outputs),
and [Laya Vision's native loader and decision schema](https://github.com/r33drichards/laya-vision/blob/main/laya/vlm.py).
Qwen returns a bounded classification and explanation using a JSON schema;
it is not asked to invent a confidence percentage. Laya's chosen-class score
is retained as an **uncalibrated model score**, not floor-plan accuracy.

## Review behavior

1. Run the selected extraction normally. `profile=standard` still forces the
   original FLRplanner method; coloured routing is independent of review.
2. Select segments overlapping existing OCR/annotation evidence, detached thin
   runs, thin page-edge ink, or thin runs without filled wall support. These are
   candidate selection cues, not proof that a wall is false. Thick and coloured
   support and connection to other walls are recorded as geometry evidence.
3. Crop the unmodified original image with surrounding context, preserve its
   aspect ratio, and limit it to 512 pixels per side. Pass segment endpoints in
   crop coordinates and available nearby OCR text. Do not paint over the ink
   seen by the model. The editor's red crop highlight is only a review aid.
4. Ask for `wall`, `measurement-line`, `description-box`, `furniture`, or
   `uncertain`. Show non-wall and uncertain answers as review flags. Original
   geometry remains in 3D until a person chooses **Remove wall**.
5. **Inspect wall**, **Keep wall**, **Remove wall** and **Undo** use the shared
   editor. Saved projects and JSON exports retain flags and review decisions.
   Decisions match endpoints rather than mutable array positions; an edited
   or removed wall requires fresh detection before a stale flag can remove it.

At most six crops are sent per request. Review has a 20-second shared worker
budget, with at most eight seconds per Qwen call and five seconds for optional
OCR. Child processes are terminated on timeout. Crop selection/encoding adds
small CPU overhead outside the worker deadline. A missing model, stopped local
server, invalid reply, missing OCR, or bad reviewer configuration preserves
structural recognition. Partial results explicitly show incomplete coverage.
With no selected crops, no provider call is needed; a complete empty review
does not establish provider availability or drawing accuracy.

Remote reviewer URLs, redirects, URL credentials and cloud model names are
rejected. The website never receives model credentials or crop image copies;
its crop previews use the already uploaded drawing. OCR and explanations are
rendered as text. The website remains on its existing host; the local reviewer
runs beside the Python recognizer, not in a browser or Vercel function.

## Qwen through local Ollama

Install a current Ollama release supporting Qwen3-VL (the package page lists
0.12.7 as its minimum). Download the model **before** recognition; inference
does not pull models automatically:

```sh
ollama pull qwen3-vl:4b
# Start Ollama in a separate terminal, or set this in its service configuration.
OLLAMA_NO_CLOUD=1 ollama serve
```

Ollama should listen on loopback. Restart an already running Ollama service
after setting its [local-only configuration](https://docs.ollama.com/faq#how-do-i-disable-ollama-cloud-features).
The local-only setting applies to the Ollama **server**, not just this client.
Warm the model with `ollama run qwen3-vl:4b ""` before reviewing to keep a cold
model load from consuming the short request budget.

In the terminal launching this project's services:

```sh
export FLOORPLAN_VISION_PROVIDER=ollama
export FLOORPLAN_VISION_URL=http://127.0.0.1:11434
export FLOORPLAN_VISION_MODEL=qwen3-vl:4b
npm run start:floorplan
```

In PowerShell use `$env:FLOORPLAN_VISION_PROVIDER='ollama'` and the corresponding
`$env:` assignments for the other variables. Set these on the Python service's
process; merely adding them to the website host's environment is insufficient.
The launcher inherits them. `/health` reports configured review independently
of extraction readiness; configuration does not imply the model has been loaded.

In the editor, enable **Ask the local vision model to review suspicious walls**,
then detect again. Disable the checkbox to get the original pipeline without
additional review. To disable the integration globally, restart with
`FLOORPLAN_VISION_PROVIDER=off`.

## Laya Vision in an isolated environment

Use the vision fork, not `pip install laya` (which installs the text model).
Pin a reviewed fork commit for reproducibility and keep the environment outside
the recognition service's `.venv`:

```sh
python3.12 -m venv work/laya-vision-env
git clone https://github.com/r33drichards/laya-vision work/laya-vision-source
# Check out the reviewed full commit hash in that checkout before installing.
work/laya-vision-env/bin/python -m pip install ./work/laya-vision-source torchvision
```

Download a pinned `thaitea/laya-vision` snapshot into a local model directory
using Hugging Face's tooling during setup. Preserve its `vlm_agent_config.json`,
weights and `processor/` directory. Also cache any referenced backbone assets
at their recorded revisions; upstream loading may need those assets even with
a local main checkpoint. Record the checkpoint revision and SHA-256 checksums
with your evaluation corpus. The worker sets `HF_HUB_OFFLINE=1` and
`TRANSFORMERS_OFFLINE=1`; missing assets cause unavailable review, not downloads.

```sh
export FLOORPLAN_VISION_PROVIDER=laya-vision
export FLOORPLAN_LAYA_PYTHON="$PWD/work/laya-vision-env/bin/python"
export FLOORPLAN_LAYA_MODEL_PATH="$PWD/work/laya-vision-model"
export FLOORPLAN_LAYA_DEVICE=cpu
npm run start:floorplan
```

On Windows select the separate environment's `Scripts/python.exe`. One child
process loads the model for the entire review batch; loading counts against the
budget and the process exits afterward. This deliberately favors isolation and
failure recovery over a permanently resident model. Measure cold-load latency
before choosing this adapter for a host. Do not use the published noncommercial
weights commercially without appropriate permission.

## Optional OCR evidence

Existing MitUNet annotation text is reused. For default FLRplanner or coloured
plans, enable bundled OCR explicitly without enabling MitUNet or downloading
its checkpoint:

```sh
services/floorplan/.venv/bin/python -m pip install rapidocr-onnxruntime==1.4.4 onnxruntime==1.30.0
export FLOORPLAN_VISION_OCR=1
```

OCR runs on a drawing image capped at 1600 pixels in a separate bounded process.
When it is off or unavailable, crops still run with empty OCR text and image
evidence. OCR only selects and informs review; it does not filter either default
detector's walls. The default cloud setup needs no new dependencies.

## Labeled evaluation and first-plan protection

First export an **original Python recognition result** for the first plan,
without vision review, using its original dimensions and routing profile:

```sh
services/floorplan/.venv/bin/python services/floorplan/app.py \
  --image work/first-plan.png --profile auto --width 30 --depth 40 --output work/first-original
```

Use the resulting recognition JSON as the first entry's baseline. Do not use a
browser saved-layout export: that has different fields and opening surrounds.
Create a manifest beside your image files, label extracted segments using their
original normalized endpoints, and include both false detections and genuine
walls, especially walls crossing OCR, thin partitions and coloured wall fills:

```json
{
  "plans": [
    {
      "id": "first-plan",
      "image": "first-plan.png",
      "baseline": "first-original/recognition.json",
      "width": 30,
      "depth": 40,
      "profile": "auto",
      "labels": [
        {"a": [0.2, 0.3], "b": [0.8, 0.3], "classification": "wall"},
        {"a": [0.2, 0.1], "b": [0.8, 0.1], "classification": "measurement-line"}
      ]
    }
  ]
}
```

The example coordinates illustrate the schema; replace them with actual
human-reviewed extracted segments. Do not count `uncertain` human labels as
confirmed false walls.

```sh
services/floorplan/.venv/bin/python services/floorplan/evaluate_vision.py \
  --manifest work/vision-corpus.json --output work/vision-evaluation.json
```

Evaluation fails if the first plan no longer matches its original engine, walls,
openings, fixtures or rooms, or if adding review changes any extracted geometry.
It records false walls flagged, genuine walls wrongly flagged, a confusion
matrix, unreviewed labels, labels absent from extraction and provider failures.
Automatic false-wall removals and genuine-wall rejections remain zero by design.
Useful flags are potential manual corrections, not automatic accuracy gains.
Missing provider output or no reviewed labels returns a nonzero exit code.

Use disjoint plan-level calibration and test sets for each model/revision; do
not mix crops from the same plan across both. Before implementing automatic
rejection, require labeled evidence that genuine walls survive, then combine
calibrated semantic judgments with independently checked wall geometry. There
is currently **no automatic rejection mode or confidence threshold** to enable.

## Verification limits

Run the Python and Node suites plus `npm run check`. The new
`npm run test:floorplan:vision` uses an isolated store and scripted model answers
to verify request opt-in, unchanged geometry, incorrect genuine-wall flags,
manual removal/undo, save/reopen, mobile controls and unavailable review.
Run `npm run test:walkthrough:browser` for the existing shared viewer.
If using a system Chromium instead of a Playwright download, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium` for the vision browser command.

This workspace contains CubiCasa weights and synthetic onboarding drawings,
but no Qwen/Ollama installation, Laya Vision weights, or original user plans.
Adapter contracts can be tested here. Neither model's real inference nor an
accuracy gain on the user's first or measurement-box plans has been validated.
The container recipe includes all adapter modules; a Docker image build has not
been verified in this environment.

Integration checks passed: 39 Python tests, 87 Node tests, syntax/renderer build,
the six vision editor browser checks and the eight existing walkthrough checks.
Browser checks used system Chromium and produced no JavaScript errors. A real
CubiCasa extraction regression on the two synthetic onboarding images retained
identical walls/openings, fixtures and rooms when adding scripted vision review
(19 original standard segments and 7 coloured-path segments). These checks
establish integration behavior, not vision-model accuracy on the user's plans.
