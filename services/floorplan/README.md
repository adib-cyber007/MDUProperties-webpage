# Floor-plan recognition

Automatic uploads use the restored FLRplanner-derived CubiCasa5K pipeline:

`drawing → CubiCasa walls, doors, windows, rooms and fixed fixtures + browser
movable furniture proposals → review → calibration → Three.js / GLB / OBJ`.

Walls, doors and windows enter automatic 3D geometry using the previous
FLRplanner-derived handling, including opening surrounds. Review the tracing:
model scores are not calibrated accuracy estimates and unfamiliar drawing styles
can produce mistakes. Saved projects are unchanged until you choose **Detect
walls again** and save. Confirm dimensions before publishing.

Walls, doors, windows, fixed fixtures and room labels are detected automatically
by CubiCasa5K. The browser also proposes movable furniture using the existing
image rules. Furniture requires individual acceptance through **Add to model**.
**Find doors & windows** and **Find items in drawing** can rescan those details.
All listing, portfolio, standalone-model, and
building-floor editors share this pipeline and the existing walkthrough.

Automatic routing now has a separate path for strong solid coloured,
horizontal/vertical wall networks. It extracts wall strips from colour evidence
and runs CubiCasa detail recognition on a cropped, wall-normalised building.
Black text, borders and dimensions never supply its structural walls. When the
colour checks fail, the exact original inference call is retained. The editor's
**Recognition method** selector can force FLRplanner or Coloured walls. See
[research, constraints and supplied-image verification](../../FLOOR-PLAN-RECOGNITION-RESEARCH.md).

The MitUNet/OCR combined engine remains an explicit optional comparison. It is
not used by the default engine and does not filter or replace its wall geometry.

## Local setup

Dependencies and verified weights are generated local files. A fresh clone must
install them using the commands below; Linux cloud setup is also documented in
[CODEX-CLOUD.md](../../CODEX-CLOUD.md). Once installed, start both services with:

```powershell
npm run start:floorplan
```

The launcher starts recognition at `127.0.0.1:8765` and the website at
`127.0.0.1:43821` (or PORT), and stops both with Ctrl+C.

Reproduce the tested Windows Python 3.12 CPU environment:

```powershell
py -3.12 -m venv services/floorplan/.venv
& services/floorplan/.venv/Scripts/python.exe -m pip install torch==2.14.1+cpu torchvision==0.29.1+cpu --index-url https://download.pytorch.org/whl/cpu
& services/floorplan/.venv/Scripts/python.exe -m pip install -r services/floorplan/requirements-lock.txt --extra-index-url https://download.pytorch.org/whl/cpu
& services/floorplan/.venv/Scripts/python.exe services/floorplan/download_model.py
npm ci
npm run start:floorplan
```

For Linux use `bin/python`. FLOORPLAN_PYTHON selects the interpreter and
FLOORPLAN_PORT the local inference port. FLOORPLAN_ENGINE defaults to `cubicasa5k`.
Only its checkpoint is required for default startup. There is no
silent fallback. FLOORPLAN_DEVICE defaults to `cpu`; `cuda` requires an available
GPU and suitable PyTorch installation. The environment/models are ignored by Git.
The downloaders verify the expected SHA-256 before installing weights. Torch uses
strict loading with weights_only=True; inference does not download models or code.

To compare with the optional combined engine, install the dependencies from the
same requirements lock above, download the additional checkpoint, and restart:

```powershell
& services/floorplan/.venv/Scripts/python.exe services/floorplan/download_mitunet.py
$env:FLOORPLAN_ENGINE='mitunet'
npm run start:floorplan
```

Set `FLOORPLAN_ENGINE=cubicasa5k` to restore the default explicitly. The optional
engine uses segmentation-models-pytorch, RapidOCR and ONNX Runtime from the lock;
its OCR models are bundled in the pinned wheel. It loads both checkpoints before
reporting readiness. The default CubiCasa engine loads neither MitUNet nor OCR.

## Optional MitUNet filtering and shared limits

When `FLOORPLAN_ENGINE=mitunet` is selected, wall inference matches the published
512×512 preprocessing. Normalized
coordinates map back to the original rectangle. OCR uses a larger drawing image.
A numeric label plus extension/tick evidence at both endpoints is required to
classify a geometric dimension rail. Area labels and room numbers are excluded
from this evidence. Isolated filled triangular pointers are detected
conservatively. Text masks protect continuous wall cores; dimension masks protect
thick intersecting walls.

