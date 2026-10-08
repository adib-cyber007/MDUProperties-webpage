# Recognition model provenance

The default recognition engine is the restored CubiCasa5K research pipeline
adapted from FLRplanner. It supplies walls, doors, windows, room predictions and
fixed fixture suggestions. The existing CC-BY-NC 4.0 restriction remains; see
[vendor/NOTICE.md](vendor/NOTICE.md). The browser separately proposes movable
furniture using this project's image rules.

MitUNet is used only when the optional comparison engine is explicitly selected
with `FLOORPLAN_ENGINE=mitunet`. OCR can also be explicitly enabled for local
vision review with `FLOORPLAN_VISION_OCR=1`; neither is loaded by default.

MitUNet architecture/inference is adapted from the official implementation by
Dmitriy Parashchuk, Alexey Kapshitskiy, and Yuriy Karyakin:
https://github.com/aliasstudio/mitunet
https://doi.org/10.1007/s00138-026-01815-y

Upstream code is MIT licensed. The authors explicitly license published weights
under CC-BY-NC 4.0 and restrict commercial use. Commercial hosting requires
appropriate permission or independently trained, appropriately licensed weights.
Running the model behind an API does not remove this restriction.

Checkpoint: `mitunet_finetune_a6_mit_b4_tversky_8864_28E.pth`, 257383307 bytes.
Published Git-LFS SHA-256:
`9c56c86723b0b5099ea63c82b5cac2f9c98c1816536003a78e422b7fcfadfbaf`.
The downloader verifies this hash before installation. PyTorch uses
`weights_only=True` and strict state-dictionary loading; no remote Python is run.

OCR uses PP-OCRv4 pretrained detection and recognition models through the pinned
`rapidocr-onnxruntime==1.4.4` package. ONNX files are bundled in the wheel, so
inference does not download models at startup. RapidOCR documents PaddleOCR
upstream and converted model artifacts under Apache License 2.0. Copyright
remains with the respective upstream authors:
https://github.com/PaddlePaddle/PaddleOCR
https://github.com/RapidAI/RapidOCR

The optional combined engine uses MitUNet structural walls and CubiCasa5K
openings/fixtures. Both checkpoints retain their respective non-commercial
restrictions. Selecting the default CubiCasa5K engine restores its own structural
walls as well as its openings and fixture predictions.

## Optional local vision review

[Qwen3-VL-4B-Instruct](https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct)
is Apache 2.0; the recommended local adapter uses Ollama's `qwen3-vl:4b` package.
Install its weights explicitly on the recognition host and retain the package's
license and model digest. This reviewer does not change the existing CubiCasa
checkpoint's noncommercial restriction.

[Laya Vision](https://huggingface.co/thaitea/laya-vision) published weights are
**CC BY-NC-SA 4.0**, including a noncommercial and share-alike restriction.
Its independent [vision fork](https://github.com/r33drichards/laya-vision) code
is Apache 2.0. The adapter loads an explicitly selected local checkpoint in an
isolated environment with Hugging Face/Transformers offline mode enabled.
Commercial use of these published weights requires appropriate permission.
Pin code/checkpoint revisions and preserve model checksums for evaluations.

Text-only [Laya](https://github.com/NandhaKishorM/laya) is a different package
and cannot judge pixels; it is not a dependency of this integration.
Neither vision model is downloaded by recognition or installed by default.
See [the integration research and limits](../../FLOOR-PLAN-VISION-REVIEW.md).
