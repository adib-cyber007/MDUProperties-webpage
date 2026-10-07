# CubiCasa5K inference model

`cubicasa_model.py` is adapted from
https://github.com/CubiCasa/CubiCasa5k/blob/master/floortrans/models/hg_furukawa_original.py.
Copyright 2019. Licensed under CC BY-NC 4.0 (see CUBICASA-LICENSE.txt).

Changes: removed the training-only model_1427 import and pose-weight initializer.
Inference uses the published 44-channel checkpoint on CPU; the architecture is otherwise unchanged.
The downloaded weights are not committed. This research integration is not cleared for commercial use.

Citation: Kalervo et al., "CubiCasa5K: A Dataset and an Improved Multi-Task Model
for Floorplan Image Analysis", SCIA 2019, https://arxiv.org/abs/1904.01920.
