"""MitUNet walls plus FLRplanner/CubiCasa openings and fixture suggestions.

Architecture: aliasstudio/mitunet (MIT). Published checkpoint: CC-BY-NC 4.0.
Auxiliary wall predictions never enter the fused structural geometry.
"""
import math
import os
import time
from pathlib import Path

import cv2
import numpy as np

from annotations import AnnotationDetector, filter_wall_mask
from download_mitunet import TARGET, verify
from pipeline import mask_segments


def wall_geometry(probs, annotations, width_ft, depth_ft):
    mask, removed = filter_wall_mask(probs, annotations)
    h, w = mask.shape
    walls, candidates = [], []
    support = cv2.dilate(mask, np.ones((3, 3), np.uint8))
    for a, b in mask_segments(mask, close=False, epsilon=1.2):
        norm = lambda p: np.clip(p / [w, h], 0, 1).round(6).tolist()
        na, nb = norm(a), norm(b)
        if math.hypot((na[0]-nb[0])*width_ft, (na[1]-nb[1])*depth_ft) < .1:
            continue
        points = np.linspace(a, b, max(3, int(np.linalg.norm(a-b))*2)).round().astype(int)
        points[:, 0] = points[:, 0].clip(0, w-1)
        points[:, 1] = points[:, 1].clip(0, h-1)
        # A simplified line must still follow its mask, never bridge an empty gap.
        supported = float(support[points[:, 1], points[:, 0]].mean())
        confidence = round(float(probs[points[:, 1], points[:, 0]].mean()), 3)
        segment = {"kind": "wall", "a": na, "b": nb, "confidence": confidence}
        if confidence >= .82 and supported >= .98:
            walls.append(segment)
        else:
            candidates.append({**segment, "reason": "Low wall confidence" if confidence < .82 else "Geometry needs review"})
    if len(walls) + len(candidates) > 250:
        raise ValueError("This drawing has too many wall fragments. Crop to one floor or use a clearer original.")
    return {"walls": walls, "furniture": [], "rooms": [], "candidates": candidates,
            "annotations": annotations,
            "summary": {"textRegions": sum(a["type"] in {"text","measurement-text"} for a in annotations),
                        "dimensionLines": sum(a["type"] == "dimension-line" for a in annotations),
                        "symbolRegions": sum(a["type"] == "symbol" for a in annotations),
                        "removedPixels": int(removed.sum()), "reviewSegments": len(candidates)}}, mask


def fuse_openings(walls, detected, annotations, image_size):
    """Align detail detections to accepted wall runs or gaps bounded by those runs.

    Use original-image proportions for angle/distance checks. Mere proximity to any
    wall is insufficient; both ends require collinear wall support. Dimensions and
    pointer annotations cannot supply openings. Original walls are never rewritten.
    """
    scale=np.asarray(image_size,dtype=float)*512/max(image_size)
    primary=[(np.asarray(w['a'])*scale,np.asarray(w['b'])*scale) for w in walls if w['kind']=='wall']
    out=[]
    cross=lambda a,b:a[0]*b[1]-a[1]*b[0]
    for opening in detected:
        if opening['kind'] not in {'door','window'}:
            continue
        a,b=np.asarray(opening['a'])*scale,np.asarray(opening['b'])*scale
        d=b-a;length=float(np.linalg.norm(d))
        if length<2:continue
        axis=d/length;mid=(a+b)/2
        samples=np.linspace(a/scale,b/scale,9)
        if any(sum(cv2.pointPolygonTest(np.asarray(region['polygon'],np.float32),tuple(map(float,p)),False)>=0 for p in samples)>=3
               for region in annotations if region['type'] in {'dimension-line','symbol'}):
            continue
        options=[]
        tolerance=max(2.5,min(scale)*.012)
        end_tolerance=max(5.0,length*.4)
        for sa,sb in primary:
            wd=sb-sa;wl=np.linalg.norm(wd)
            if wl<2:continue
            u=wd/wl
            if abs(np.dot(u,axis))<.94:continue
            offset=abs(cross(u,mid-sa))
            if offset>tolerance:continue
            aligned=sa+np.dot(mid-sa,u)*u
            spans=[]
            for ca,cb in primary:
                cd=cb-ca;cl=np.linalg.norm(cd)
                if cl<2 or abs(np.dot(cd/cl,u))<.94:continue
                if max(abs(cross(u,ca-aligned)),abs(cross(u,cb-aligned)))>tolerance:continue
                spans.append(sorted([float(np.dot(ca-aligned,u)),float(np.dot(cb-aligned,u))]))
            def distance(t):return min((max(s-t,0,t-e) for s,e in spans),default=float('inf'))
            da,db=distance(-length/2),distance(length/2)
            if da>end_tolerance or db>end_tolerance:continue
            options.append((offset+(da+db)*.25,aligned,u))
        if not options:continue
        _,center,u=min(options,key=lambda option:option[0])
        na,nb=np.clip((center-u*length/2)/scale,0,1),np.clip((center+u*length/2)/scale,0,1)
        candidate={**opening,'a':na.round(6).tolist(),'b':nb.round(6).tolist()}
        def duplicates(existing):
            ca,cb=np.asarray(existing['a'])*scale,np.asarray(existing['b'])*scale
            ln=np.linalg.norm(cb-ca)
            if existing['kind']!=candidate['kind'] or ln<2 or abs(np.dot((cb-ca)/ln,u))<.98:return False
            if max(abs(cross(u,ca-center)),abs(cross(u,cb-center)))>tolerance:return False
            low,high=sorted([np.dot(ca-center,u),np.dot(cb-center,u)])
            overlap=min(length/2,high)-max(-length/2,low)
            return overlap>min(length,ln)*.6
        if not any(duplicates(existing) for existing in out):out.append(candidate)
    return out


