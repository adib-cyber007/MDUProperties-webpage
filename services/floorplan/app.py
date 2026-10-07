"""Bounded, local inference API. Start with python app.py; binds to loopback."""
import argparse
import base64
import json
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from pipeline import decode_image, make_pipeline, write_artifacts
from colored_walls import recognize

pipeline = None
startup_error = None
busy = threading.Lock()


@asynccontextmanager
async def lifespan(app):
    global pipeline, startup_error
    try:
        pipeline = make_pipeline()
    except Exception as error:
        startup_error = str(error)
        print(f"Recognition unavailable: {error}", flush=True)
    yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)


@app.get("/health")
def health():
    engine = getattr(pipeline, "engine", os.environ.get("FLOORPLAN_ENGINE", "cubicasa5k"))
    return {"ready": pipeline is not None, "engine": engine,
            "device": getattr(pipeline, "device", "cpu"), "license": "CC BY-NC 4.0",
            "wallOnly": False, "pipeline": "combined" if engine == "mitunet" else engine,
            "profiles": ["auto", "standard", "colored"] if engine == "cubicasa5k" else ["standard"],
            "error": "Install the model dependencies, download verified weights, and restart recognition." if startup_error else None}


@app.post("/analyze")
async def analyze(request: Request):
    if request.headers.get('origin'):
        raise HTTPException(403, "Use the authenticated website API to analyze drawings.")
    token = os.environ.get("FLOORPLAN_SERVICE_TOKEN", "")
    if token and request.headers.get("authorization") != f"Bearer {token}":
        raise HTTPException(401, "Recognition token was rejected.")
    if pipeline is None:
        raise HTTPException(503, "Recognition is unavailable. Install the weights and restart the service.")
    if not busy.acquire(blocking=False):
        raise HTTPException(429, "Recognition is busy. Try again when the current drawing finishes.")
    try:
        chunks, length = [], 0
        async for chunk in request.stream():
            length += len(chunk)
            if length > 2_600_000:
                raise HTTPException(413, "The floor plan image is too large.")
            chunks.append(chunk)
        try:
            body = json.loads(b"".join(chunks))
            if not isinstance(body, dict):
                raise ValueError("Send a floor plan image and dimensions.")
            width, depth = body.get("width"), body.get("depth")
            if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not 4 <= v <= 500 for v in (width, depth)):
                raise ValueError("Drawing width and depth must be between 4 and 500 feet.")
            image = decode_image(body.get("image"))
            mode = body.get("mode", "combined")
            if mode not in {"combined", "walls", "openings", "furniture"}:
                raise ValueError("Recognition mode must be combined, walls, openings, or furniture.")
            result, _, _ = await run_in_threadpool(recognize, pipeline, image, width, depth, mode, body.get("profile", "auto"))
            return result
        except (ValueError, TypeError) as error:
            raise HTTPException(400, str(error)) from error
    finally:
        busy.release()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--host", default=os.environ.get("FLOORPLAN_BIND_HOST", "127.0.0.1"))
    parser.add_argument("--mode", choices=["combined", "walls", "openings", "furniture"], default="combined")
    parser.add_argument("--profile", choices=["auto", "standard", "colored"], default="auto")
    parser.add_argument("--image", type=Path, help="Run a single image without starting the API")
    parser.add_argument("--output", type=Path, default=Path("work/floorplan-result"))
    parser.add_argument("--width", type=float, default=30)
    parser.add_argument("--depth", type=float, default=40)
    args = parser.parse_args()
    if args.image:
        suffix = args.image.suffix.lower()
        mime = {".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".webp": "webp"}.get(suffix)
        if not mime:
            parser.error("Choose a PNG, JPEG or WebP image.")
        if not 4 <= args.width <= 500 or not 4 <= args.depth <= 500:
            parser.error("Dimensions must be between 4 and 500 feet.")
        image = decode_image(f"data:image/{mime};base64," + base64.b64encode(args.image.read_bytes()).decode())
        model = make_pipeline()
        result, rooms, icons = recognize(model, image, args.width, args.depth, args.mode, args.profile)
        write_artifacts(args.output, result, rooms, icons)
        print(json.dumps({"engine": result["engine"], "walls": len(result["walls"]), "fixtures": len(result["furniture"]),
                          "rooms": len(result["rooms"]), "inferenceMs": result["inferenceMs"], "output": str(args.output)}))
    else:
        if args.host not in {"127.0.0.1", "localhost", "::1"} and not os.environ.get("FLOORPLAN_SERVICE_TOKEN"):
            parser.error("Set FLOORPLAN_SERVICE_TOKEN before exposing the recognition service on a network interface.")
        import uvicorn
        uvicorn.run(app, host=args.host, port=args.port, limit_concurrency=8)