This optional structural wall path does not close masks, snap endpoints, or invent
opening surrounds. Skeleton segments require continuous wall-mask support. Mean model
scores below .82 or insufficient support enter separate review. Empty drawings
never receive an invented perimeter. Filtering is heuristic: unusual dimensions,
missed thin walls, and unfamiliar styles still need review. Crop dense sheets to
one floor. Uncertain walls appear as purple dashes and stay out of 3D until
**Add reviewed wall**; **Discard** and **Undo** are supported. **Show ignored
measurements and text** displays filtering regions. The combined engine aligns
CubiCasa openings to its supported wall runs or bounded gaps and rejects isolated
or annotated detections. These extra filters are not applied by the default
FLRplanner-derived CubiCasa engine.

At most 250 wall/opening/review segments and 300 optional annotations are retained.
Inputs are limited to 16 megapixels and approximately 1.8 MB encoded image data.
The editor preserves crisp PNG where possible.

## API and online hosting

GET /health reports readiness, engine, device, and license. POST /analyze accepts
`{image,width,depth,mode,profile}` (feet). Profile is `auto` by default,
`standard` to force original FLRplanner output, or `colored` for the separate
solid-colour method. Explicit coloured mode fails when its evidence is absent.
CubiCasa returns the original full semantic
detection. The optional MitUNet engine accepts `combined` (default), `walls`,
`openings`, or `furniture`. Results contain walls, doors, windows, fixture suggestions,
room classifications and timing. The optional MitUNet engine additionally supplies
source identifiers, separate candidates, annotation polygons and filtering counts.
The website uses its owner-authenticated
`/api/admin/floor-plan-recognition` proxy. Errors preserve existing geometry.
Browser-Origin inference calls are refused and one inference runs at a time.
Saved models and their walkthrough need no recognition service.

For remote inference, set FLOORPLAN_RECOGNITION_URL to a reachable HTTPS URL and
the same FLOORPLAN_SERVICE_TOKEN on both services. Keep the website on its
existing Node/Vercel host and run Python separately. Container recipe:

```sh
docker build -t floorplan-recognition services/floorplan
docker run --rm -p 8765:8765 -e FLOORPLAN_SERVICE_TOKEN=your-private-token floorplan-recognition
```

The container defaults to `FLOORPLAN_ENGINE=cubicasa5k` and downloads only the
CubiCasa checkpoint. To host the optional MitUNet engine, provide its verified
checkpoint as well and select `FLOORPLAN_ENGINE=mitunet`. The container listens on
0.0.0.0; expose it through the host's HTTPS ingress.
Measure memory/latency on the chosen host before selecting capacity. Docker was
unavailable locally, so the supplied image build has not been tested.

## Tests and diagnostic exports

```powershell
& services/floorplan/.venv/Scripts/python.exe -m unittest discover -s services/floorplan -p 'test_*.py' -v
npm test
npm run check
# Optional MitUNet regression requires its additional checkpoint:
& services/floorplan/.venv/Scripts/python.exe services/floorplan/verify_inference.py work/reference-floorplan.png work/reference-floorplan-2.png work/reference-floorplan-3.png
# Keep inference running:
npm run test:floorplan:browser -- work/reference-floorplan.png
npm run test:walkthrough:browser
npm run evaluate:floorplan -- work/reference-floorplan.png work/reference-floorplan-2.png work/reference-floorplan-3.png
```

CLI: `python services/floorplan/app.py --image path/to/plan.png --output work/result`
accepts `--profile auto`, `--profile standard`, or `--profile colored` and
exports recognition JSON and diagnostic masks. Browser tests use the real
default CubiCasa checkpoint and a temporary store for automatic FLRplanner-derived
output, optional tools, exports, private persistence, failure preservation, and
mobile layout. Separate optional-engine tests cover annotation filtering and a
synthetic review fixture for acceptance/undo.
Reference tests validate operation/geometry, not ground-truth accuracy.

## Licenses

MitUNet code is MIT; published weights are **CC-BY-NC 4.0**. CubiCasa
code/weights retain their non-commercial restriction. Commercial hosting needs
appropriate permission or independently trained, appropriately licensed weights.
PaddleOCR/RapidOCR are Apache 2.0. See [MODEL-NOTICES.md](MODEL-NOTICES.md).