class MitUNetPipeline:
    engine = "mitunet"

    def __init__(self, weights=TARGET):
        import torch
        import segmentation_models_pytorch as smp
        if Path(weights) == TARGET and not verify(TARGET):
            raise ValueError("Run services/floorplan/download_mitunet.py to install verified MitUNet weights.")
        self.torch = torch
        torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
        self.device = os.environ.get("FLOORPLAN_DEVICE", "cpu")
        if self.device not in {"cpu", "cuda"} or self.device == "cuda" and not torch.cuda.is_available():
            raise ValueError("FLOORPLAN_DEVICE must select an available cpu or cuda device.")
        aux = smp.Segformer(encoder_name="mit_b4", encoder_weights=None)
        self.model = smp.Unet(encoder_name="mit_b4", encoder_weights=None, in_channels=3,
                              classes=1, decoder_attention_type="scse")
        self.model.encoder = aux.encoder
        del aux
        state = torch.load(weights, map_location="cpu", weights_only=True)
        self.model.load_state_dict(state, strict=True)
        self.model.to(self.device).eval()
        self.annotations = AnnotationDetector()
        from pipeline import Pipeline
        # Both detectors must load before the combined service reports readiness.
        self.auxiliary = Pipeline()

    def probabilities(self, image):
        # Exact published square resize and ImageNet normalization; coordinates
        # are mapped back to the original rectangle through normalized endpoints.
        pixels = cv2.resize(np.asarray(image), (512, 512), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255
        pixels = (pixels - np.array([.485, .456, .406], np.float32)) / np.array([.229, .224, .225], np.float32)
        tensor = self.torch.from_numpy(pixels.transpose(2, 0, 1).copy()).unsqueeze(0).to(self.device)
        with self.torch.inference_mode():
            return self.model(tensor).sigmoid()[0, 0].cpu().numpy()

    def predict(self, image, width_ft, depth_ft, mode="combined"):
        start = time.perf_counter()
        annotations = self.annotations.detect(image)
        result, mask = wall_geometry(self.probabilities(image), annotations, width_ft, depth_ft)
        if mode in {"combined", "openings", "furniture"}:
            # Exclude unused CubiCasa wall predictions before its segment limit,
            # so measurement-heavy false walls cannot block detail extraction.
            auxiliary, _, _ = self.auxiliary.predict(image, width_ft, depth_ft, include_walls=False)
            if mode in {"combined", "furniture"}:
                result["furniture"] = auxiliary["furniture"]
                result["rooms"] = auxiliary["rooms"]
            if mode in {"combined", "openings"}:
                openings = fuse_openings(result["walls"], auxiliary["walls"], annotations, image.size)
                if len(result["walls"])+len(openings)+len(result["candidates"])>250:
                    raise ValueError("Too many combined wall/opening fragments. Crop to one floor.")
                result["walls"].extend(openings)
        result.update({"engine": self.engine, "device": self.device, "mode": mode,
                       "inferenceMs": round((time.perf_counter()-start)*1000),
                       "imageSize": list(image.size), "maskSize": [512, 512],
                       "sources": {"walls":"mitunet", "openings":"cubicasa5k", "furniture":"cubicasa5k"},
                       "warnings": ["Review walls and confirm the drawing scale. Uncertain segments are excluded from 3D."]})
        return result, mask * 2, np.zeros_like(mask)


def make_pipeline():
    from pipeline import make_pipeline as configured_pipeline
    return configured_pipeline()
