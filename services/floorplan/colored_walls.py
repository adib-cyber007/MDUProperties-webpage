"""Separate conservative path for drawings with solid coloured, orthogonal walls.

Only the selected colour supplies wall geometry. Black borders, dimensions,
stairs and text cannot become walls. The ordinary CubiCasa detector is untouched.
"""
from dataclasses import dataclass
import time

import cv2
import numpy as np
from PIL import Image


@dataclass
class ColoredStructure:
    pixels: np.ndarray
    mask: np.ndarray
    lines: list
    bounds: tuple
    hue: int
    thickness: float


def _runs(mask, length, horizontal):
    kernel = np.ones((1, length) if horizontal else (length, 1), np.uint8)
    opened = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(opened, connectivity=8)
    out = []
    for index in range(1, count):
        x, y, width, height, area = stats[index]
        extent, thickness = (width, height) if horizontal else (height, width)
        if extent < length or extent < thickness * 2 or area < extent * thickness * .6:
            continue
        if thickness > min(mask.shape) * .055:
            continue
        region = labels == index
        yy, xx = np.nonzero(region)
        center = float(np.median(yy if horizontal else xx))
        out.append({'horizontal': horizontal, 'center': center,
                    'start': float((xx if horizontal else yy).min()),
                    'end': float((xx if horizontal else yy).max()),
                    'thickness': float(thickness), 'area': int(area)})
    return out


