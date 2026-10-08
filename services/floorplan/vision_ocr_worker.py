"""Optional bundled RapidOCR in a process the reviewer can stop on timeout."""
import base64
from contextlib import redirect_stdout
import io
import json
import sys
from PIL import Image

if __name__ == '__main__':
    encoded = json.loads(sys.stdin.buffer.read(12_000_001))
    with redirect_stdout(sys.stderr):
        from annotations import AnnotationDetector
        image = Image.open(io.BytesIO(base64.b64decode(encoded, validate=True))).convert('RGB')
        if max(image.size) > 1600:
            raise ValueError('OCR image exceeds its limit')
        annotations = AnnotationDetector().detect(image)
    print(json.dumps(annotations, allow_nan=False))
