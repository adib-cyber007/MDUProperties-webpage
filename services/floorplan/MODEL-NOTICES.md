# Recognition model provenance

The default recognition engine is the restored CubiCasa5K research pipeline
adapted from FLRplanner. It supplies walls, doors, windows, room predictions and
fixed fixture suggestions. The existing CC-BY-NC 4.0 restriction remains; see
[vendor/NOTICE.md](vendor/NOTICE.md). The browser separately proposes movable
furniture using this project's image rules.

MitUNet and OCR are used only when the optional comparison engine is explicitly
selected with `FLOORPLAN_ENGINE=mitunet`; they are not loaded by default.

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