def detect_colored_structure(image):
    """Require thick colour-filled line networks, never merely coloured ink."""
    factor = min(1., 1600 / max(image.size))
    pixels = np.asarray(image.resize(tuple(max(1, round(v * factor)) for v in image.size)))
    height, width = pixels.shape[:2]
    hsv = cv2.cvtColor(pixels, cv2.COLOR_RGB2HSV)
    colorful = (hsv[:, :, 1] >= 110) & (hsv[:, :, 2] >= 80)
    if colorful.sum() < max(400, width * height * .003):
        return None
    histogram = np.bincount(hsv[:, :, 0][colorful], minlength=180)
    smoothed = sum(np.roll(histogram, shift) for shift in range(-4, 5))
    minimum = max(20, round(min(width, height) * .035))
    candidates = []
    for _ in range(4):
        hue = int(smoothed.argmax())
        if not smoothed[hue]:
            break
        distance = np.abs(hsv[:, :, 0].astype(int) - hue)
        distance = np.minimum(distance, 180 - distance)
        mask = (colorful & (distance <= 9)).astype(np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        long = _runs(mask, minimum, True) + _runs(mask, minimum, False)
        substantial = [line for line in long if line['thickness'] >= 5 and line['end'] - line['start'] >= minimum]
        for offset in range(-18, 19):
            smoothed[(hue + offset) % 180] = 0
        if len(substantial) < 4 or sum(line['horizontal'] for line in substantial) < 2 or sum(not line['horizontal'] for line in substantial) < 2:
            continue
        line_area = sum(line['area'] for line in long)
        if line_area < mask.sum() * .65:
            continue  # Large filled rooms, coloured photos and logos are not wall strips.
        thickness = float(np.median([line['thickness'] for line in substantial]))
        # Keep the largest nearby network; independent legend swatches stay out.
        radius = max(5, round(thickness * 8))
        groups = cv2.dilate(mask, np.ones((radius * 2 + 1, radius * 2 + 1), np.uint8))
        count, labels = cv2.connectedComponents(groups, connectivity=8)
        if count < 2:
            continue
        group = max(range(1, count), key=lambda label: int(mask[labels == label].sum()))
        mask = mask * (labels == group)
        yy, xx = np.nonzero(mask)
        if not len(xx) or xx.max() - xx.min() < min(width, height) * .25 or yy.max() - yy.min() < min(width, height) * .3:
            continue
        lines = _runs(mask, max(8, round(thickness * 1.5)), True) + _runs(mask, max(8, round(thickness * 1.5)), False)
        if len(lines) < 6:
            continue
        bounds = (int(xx.min()), int(yy.min()), int(xx.max()) + 1, int(yy.max()) + 1)
        candidates.append(ColoredStructure(pixels, mask, lines, bounds, hue, thickness))
    return max(candidates, key=lambda item: int(item.mask.sum()), default=None)


def _endpoints(line):
    c, a, b = line['center'], line['start'], line['end']
    return np.array([[a, c], [b, c]] if line['horizontal'] else [[c, a], [c, b]], dtype=float)


def structural_walls(structure):
    height, width = structure.mask.shape
    lines = structure.lines
    out = []
    for line in lines:
        endpoints = _endpoints(line)
        # Join only perpendicular strips whose original colour reaches the corner.
        for other in lines:
            if other['horizontal'] == line['horizontal']:
                continue
            intersection = np.array([other['center'], line['center']] if line['horizontal'] else [line['center'], other['center']])
            along = intersection[0 if other['horizontal'] else 1]
            tolerance = max(line['thickness'], other['thickness']) * .8
            if other['start'] - tolerance <= along <= other['end'] + tolerance:
                for index in range(2):
                    if np.linalg.norm(endpoints[index] - intersection) <= tolerance:
                        endpoints[index] = intersection
        if np.linalg.norm(endpoints[1] - endpoints[0]) < structure.thickness:
            continue
        out.append({'kind': 'wall', 'a': (endpoints[0] / [width, height]).round(6).tolist(),
                    'b': (endpoints[1] / [width, height]).round(6).tolist()})
    return out


def _gaps(structure):
    """Find bounded gaps on a shared coloured wall axis; no global gap closing."""
    tolerance = max(2, structure.thickness * .75)
    out = []
    for horizontal in [True, False]:
        remaining = [line for line in structure.lines if line['horizontal'] == horizontal]
        groups = []
        for line in sorted(remaining, key=lambda item: item['center']):
            group = next((g for g in groups if abs(np.median([item['center'] for item in g]) - line['center']) <= tolerance), None)
            if group is None:
                groups.append([line])
            else:
                group.append(line)
        for group in groups:
            group.sort(key=lambda item: item['start'])
            center = float(np.median([line['center'] for line in group]))
            for left, right in zip(group, group[1:]):
                length = right['start'] - left['end']
                if structure.thickness * 1.5 <= length <= structure.thickness * 16:
                    out.append({'horizontal': horizontal, 'center': center, 'start': left['end'], 'end': right['start']})
    return out


def window_gaps(structure):
    """Require parallel dark rails inside a bounded coloured-wall gap."""
    gray = cv2.cvtColor(structure.pixels, cv2.COLOR_RGB2GRAY)
    out = []
    height, width = gray.shape
    half = max(4, round(structure.thickness * 1.2))
    for gap in _gaps(structure):
        if gap['end'] - gap['start'] < structure.thickness * 2.5:
            continue  # Tiny ink interruptions at dimension callouts are not windows.
        a, b = round(gap['start'] + 3), round(gap['end'] - 3)
        c = round(gap['center'])
        lo, hi = max(0, c - half), c + half + 1
        patch = gray[lo:min(height, hi), a:b] if gap['horizontal'] else gray[a:b, lo:min(width, hi)]
        if not patch.size:
            continue
        rails = (patch < 145).mean(axis=1 if gap['horizontal'] else 0) >= .65
        groups = sum(value and (index == 0 or not rails[index - 1]) for index, value in enumerate(rails))
        if groups >= 2:
            points = _endpoints(gap)
            out.append({'kind': 'window', 'a': (points[0] / [width, height]).round(6).tolist(),
                        'b': (points[1] / [width, height]).round(6).tolist()})
    return out


def predict_colored(pipeline, image, width_ft, depth_ft, structure):
    start = time.perf_counter()
    pixels = structure.pixels.copy()
    pixels[structure.mask > 0] = [80, 80, 80]
    height, width = pixels.shape[:2]
    x0, y0, x1, y1 = structure.bounds
    padding = round(structure.thickness * 2)
    x0, y0, x1, y1 = max(0, x0 - padding), max(0, y0 - padding), min(width, x1 + padding), min(height, y1 + padding)
    crop = Image.fromarray(pixels[y0:y1, x0:x1])
    detail, _, _ = pipeline.predict(crop, width_ft * (x1 - x0) / width, depth_ft * (y1 - y0) / height, include_walls=False)
    transform = lambda p: [round((p[0] * (x1 - x0) + x0) / width, 6), round((p[1] * (y1 - y0) + y0) / height, 6)]
    walls = structural_walls(structure)
    openings = window_gaps(structure)
    # Neural openings must match an actual bounded coloured-wall gap.
    gaps = _gaps(structure)
    for found in detail['walls']:
        if found['kind'] != 'door':
            continue  # Windows require visible parallel rails, never neural guesses over dimensions.
        points = np.array([transform(found['a']), transform(found['b'])]) * [width, height]
        direction = points[1] - points[0]
        horizontal = abs(direction[0]) >= abs(direction[1])
        midpoint = points.mean(axis=0)
        options = [gap for gap in gaps if gap['horizontal'] == horizontal
                   and abs(midpoint[1 if horizontal else 0] - gap['center']) <= structure.thickness * 1.5
                   and gap['start'] - structure.thickness <= midpoint[0 if horizontal else 1] <= gap['end'] + structure.thickness]
        if not options:
            continue
        gap = min(options, key=lambda item: abs(midpoint[1 if horizontal else 0] - item['center']))
        gp = _endpoints(gap) / [width, height]
        if not any(np.linalg.norm((np.array(item['a']) + item['b']) / 2 - gp.mean(axis=0)) < .01 for item in openings):
            openings.append({**found, 'a': gp[0].round(6).tolist(), 'b': gp[1].round(6).tolist()})
    furniture = [{**item, 'center': transform(item['center'])} for item in detail['furniture']]
    rooms = [{**room, 'polygon': [transform(p) for p in room['polygon']]} for room in detail['rooms']]
    result = {'engine': 'color-walls', 'device': 'cpu', 'walls': walls + openings,
              'furniture': furniture, 'rooms': rooms, 'imageSize': list(image.size),
              'inferenceMs': round((time.perf_counter() - start) * 1000),
              'sources': {'walls': 'color-geometry', 'openings': 'color-gaps+cubicasa5k', 'furniture': 'cubicasa5k'},
              'routing': {'profile': 'colored', 'hue': structure.hue,
                          'buildingBounds': [round(x0 / width, 6), round(y0 / height, 6), round(x1 / width, 6), round(y1 / height, 6)]},
              'warnings': ['Only solid coloured orthogonal walls are extracted. Review gaps and confirm scale.']}
    if len(result['walls']) > 250:
        raise ValueError('Too many coloured wall segments. Crop to one floor.')
    return result, structure.mask * 2, np.zeros_like(structure.mask)


def recognize(pipeline, image, width_ft, depth_ft, mode='combined', profile='auto'):
    if profile not in {'auto', 'standard', 'colored'}:
        raise ValueError('Recognition profile must be auto, standard, or colored.')
    if profile == 'colored' and getattr(pipeline, 'engine', None) != 'cubicasa5k':
        raise ValueError('Coloured-wall recognition requires the FLRplanner/CubiCasa service.')
    if getattr(pipeline, 'engine', None) == 'cubicasa5k' and profile != 'standard':
        structure = detect_colored_structure(image)
        if structure is not None:
            return predict_colored(pipeline, image, width_ft, depth_ft, structure)
        if profile == 'colored':
            raise ValueError('No strong solid coloured-wall network was found. Choose FLRplanner or crop to the building.')
    kwargs = {'mode': mode} if getattr(pipeline, 'engine', None) == 'mitunet' else {}
    # Exact existing call/return on standard plans: no filters, snapping or merging.
    return pipeline.predict(image, width_ft, depth_ft, **kwargs)
