"""CPU CubiCasa5K inference and editable geometry extraction.

Image coordinates are normalized to [0,1]; real dimensions remain user supplied
in feet, matching the existing editor. Room masks and fixture classes are kept
separate from the model's heatmaps. No guessed scale or height is inferred.
"""
import base64
import io
import math
import os
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError
from skimage.morphology import skeletonize

ROOT = Path(__file__).resolve().parent
MODEL_PATH = ROOT / "models" / "model_best_val_loss_var.pkl"
ROOMS = ["Background", "Outdoor", "Wall", "Kitchen", "Living room", "Bedroom",
         "Bathroom", "Entry", "Railing", "Storage", "Garage", "Undefined"]
ICONS = ["No icon", "Window", "Door", "Closet", "Appliance", "Toilet", "Sink",
         "Sauna bench", "Fireplace", "Bathtub", "Chimney"]
FIXTURES = {3: "wardrobe", 4: "appliance", 5: "toilet", 6: "sink", 7: "other",
            8: "other", 9: "other", 10: "other"}
Image.MAX_IMAGE_PIXELS = 16_000_000


def decode_image(value):
    if not isinstance(value, str) or len(value) > 2_500_000:
        raise ValueError("Choose a floor plan smaller than 1.8 MB after compression.")
    prefix, sep, encoded = value.partition(",")
    if not sep or prefix not in {"data:image/png;base64", "data:image/jpeg;base64", "data:image/webp;base64"}:
        raise ValueError("Choose a PNG, JPEG or WebP floor plan.")
    try:
        with Image.open(io.BytesIO(base64.b64decode(encoded, validate=True))) as im:
            if im.format not in {"PNG", "JPEG", "WEBP"}:
                raise ValueError("The image content must be PNG, JPEG or WebP.")
            if min(im.size) < 40 or im.width * im.height > 16_000_000:
                raise ValueError("Use a drawing at least 40 pixels on each side and at most 16 megapixels.")
            im = ImageOps.exif_transpose(im).convert("RGBA")
            background = Image.new("RGBA", im.size, "white")
            background.alpha_composite(im)
            return background.convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ValueError("The floor plan image could not be decoded.") from exc


def prepare_image(image, size=512):
    # Aspect-preserving resize, then pad to multiples of 64 for the hourglass.
    factor = min(1.0, size / max(image.size))
    # Keep aspect ratio even for very wide images (the minimum check is on source).
    width, height = [max(1, round(v * factor)) for v in image.size]
    pw, ph = math.ceil(width / 64) * 64, math.ceil(height / 64) * 64
    x, y = (pw - width) // 2, (ph - height) // 2
    pixels = np.full((ph, pw, 3), 255, np.uint8)
    pixels[y:y+height, x:x+width] = np.asarray(image.resize((width, height), Image.Resampling.LANCZOS))
    return pixels, (x, y, width, height)


def components(mask, minimum=8):
    count, labels, stats, centers = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    for index in range(1, count):
        if stats[index, cv2.CC_STAT_AREA] >= minimum:
            yield labels == index, stats[index], centers[index]


