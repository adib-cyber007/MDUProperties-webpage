"""PaddleOCR ONNX text regions plus conservative, text-anchored dimension rails.

A thin line alone is never a dimension: a numeric label and extension/tick
evidence at BOTH ends are required. Text removal protects continuous wall cores.
All annotation coordinates are normalized to the unmodified input image.
"""
import re

import cv2
import numpy as np


def is_measurement(text):
    text = str(text).strip()
    # Area labels (13m2), room numbers and height callouts (BH=700) are not
    # evidence that a nearby long line is a linear dimension rail.
    return bool(re.fullmatch(r"\d+(?:[.,]\d+)?\s*(?:mm|cm|m|ft|feet|in|inch)", text, re.I)
                or re.fullmatch(r"\d+[.,]\d+", text)
                or re.fullmatch(r"[\d\s.,'\"′″xX×+/-]{2,}", text) and (re.search(r"\d{2}", text) or re.search(r"['\"′″]", text)))


class AnnotationDetector:
    def __init__(self):
        # Models are bundled in the pinned wheel; requests never download code/weights.
        from rapidocr_onnxruntime import RapidOCR
        self.engine = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=1)

    def detect(self, image):
        w, h = image.size
        factor = min(1.0, 1600 / max(w, h))
        pixels = np.asarray(image.resize((max(1, round(w * factor)), max(1, round(h * factor)))))
        result, _ = self.engine(pixels[:, :, ::-1].copy(), use_cls=False)
        ph, pw = pixels.shape[:2]
        regions = []
        for polygon, text, confidence in (result or [])[:200]:
            if float(confidence) < .5:
                continue
            points = np.asarray(polygon, np.float32) / [pw, ph]
            regions.append({"type": "measurement-text" if is_measurement(text) else "text",
                            "text": str(text)[:80], "confidence": round(float(confidence), 3),
                            "polygon": np.clip(points, 0, 1).round(6).tolist()})
        return (regions + dimension_lines(image, regions) + arrow_symbols(image))[:300]


def arrow_symbols(image):
    """Isolated filled triangular pointers are annotation evidence, not walls."""
    factor=min(1.0,1600/max(image.size))
    pixels=np.asarray(image.resize(tuple(max(1,round(v*factor)) for v in image.size)))
    h,w=pixels.shape[:2]
    binary=(cv2.cvtColor(pixels,cv2.COLOR_RGB2GRAY)<180).astype(np.uint8)
    contours,_=cv2.findContours(binary,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    result=[]
    for contour in contours:
        area=cv2.contourArea(contour)
        x,y,bw,bh=cv2.boundingRect(contour)
        if not 25<=area<=max(600,w*h*.003) or min(bw,bh)<6 or not .3<=area/(bw*bh)<=.7:
            continue
        polygon=cv2.approxPolyDP(contour,cv2.arcLength(contour,True)*.035,True)
        if len(polygon)!=3:
            continue
        corners=np.array([[x,y],[x+bw,y],[x+bw,y+bh],[x,y+bh]])/[w,h]
        result.append({"type":"symbol","text":"Triangular pointer","confidence":.9,
                       "polygon":np.clip(corners,0,1).round(6).tolist()})
        if len(result)==50:break
    return result


def dimension_lines(image, regions):
    """Find horizontal/vertical rails using numeric OCR and two end caps."""
    factor = min(1.0, 1600 / max(image.size))
    pixels = np.asarray(image.resize(tuple(max(1, round(v * factor)) for v in image.size)))
    h, w = pixels.shape[:2]
    binary = (cv2.cvtColor(pixels, cv2.COLOR_RGB2GRAY) < 195).astype(np.uint8) * 255
    raw = cv2.HoughLinesP(binary, 1, np.pi / 180, threshold=20,
                         minLineLength=max(8, min(w, h) * .01), maxLineGap=3)
    if raw is None:
        return []
    lines = raw.reshape(-1, 4).astype(float)
    texts = [np.asarray(r["polygon"]) * [w, h] for r in regions if r["type"] == "measurement-text"]
    dimensions = []
    for x1, y1, x2, y2 in sorted(lines, key=lambda p: -np.hypot(p[2]-p[0], p[3]-p[1]))[:500]:
        a, b = np.array([x1, y1]), np.array([x2, y2])
        d, length = b-a, np.linalg.norm(b-a)
        if length < max(40, min(w, h) * .065) or min(abs(d[0]), abs(d[1])) > length * .035:
            continue
        u = d / length
        anchored = False
        for polygon in texts:
            center = polygon.mean(axis=0)
            along = np.dot(center-a, u)
            distance = abs(u[0]*(center-a)[1]-u[1]*(center-a)[0])
            short_side = min(np.ptp(polygon[:, 0]), np.ptp(polygon[:, 1]))
            if length * .12 < along < length * .88 and distance < max(12, short_side * 1.8):
                anchored = True
                break
        if not anchored:
            continue
        def end_cap(point):
            for cap in lines:
                c, e = cap[:2], cap[2:]
                v = e-c
                ln = np.linalg.norm(v)
                # Perpendicular extensions or diagonal arrow/tick strokes.
                if not 5 <= ln <= min(90, length * .4) or abs(np.dot(v/ln, u)) > .8:
                    continue
                t = np.clip(np.dot(point-c, v) / ln**2, 0, 1)
                if np.linalg.norm(point-(c+t*v)) <= 8:
                    return True
            return False
        if not end_cap(a) or not end_cap(b):
            continue
        if any(np.linalg.norm((a+b)/2 - np.mean(np.asarray(r["polygon"]) * [w, h], axis=0)) < 8 for r in dimensions):
            continue
        normal = np.array([-u[1], u[0]]) * 2.5
        polygon = np.array([a-normal, b-normal, b+normal, a+normal]) / [w, h]
        dimensions.append({"type": "dimension-line", "text": "", "confidence": .9,
                           "polygon": np.clip(polygon, 0, 1).round(6).tolist()})
        if len(dimensions) == 100:
            break
    return dimensions


def filter_wall_mask(probs, annotations):
    """Remove annotation support without erasing the cores of intersecting walls."""
    h, w = probs.shape
    mask = (probs >= .55).astype(np.uint8)
    distance = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
    horizontal = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 25), np.uint8))
    vertical = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((25, 3), np.uint8))
    text_protected = ((probs >= .96) & (distance >= 1.5)) | (horizontal > 0) | (vertical > 0)
    # Thick, very confident cores survive dimension rails crossing an actual wall.
    dimension_protected = (probs >= .97) & (distance >= 3)
    removed = np.zeros_like(mask)
    for region in annotations:
        area = np.zeros_like(mask)
        polygon = np.rint(np.asarray(region["polygon"]) * [w-1, h-1]).astype(np.int32)
        cv2.fillPoly(area, [polygon], 1)
        protected = dimension_protected if region["type"] in {"dimension-line","symbol"} else text_protected
        reject = (area > 0) & ~protected & (mask > 0)
        removed[reject] = 1
        mask[reject] = 0
    return mask, removed
