# Separate recognition for coloured-wall floor plans

Research and local verification: 6 October 2026.

## Recommendation and implementation

Keep the current FLRplanner-derived CubiCasa5K inference and postprocessing for
ordinary plans. Add a separate, conservatively selected path for solid coloured,
horizontal/vertical wall strips. The new path uses colour segmentation and
geometric constraints for walls; CubiCasa processes a cropped, wall-normalised
building image for details. Outputs from the two wall detectors are never merged.

This recommendation follows the supplied images and local tests. It is not a
claim that colour segmentation is the best method for every architectural plan.
The second image provides unusually strong evidence: yellow wall fills are
visually distinct from black text, dimensions, road labels, stairs and page frame.
The first image has grey wall fills and coloured furniture/window details, so it
continues through the original detector.

OpenCV's official documentation describes [HSV colour-range segmentation](https://docs.opencv.org/4.x/da/d97/tutorial_threshold_inRange.html)
and [straight-line detection](https://docs.opencv.org/4.x/d9/db0/tutorial_hough_lines.html).
Our implementation uses directional morphology and strip centre fitting, rather
than running a Hough detector over all black ink. A line detector alone cannot
decide whether a straight line is a wall, dimension rail or page border. That is
why colour/region selection precedes vectorisation.

## Verified candidate comparison

| Candidate | Verified capability | Suitability for this project |
| --- | --- | --- |
| [OpenCV colour isolation and geometric extraction](https://docs.opencv.org/4.x/da/d97/tutorial_threshold_inRange.html) | Segment a selected colour independently of black ink. | Best immediate complement for the supplied yellow-wall plan. Uses existing CPU dependencies; needs no additional trained wall model. |
| [DeepLSD](https://github.com/cvg/DeepLSD) | Generic line detection/refinement; maintainer publishes Wireframe/MegaDepth checkpoints and MIT licensing for code and weights. | Useful possible extension for degraded or rotated linework. It does not classify wall versus dimension semantics. The full refinement stack adds native Ceres/GLog/GFlags dependencies. Not installed or benchmarked here. |
| [SOLD2](https://github.com/cvg/SOLD2) | Published synthetic and Wireframe checkpoints for line detection/descriptors. | Another geometric tool, with the same semantic-selection requirement. It would add a dependency without solving this particular colour-isolation problem. |
| [SAM 2.1](https://github.com/facebookresearch/sam2) | Promptable image masks and automatic mask generation; Apache 2.0 checkpoints. | Could support a future click-to-select-wall tool. Inference from its documented interface: it still needs wall selection/classification and straight-vector reconstruction. No evidence established here that it reliably separates architectural annotations automatically. |
| [DeepFloorplan](https://github.com/zlzeng/DeepFloorplan) | Published pretrained room-boundary/room-type model and postprocessing. | Original implementation documents Python 2.7 and TensorFlow GPU 1.10.1. Considerable migration is needed; coloured-plan improvement remains unverified. |
| [FloorPlanFormer](https://github.com/LTayfaker/FloorPlanFormer) | [AAAI 2026 paper](https://ojs.aaai.org/index.php/AAAI/article/view/37625) describes specialised contour and room segmentation. | Maintainer README currently documents a partial release: training code, validation/test data, and remaining sections pending. A complete runnable published checkpoint was not verified. Avoid making it a production dependency yet. |
| [RoomFormer](https://github.com/ywyue/RoomFormer) | Pretrained polygon reconstruction from top-down point-cloud density maps. | Its documented input differs from phone screenshots of drawings. Adapting it would require a separate experiment/training effort. |
| [FloorplanVLM](https://arxiv.org/html/2602.06507v1) | Paper reports direct structured geometric output and an evaluation benchmark. | Headline paper results do not establish accuracy on these attachments. Public community training adapters are not verified equivalents of the paper's model. The method merits future evaluation, but is not needed for the strong colour cue here. |
| [PDF vector extraction](https://pymupdf.readthedocs.io/en/latest/recipes-drawing-and-graphics.html) / [spatial-analysis](https://github.com/adityonugrohoid/spatial-analysis) | Extract drawing primitives and select by fill, stroke, width and position. | Best future input route when the original vector PDF is available. A JPEG screenshot has already discarded those primitives; this work keeps the current image upload contract. Check PDF-library licensing before adding a production dependency. |

Community searches included discussions about [coloured room boundaries](https://www.reddit.com/r/computervision/comments/1fznwbv/),
[floor-plan region isolation](https://www.reddit.com/r/opencv/comments/13hellp/),
and [room extraction from 2D drawings](https://www.reddit.com/r/computervision/comments/1qwghux/).
These informed search leads. Candidate capabilities and compatibility above were
checked against the authors' repositories, papers or official documentation.

## How the separate path works

1. Examine saturated hue clusters. Require a substantial network of thick wall
   strips in both horizontal and vertical directions. Coloured labels, thin
   window ink and large room fills fail these checks.
2. Keep the principal nearby wall network. Directional morphology extracts
   supported strips; centre fitting emits straight lines. Only evidenced
   perpendicular intersections join. Do not globally straighten CubiCasa output
   and do not close all gaps.
3. Locate bounded gaps on shared coloured-wall axes. Windows require multiple
   parallel dark rails inside such a gap. Tiny ink interruptions at dimension
   callouts are rejected.
4. Crop to the coloured building and normalise its coloured fill to grey for
   CubiCasa detail inference. Discard its wall predictions. Retain neural door
   proposals only when supported by a bounded coloured-wall gap. Map details and
   room polygons back to original-image coordinates.
5. Use the existing review, calibration, furniture suggestions, saves, exports
   and Three.js renderer. Furniture remains individually accepted. No furnishings
   are invented for the unfurnished second drawing.

In the editor, **Recognition method** provides **Automatic**, **FLRplanner**,
and **Coloured walls**. Automatic uses the original detector when the colour
checks fail. FLRplanner bypasses routing entirely. Explicit coloured mode reports
failure when the required structure is absent. It preserves the current tracing
instead of silently replacing it with guesses.

## Evidence and limits

The real-image regression compared automatic routing with the exact original
inference on the first attachment: wall endpoints, opening types, furniture and
room results were unchanged. It found 33 original wall segments, 5 doors and 8
windows before website opening-surround processing.

On the second attachment, the original full-page model returned 61 wall fragments,
0 doors and 1 window, including spurious border/phone UI segments. The separate
path returned 26 straight coloured wall runs, 5 door proposals and 8 windows.
No accepted structural wall lay outside the coloured building bounds. A coverage
check found the extracted wall fill covered by the fitted strips within the
specified width tolerance. This is a geometry regression, not independent
ground-truth accuracy or a calibrated confidence score.

Browser checks on both supplied images passed: automatic routing, unchanged
first-image output, straight second-image geometry, 3D walkthrough, JSON/OBJ/GLB
exports, draft save/reopen and mobile layout, with no JavaScript errors. The
website adds 13 wall spans around the detected openings for lintels and sills;
its 39 wall segments therefore represent the 26 structural runs plus those
opening surrounds. The existing FLRplanner editor regression also passed.
The Node suite passed 91 tests, the Python suite passed 25 tests, and the syntax
and renderer build checks passed.

The path currently targets solid, saturated, axis-aligned wall fills. Low colour
contrast, slanted walls, real curved walls, coloured legends near the building,
and unfamiliar door conventions need further samples and review. Genuine curves
remain supported by the original pipeline. Counts do not prove every opening is
correct: door gap classifications and room labels remain predictions. The main
entrance convention in this drawing still requires review.

No extra wall-model checkpoint or external AI request is needed. The Python
service can run on a CPU host through its existing authenticated HTTP interface;
the website/viewer hosting architecture remains unchanged. CubiCasa's existing
noncommercial checkpoint restriction still applies to its detail inference.
The Docker recipe includes the new module but has not been built locally because
Docker is unavailable.

Reproducible image verification:

```powershell
& services/floorplan/.venv/Scripts/python.exe services/floorplan/verify_colored.py <first-image> <second-image>
node scripts/verify-colored-floorplan-browser.js <first-image> <second-image>
```

Diagnostic images and reports are generated under ignored `work/colored-wall-verification/`
and `work/colored-browser-verification.json`; the tests use a temporary project
store and do not replace saved user projects.