def mask_segments(mask, close=True, epsilon=2.2):
    """Trace a skeleton graph instead of extruding the outlines of thick walls."""
    mask = mask.astype(np.uint8)
    if close:
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    clean = np.zeros_like(mask)
    for region, _, _ in components(mask, max(6, mask.size * .00004)):
        clean[region] = 1
    skel = skeletonize(clean > 0)
    coords = set(map(tuple, np.argwhere(skel)))
    if not coords:
        return []
    offsets = [(a, b) for a in (-1, 0, 1) for b in (-1, 0, 1) if (a, b) != (0, 0)]
    def neighbors(p):
        return [(p[0]+a, p[1]+b) for a, b in offsets if (p[0]+a, p[1]+b) in coords]
    degree = cv2.filter2D(skel.astype(np.uint8), cv2.CV_16S, np.ones((3, 3), np.int16)) - skel
    junctions = (skel & (degree != 2)).astype(np.uint8)
    # Closed loops have no degree-1/3 junctions; seed each unrepresented loop.
    for region, _, _ in components(skel, 1):
        if not np.any(junctions[region]):
            junctions[tuple(np.argwhere(region)[0])] = 1
    node_count, nodes = cv2.connectedComponents(junctions, connectivity=8)
    centers = {i: np.argwhere(nodes == i).mean(axis=0) for i in range(1, node_count)}
    visited, paths = set(), []
    def edge(a, b):
        return tuple(sorted((a, b)))
    for p in sorted(coords):
        node = nodes[p]
        if not node:
            continue
        for q in neighbors(p):
            if nodes[q] == node or edge(p, q) in visited:
                continue
            route, previous, current = [centers[node]], p, q
            visited.add(edge(p, q))
            while True:
                route.append(np.array(current))
                if nodes[current]:
                    route[-1] = centers[nodes[current]]
                    break
                following = [n for n in neighbors(current) if n != previous and edge(current, n) not in visited]
                if not following:
                    break
                nxt = following[0]
                visited.add(edge(current, nxt))
                previous, current = current, nxt
            if len(route) >= 2:
                paths.append(np.array(route, np.float32)[:, ::-1])
    output = []
    minimum = max(2.0, min(mask.shape) * .005)
    for route in paths:
        points = cv2.approxPolyDP(route.reshape(-1, 1, 2), epsilon, False).reshape(-1, 2)
        if np.linalg.norm(route[0]-route[-1]) <= 1 and len(points) >= 3:
            points = np.vstack([points, points[0]])
        for a, b in zip(points, points[1:]):
            if np.linalg.norm(a-b) >= minimum:
                output.append((a, b))
    return output


