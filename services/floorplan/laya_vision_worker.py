"""Offline Laya Vision adapter, run in its own Python environment by vision_review.

Install the r33drichards/laya-vision fork, not the text-only PyPI laya package.
Only this optional worker imports it. Checkpoint and processor must be local.
"""
import base64
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import sys


def run(agent, crops):
    from PIL import Image
    from vision_contract import CLASSES, INSTRUCTIONS, valid_answer
    answers = []
    for crop in crops:
        image = Image.open(io.BytesIO(base64.b64decode(crop['image'], validate=True))).convert('RGB')
        state = {'image': image, 'segment_endpoints_in_crop': crop['segment'], 'ocr_text': crop['ocrText']}
        result = agent.predict(state, {'region': {'type': 'choice', 'instructions': INSTRUCTIONS,
                                                  'criteria': list(CLASSES)}}, strict=True)
        answer = result['answers']['region']
        choice = answer['choice']
        answers.append(valid_answer({'classification': choice, 'score': answer['probabilities'][choice],
                                     'reason': 'Local Laya Vision region classification; review against the drawing.'}))
    return answers


if __name__ == '__main__':
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    model_path = Path(sys.argv[1]).resolve()
    if not (model_path / 'vlm_agent_config.json').is_file():
        raise ValueError('A saved local Laya Vision checkpoint is required')
    crops = json.loads(sys.stdin.buffer.read(8_000_001))
    if not isinstance(crops, list) or len(crops) > 6:
        raise ValueError('At most six contextual crops are supported')
    with redirect_stdout(sys.stderr):
        import laya
        agent = laya.load_vlm(str(model_path), device=os.environ.get('FLOORPLAN_LAYA_DEVICE', 'cpu'))
        answers = run(agent, crops)
    print(json.dumps(answers, allow_nan=False))
