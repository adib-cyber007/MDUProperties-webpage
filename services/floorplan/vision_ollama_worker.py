"""Bounded local Ollama wire adapter; parent process imposes a hard deadline."""
import json
import sys
import time
from urllib.request import HTTPRedirectHandler, Request, ProxyHandler, build_opener
from vision_contract import INSTRUCTIONS, SCHEMA, valid_answer


def classify(url, model, crop, timeout, opener=None):
    opener = opener or build_opener(ProxyHandler({}), NoRedirect())
    content = INSTRUCTIONS + '\nReturn JSON matching ' + json.dumps(SCHEMA) + '\n' + json.dumps({
        'segment_endpoints_in_crop': crop['segment'], 'ocr_text': crop['ocrText']})
    payload = {'model': model, 'stream': False, 'think': False, 'format': SCHEMA,
               'options': {'temperature': 0, 'num_predict': 180, 'num_ctx': 4096},
               'messages': [{'role': 'user', 'content': content, 'images': [crop['image']]}]}
    request = Request(url + '/api/chat', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    deadline = time.monotonic() + timeout
    with opener.open(request, timeout=timeout) as response:
        # Set one overall deadline as well as the socket inactivity timeout.
        chunks, length = [], 0
        while True:
            chunk = response.read1(4096)
            if not chunk:
                break
            length += len(chunk)
            if length > 65536 or time.monotonic() > deadline:
                raise ValueError('Vision response exceeded its limits')
            chunks.append(chunk)
    result = json.loads(b''.join(chunks))
    if result.get('done') is not True:
        raise ValueError('Vision response was incomplete')
    return valid_answer(json.loads(result['message']['content']))


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError("Vision redirects are not allowed")


if __name__ == "__main__":
    crop = json.loads(sys.stdin.buffer.read(4_000_001))
    print(json.dumps(classify(sys.argv[1], sys.argv[2], crop, float(sys.argv[3])), allow_nan=False))