def vectorize(room_labels, icon_labels, room_probs, icon_probs, width_ft, depth_ft, include_walls=True):
    h, w = room_labels.shape
    norm = lambda p: [round(float(np.clip(p[0] / w, 0, 1)), 6), round(float(np.clip(p[1] / h, 0, 1)), 6)]
    structural = np.isin(room_labels, [2, 8]) | np.isin(icon_labels, [1, 2])
    segments = mask_segments(structural)
    walls = [{"kind": "wall", "a": norm(a), "b": norm(b)} for a, b in segments
             if math.hypot((a[0]-b[0])*width_ft/w, (a[1]-b[1])*depth_ft/h) >= .1] if include_walls else []
    furniture, rooms = [], []
    for cls in range(1, 11):
        for region, stats, center in components(icon_labels == cls, max(6, w*h*.000025)):
            yx = np.argwhere(region)
            rect = cv2.minAreaRect(yx[:, ::-1].astype(np.float32))
            corners = cv2.boxPoints(rect)
            e0, e1 = corners[1]-corners[0], corners[2]-corners[1]
            axis = e0 if np.linalg.norm(e0) >= np.linalg.norm(e1) else e1
            length = float(np.linalg.norm(axis))
            if cls in (1, 2):
                if length < 3:
                    continue
                direction = axis / max(length, 1e-6)
                a, b = np.array(rect[0]) - axis/2, np.array(rect[0]) + axis/2
                candidates = []
                for sa, sb in segments:
                    d = sb-sa
                    ln = float(np.linalg.norm(d))
                    if ln < 3 or abs(np.dot(d/ln, direction)) < .8:
                        continue
                    t = float(np.dot(center-sa, d) / (ln*ln))
                    projection = sa + np.clip(t, 0, 1)*d
                    distance = float(np.linalg.norm(center-projection))
                    if distance < max(10, min(w, h)*.025):
                        candidates.append((distance, sa, d/ln))
                if candidates:
                    _, anchor, direction = min(candidates, key=lambda v: v[0])
                    mid = anchor + np.dot(center-anchor, direction)*direction
                    a, b = mid-direction*length/2, mid+direction*length/2
                opening = {"kind": "window" if cls == 1 else "door", "a": norm(a), "b": norm(b),
                           "confidence": round(float(icon_probs[cls][region].mean()), 3)}
                if math.hypot((opening['a'][0]-opening['b'][0])*width_ft, (opening['a'][1]-opening['b'][1])*depth_ft) >= .1:
                    walls.append(opening)
            else:
                x, y, bw, bh, area = map(int, stats)
                fw, fd = bw/w*width_ft, bh/h*depth_ft
                if fw < .25 or fd < .25 or fw > 15 or fd > 15:
                    continue
                furniture.append({"type": FIXTURES[cls], "label": ICONS[cls], "center": norm(center),
                                  "width": round(max(.5, fw), 2), "depth": round(max(.5, fd), 2),
                                  "rotation": 0, "source": "detected", "confidence": round(float(icon_probs[cls][region].mean()), 3),
                                  "detector": "cubicasa5k"})
    for cls in [3, 4, 5, 6, 7, 9, 10, 11]:
        for region, stats, center in components(room_labels == cls, max(20, w*h*.002)):
            contours, _ = cv2.findContours(region.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            contour = max(contours, key=cv2.contourArea)
            polygon = cv2.approxPolyDP(contour, 2, True).reshape(-1, 2)
            if len(polygon) >= 3:
                rooms.append({"type": ROOMS[cls], "polygon": [norm(p) for p in polygon],
                              "areaSqFt": round(int(stats[4])/(w*h)*width_ft*depth_ft, 2),
                              "confidence": round(float(room_probs[cls][region].mean()), 3)})
    if len(walls) > 250:
        raise ValueError("More than 250 wall/opening segments were detected. Crop to one floor and remove legends.")
    return {"walls": walls, "furniture": furniture[:100], "rooms": rooms}


class Pipeline:
    engine = "cubicasa5k"

    def __init__(self, weights=MODEL_PATH, size=512):
        import torch
        from vendor.cubicasa_model import hg_furukawa_original
        self.torch, self.size = torch, size
        torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
        self.model = hg_furukawa_original(44)
        # Only tensors and safe built-in types are deserialized; never unpickle code.
        checkpoint = torch.load(weights, map_location="cpu", weights_only=True)
        self.model.load_state_dict(checkpoint["model_state"], strict=True)
        self.model.eval()

    def predict(self, image, width_ft, depth_ft, include_walls=True):
        pixels, (x, y, w, h) = prepare_image(image, self.size)
        tensor = self.torch.from_numpy(pixels.transpose(2, 0, 1).copy()).float().unsqueeze(0)/127.5-1
        start = time.perf_counter()
        with self.torch.inference_mode():
            output = self.model(tensor)
            output = self.torch.nn.functional.interpolate(output, size=pixels.shape[:2], mode="bilinear", align_corners=False)
            room_probs = output[0, 21:33].softmax(0).numpy()[:, y:y+h, x:x+w]
            icon_probs = output[0, 33:44].softmax(0).numpy()[:, y:y+h, x:x+w]
        room_labels, icon_labels = room_probs.argmax(0), icon_probs.argmax(0)
        geometry = vectorize(room_labels, icon_labels, room_probs, icon_probs, width_ft, depth_ft, include_walls)
        geometry.update({"engine": "cubicasa5k", "device": "cpu", "inferenceMs": round((time.perf_counter()-start)*1000),
                         "imageSize": list(image.size), "maskSize": [w, h],
                         "warnings": ["Review geometry and calibrate scale before using the model.",
                                      "CubiCasa5K detects fixed fixtures; movable furniture suggestions use image rules."]})
        return geometry, room_labels, icon_labels


def make_pipeline():
    """Restore FLRplanner/CubiCasa by default; load the experiment only explicitly."""
    engine = os.environ.get("FLOORPLAN_ENGINE", "cubicasa5k")
    if engine == "cubicasa5k":
        return Pipeline()
    if engine == "mitunet":
        from mitunet_pipeline import MitUNetPipeline
        return MitUNetPipeline()
    raise ValueError("FLOORPLAN_ENGINE must be cubicasa5k or mitunet.")


def write_artifacts(directory, result, room_labels, icon_labels):
    import json
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "recognition.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    Image.fromarray(room_labels.astype(np.uint8)).save(directory / "room-mask.png")
    Image.fromarray(icon_labels.astype(np.uint8)).save(directory / "icon-mask.png")
    colors = np.array([[250, 250, 250], [225, 225, 225], [40, 70, 180], [248, 200, 125],
                       [196, 216, 170], [205, 192, 228], [149, 215, 222], [245, 217, 175],
                       [120, 120, 120], [217, 187, 157], [190, 190, 190], [230, 230, 230]], np.uint8)
    display = colors[room_labels]
    display[icon_labels == 1] = [0, 158, 181]
    display[icon_labels == 2] = [185, 99, 47]
    display[icon_labels >= 3] = [211, 168, 25]
    Image.fromarray(display).save(directory / "segmentation.png")
