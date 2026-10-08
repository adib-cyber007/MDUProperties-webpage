"""Optional local semantic review. Never changes extracted geometry or masks.

The request opts in; the configured provider sees only bounded contextual crops.
Scores are uncalibrated on floor plans and cannot authorize automatic deletion.
"""
import base64
import io
import ipaddress
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import sys
from urllib.parse import urlsplit

import cv2
import numpy as np
from PIL import Image

from vision_contract import valid_answer

MAX_CROPS = 6


def point_distance(point, a, b):
    delta = b - a
    fraction = np.clip(np.dot(point - a, delta) / max(np.dot(delta, delta), 1e-9), 0, 1)
    return float(np.linalg.norm(point - (a + fraction * delta)))


def crop_for(image, wall):
    """Keep aspect ratio, neighboring structure, and unpainted original pixels."""
    w, h = image.size
    points = np.array([wall['a'], wall['b']]) * [w, h]
    padding = max(24, min(w, h) * .05)
    low = np.maximum(0, np.floor(points.min(axis=0) - padding)).astype(int)
    high = np.minimum([w, h], np.ceil(points.max(axis=0) + padding)).astype(int)
    crop = image.crop((*low, *high)).convert('RGB')
    crop.thumbnail((512, 512), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    crop.save(buffer, format='PNG')
    relative = (points - low) / (high - low)
    return {'image': base64.b64encode(buffer.getvalue()).decode('ascii'),
            'cropBounds': [round(low[0] / w, 6), round(low[1] / h, 6),
                           round(high[0] / w, 6), round(high[1] / h, 6)],
            'segment': relative.round(6).tolist()}


def suspicious_regions(image, result, annotations=()):
    """Prioritize OCR overlap, detached thin runs, and page-edge ink.

    These cues select review work only. Connected/thick/coloured evidence is
    retained to make conflicts explicit, rather than used as a deletion rule.
    """
    factor = min(1.0, 1600 / max(image.size))
    pixels = np.asarray(image.convert('RGB').resize(tuple(max(1, round(v * factor)) for v in image.size)))
    h, w = pixels.shape[:2]
    hsv = cv2.cvtColor(pixels, cv2.COLOR_RGB2HSV)
    ink = ((cv2.cvtColor(pixels, cv2.COLOR_RGB2GRAY) < 195) | ((hsv[:, :, 1] > 70) & (hsv[:, :, 2] < 250))).astype(np.uint8)
    thickness = cv2.distanceTransform(ink, cv2.DIST_L2, 5)
    walls = [wall for wall in result.get('walls', []) if wall.get('kind') == 'wall']
    runs = [np.array([wall['a'], wall['b']], dtype=float) * [w, h] for wall in walls]
    selected = []
    for index, (wall, run) in enumerate(zip(walls, runs)):
        a, b = run
        samples = a + np.linspace(.1, .9, 25)[:, None] * (b - a)
        xy = np.clip(np.rint(samples).astype(int), [0, 0], [w - 1, h - 1])
        thick = float(np.mean(thickness[xy[:, 1], xy[:, 0]] >= 2.5)) >= .6
        colored = float(np.mean(hsv[xy[:, 1], xy[:, 0], 1] > 70)) >= .6
        connected = any(any(point_distance(p, c, d) <= 7 for p in (a, b))
                        for j, (c, d) in enumerate(runs) if j != index)
        touching, texts = [], []
        for region in annotations:
            polygon = np.asarray(region['polygon']) * [w, h]
            low, high = polygon.min(axis=0) - 6, polygon.max(axis=0) + 6
            if np.any(np.all((samples >= low) & (samples <= high), axis=1)):
                touching.append(region['type'])
                if region.get('text'):
                    texts.append(region['text'][:80])
        edge = bool(np.any(samples[:, 0] < w * .07) or np.any(samples[:, 0] > w * .93)
                    or np.any(samples[:, 1] < h * .07) or np.any(samples[:, 1] > h * .93))
        reasons = []
        if touching:
            reasons.append('Overlaps OCR or annotation evidence')
        if not connected and not thick and not colored:
            reasons.append('Detached thin segment')
        elif not thick and not colored:
            reasons.append('Thin segment without filled wall support')
        if edge and not thick and not colored:
            reasons.append('Thin segment near page edge')
        if not reasons:
            continue
        priority = (3 if 'dimension-line' in touching else 2 if touching else 0) + (not connected) + edge
        selected.append((priority, index, {'a': list(wall['a']), 'b': list(wall['b']),
                         'selectionReason': '; '.join(reasons), 'ocrText': ' | '.join(texts)[:400],
                         'evidence': {'connected': connected, 'thickSupport': thick, 'coloredSupport': colored}}))
    return [item for _, _, item in sorted(selected, key=lambda entry: (-entry[0], entry[1]))]


def run_worker(python, filename, args, payload, timeout, env=None):
    worker = Path(__file__).with_name(filename)
    with tempfile.TemporaryFile() as output:
        subprocess.run([python, str(worker), *args], input=json.dumps(payload).encode(),
                       stdout=output, stderr=subprocess.DEVNULL, env=env, timeout=timeout, check=True)
        if output.tell() > 65536:
            raise ValueError('Vision response exceeded its limits')
        output.seek(0)
        return json.load(output)


class OllamaReviewer:
    provider = 'ollama'

    def __init__(self, url='http://127.0.0.1:11434', model='qwen3-vl:4b'):
        parsed = urlsplit(url)
        try:
            local = parsed.hostname == 'localhost' or ipaddress.ip_address(parsed.hostname).is_loopback
        except ValueError:
            local = False
        if not local or parsed.scheme != 'http' or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
            raise ValueError('Vision review requires a local loopback Ollama URL')
        if not model or len(model) > 100 or 'cloud' in model.lower():
            raise ValueError('Choose an installed local vision model')
        self.url, self.model = url.rstrip('/'), model

    def classify(self, crop, timeout):
        answer = run_worker(sys.executable, 'vision_ollama_worker.py',
                            [self.url, self.model, str(timeout)], crop, timeout)
        return valid_answer(answer)


class LayaReviewer:
    provider = 'laya-vision'
    model = 'thaitea/laya-vision (local checkpoint)'

    def __init__(self, python, model_path):
        self.python, self.model_path = str(Path(python).resolve()), str(Path(model_path).resolve())
        if not Path(self.python).is_file() or not Path(self.model_path, 'vlm_agent_config.json').is_file():
            raise ValueError('Configure an isolated Laya Vision Python and a local checkpoint')

    def classify_batch(self, crops, timeout):
        # Separate environment avoids the text-only laya package and dependency conflicts.
        # Kill the optional process on timeout; extraction remains available.
        env = {**os.environ, 'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1', 'HF_HUB_DISABLE_TELEMETRY': '1'}
        answers = run_worker(self.python, 'laya_vision_worker.py', [self.model_path], crops, timeout, env)
        if not isinstance(answers, list) or len(answers) != len(crops):
            raise ValueError('Invalid vision batch')
        return [valid_answer(answer) for answer in answers]


class VisionReview:
    def __init__(self, provider=None, ocr=False, max_crops=MAX_CROPS, budget=20):
        self.provider = provider
        self.ocr = ocr
        self.max_crops = min(MAX_CROPS, max(1, int(max_crops)))
        self.budget = min(30, max(1, float(budget)))

    def status(self):
        return {'enabled': self.provider is not None, 'provider': getattr(self.provider, 'provider', 'off'),
                'model': getattr(self.provider, 'model', ''), 'mode': 'review-only'}

    def review(self, image, result):
        if self.provider is None:
            return {'state': 'disabled', **self.status(), 'items': [], 'reviewed': 0, 'totalCandidates': 0,
                    'automaticRemovals': 0, 'ocrState': 'off', 'elapsedMs': 0}
        start = time.monotonic()
        annotations = result.get('annotations', [])
        ocr_state = 'existing' if annotations else 'off'
        if self.ocr and not annotations:
            try:
                sample = image.convert('RGB').copy()
                sample.thumbnail((1600, 1600))
                data = io.BytesIO()
                sample.save(data, format='PNG')
                annotations = run_worker(sys.executable, 'vision_ocr_worker.py', [],
                                         base64.b64encode(data.getvalue()).decode('ascii'), min(5, self.budget))
                ocr_state = 'complete'
            except Exception:
                ocr_state = 'unavailable'
        items, state = [], 'complete'
        candidates = []
        try:
            candidates = suspicious_regions(image, result, annotations)
            crops = [{**candidate, **crop_for(image, candidate)} for candidate in candidates[:self.max_crops]]
            if hasattr(self.provider, 'classify_batch') and crops:
                remaining = self.budget - (time.monotonic() - start)
                if remaining <= 0:
                    raise TimeoutError('Vision budget expired')
                answers = self.provider.classify_batch(crops, remaining)
                if len(answers) != len(crops):
                    raise ValueError('Invalid vision batch')
                pairs = zip(crops, answers)
                for crop, answer in pairs:
                    items.append(self._item(crop, answer))
            else:
                for crop in crops:
                    remaining = self.budget - (time.monotonic() - start)
                    if remaining <= 0:
                        state = 'partial'
                        break
                    answer = self.provider.classify(crop, min(8, remaining))
                    items.append(self._item(crop, answer))
            if len(items) < len(candidates):
                state = 'partial'
        except Exception:
            state = 'partial' if items else 'unavailable'
        return {'state': state, **self.status(), 'items': items, 'reviewed': len(items),
                'totalCandidates': len(candidates), 'automaticRemovals': 0, 'ocrState': ocr_state,
                'elapsedMs': round((time.monotonic() - start) * 1000)}

    @staticmethod
    def _item(crop, answer):
        return {**{key: crop[key] for key in ('a', 'b', 'cropBounds', 'ocrText', 'selectionReason', 'evidence')},
                **valid_answer(answer), 'decision': 'pending'}


def make_reviewer():
    provider = os.environ.get('FLOORPLAN_VISION_PROVIDER', 'off')
    if provider == 'off':
        return VisionReview()
    if provider == 'ollama':
        backend = OllamaReviewer(os.environ.get('FLOORPLAN_VISION_URL', 'http://127.0.0.1:11434'),
                                 os.environ.get('FLOORPLAN_VISION_MODEL', 'qwen3-vl:4b'))
    elif provider == 'laya-vision':
        backend = LayaReviewer(os.environ.get('FLOORPLAN_LAYA_PYTHON', ''), os.environ.get('FLOORPLAN_LAYA_MODEL_PATH', ''))
    else:
        raise ValueError('Vision provider must be off, ollama, or laya-vision')
    return VisionReview(backend, ocr=os.environ.get('FLOORPLAN_VISION_OCR', '0') == '1')


def review_result(reviewer, image, result):
    """Return separate metadata; preserve the original result and all arrays."""
    try:
        review = reviewer.review(image, result)
    except Exception:
        review = {'state': 'unavailable', **reviewer.status(), 'items': [], 'reviewed': 0,
                  'totalCandidates': 0, 'automaticRemovals': 0, 'ocrState': 'unavailable', 'elapsedMs': 0}
    return {**result, 'visionReview': review}
