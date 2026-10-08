"""Contract and geometry protection tests; scripted reviewers prove no accuracy."""
import asyncio
import base64
import copy
import io
import json
import os
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image

import app
from colored_walls import recognize
from laya_vision_worker import run
from evaluate_vision import score_review
from vision_contract import valid_answer
from vision_ollama_worker import classify as ollama_classify, NoRedirect
from vision_review import LayaReviewer, OllamaReviewer, VisionReview, crop_for, make_reviewer, review_result, suspicious_regions


def fixture():
    pixels = np.full((240, 400, 3), 255, np.uint8)
    cv2.line(pixels, (40, 60), (360, 60), (80, 80, 80), 9)
    cv2.line(pixels, (40, 60), (40, 200), (80, 80, 80), 9)
    cv2.line(pixels, (100, 25), (300, 25), (0, 0, 0), 1)
    walls = [{'kind': 'wall', 'a': [.1, .25], 'b': [.9, .25]},
             {'kind': 'wall', 'a': [.1, .25], 'b': [.1, 5/6]},
             {'kind': 'wall', 'a': [.25, 25/240], 'b': [.75, 25/240]},
             {'kind': 'door', 'a': [.4, .25], 'b': [.5, .25]}]
    return Image.fromarray(pixels), {'engine': 'cubicasa5k', 'walls': walls, 'rooms': [], 'furniture': [], 'inferenceMs': 1}


class VisionTests(unittest.TestCase):
    def test_default_makes_no_provider_or_optional_ocr_imports(self):
        with patch.dict(os.environ, {}, clear=True), patch('vision_review.OllamaReviewer') as provider:
            reviewer = make_reviewer()
        self.assertFalse(reviewer.status()['enabled'])
        provider.assert_not_called()
        image, original = fixture()
        self.assertEqual(reviewer.review(image, original)['state'], 'disabled')

    def test_review_cannot_mutate_original_geometry_even_when_model_is_wrong(self):
        image, original = fixture()
        # OCR crossing a thick true wall intentionally sends it to a wrong reviewer.
        original['annotations'] = [{'type': 'measurement-text', 'text': '12 ft',
                                    'polygon': [[.4, .2], [.6, .2], [.6, .3], [.4, .3]]}]
        before = copy.deepcopy(original)
        provider = SimpleNamespace(provider='ollama', model='test', classify=lambda *_:
                                   {'classification': 'measurement-line', 'reason': 'Scripted wrong classification'})
        result = review_result(VisionReview(provider), image, original)
        self.assertEqual(original, before)
        for key in ('walls', 'rooms', 'furniture'):
            self.assertIs(result[key], original[key])
        review = result['visionReview']
        self.assertEqual(review['automaticRemovals'], 0)
        true_wall = next(item for item in review['items'] if item['a'] == original['walls'][0]['a'] and item['b'] == original['walls'][0]['b'])
        self.assertTrue(true_wall['evidence']['thickSupport'])
        self.assertTrue(true_wall['evidence']['connected'])
        self.assertIn('12 ft', true_wall['ocrText'])

    def test_contextual_crop_preserves_aspect_pixels_and_original_coordinates(self):
        image, result = fixture()
        wall = result['walls'][2]
        crop = crop_for(image, wall)
        picture = Image.open(io.BytesIO(base64.b64decode(crop['image'])))
        self.assertLessEqual(max(picture.size), 512)
        self.assertGreater(picture.width, picture.height)
        x0, y0, x1, y1 = crop['cropBounds']
        self.assertLess(x0, wall['a'][0]); self.assertGreater(x1, wall['b'][0])
        self.assertLess(y0, wall['a'][1]); self.assertGreater(y1, wall['a'][1])
        for point, expected in zip(crop['segment'], [wall['a'], wall['b']]):
            np.testing.assert_allclose([x0 + point[0]*(x1-x0), y0 + point[1]*(y1-y0)], expected, atol=1e-6)

    def test_filled_colored_walls_do_not_become_suspicious_from_black_text_alone(self):
        image, result = fixture()
        candidates = suspicious_regions(image, result)
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]['a'], result['walls'][2]['a'])
        self.assertFalse(candidates[0]['evidence']['thickSupport'])
        self.assertTrue(all(candidate['a'] != result['walls'][3]['a'] for candidate in candidates))

    def test_failure_and_crop_limit_preserve_structure(self):
        image, result = fixture()
        for error in (TimeoutError(), ValueError('invalid JSON'), OSError('offline')):
            def failing(*_):
                raise error
            reviewed = review_result(VisionReview(SimpleNamespace(provider='ollama', model='test', classify=failing)), image, result)
            self.assertEqual(reviewed['visionReview']['state'], 'unavailable')
            self.assertEqual(reviewed['walls'], result['walls'])
        result['walls'] = [{'kind': 'wall', 'a': [.2, .1+i*.08], 'b': [.8, .1+i*.08]} for i in range(8)]
        reviewer = VisionReview(SimpleNamespace(provider='ollama', model='test', classify=lambda *_:
                               {'classification': 'uncertain', 'reason': 'Synthetic'}))
        reviewed = reviewer.review(Image.new('RGB', (400, 240), 'white'), result)
        self.assertEqual(reviewed['reviewed'], 6)
        self.assertEqual(reviewed['totalCandidates'], 8)
        self.assertEqual(reviewed['state'], 'partial')

    def test_invalid_scores_and_categories_abstain(self):
        for value in [None, {'classification': 'door', 'reason': 'x'},
                      {'classification': 'wall', 'reason': 'x', 'score': float('nan')},
                      {'classification': 'wall', 'reason': 'x', 'score': True},
                      {'classification': 'wall', 'reason': ''}]:
            with self.assertRaises(ValueError):
                valid_answer(value)

    def test_remote_endpoints_redirects_and_cloud_names_are_rejected(self):
        for url in ['https://example.com', 'http://10.0.0.1:11434', 'http://localhost.evil.test',
                    'http://localhost:11434/api', 'http://user:secret@localhost:11434', 'http://localhost/?x=1']:
            with self.assertRaises(ValueError):
                OllamaReviewer(url)
        with self.assertRaises(ValueError):
            OllamaReviewer(model='qwen3-vl:cloud')
        OllamaReviewer('http://[::1]:11434')

    def test_ollama_sends_schema_image_and_segment_without_claiming_confidence(self):
        image, result = fixture()
        crop = {**crop_for(image, result['walls'][2]), 'ocrText': '12 ft'}
        provider = OllamaReviewer()
        response = SimpleNamespace(read1=None)
        chunks = iter([json.dumps({'done': True, 'message': {'content': json.dumps({
            'classification': 'measurement-line', 'reason': 'Dimension tick marks'})}}).encode(), b''])
        response.read1 = lambda _: next(chunks)
        response.__enter__ = lambda: response
        class Context:
            def __enter__(self): return response
            def __exit__(self, *_): pass
        opener = unittest.mock.Mock()
        opener.open.return_value = Context()
        answer = ollama_classify(provider.url, provider.model, crop, 2, opener)
        opened = opener.open
        sent = json.loads(opened.call_args.args[0].data)
        self.assertEqual(sent['messages'][0]['images'], [crop['image']])
        self.assertIn('12 ft', sent['messages'][0]['content'])
        self.assertIn('segment_endpoints_in_crop', sent['messages'][0]['content'])
        self.assertFalse(sent['stream']); self.assertFalse(sent['think'])
        self.assertIsNone(answer['score'])
        self.assertEqual(sent['format']['properties']['classification']['enum'][0], 'wall')
        with self.assertRaises(ValueError):
            NoRedirect().redirect_request(None, None, None, None, None, 'http://remote.test')

    def test_worker_timeout_and_ocr_failure_leave_original_walls_available(self):
        image, original = fixture()
        reviewer = VisionReview(OllamaReviewer(), ocr=True)
        with patch('vision_review.subprocess.run', side_effect=subprocess.TimeoutExpired('worker', 1)) as worker:
            result = review_result(reviewer, image, original)
        self.assertIs(result['walls'], original['walls'])
        self.assertEqual(result['visionReview']['state'], 'unavailable')
        self.assertEqual(result['visionReview']['ocrState'], 'unavailable')
        self.assertTrue(all(call.kwargs['timeout'] <= 8 for call in worker.call_args_list))

    def test_ollama_subprocess_wire_contract_against_loopback_stub(self):
        requests = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_POST(self):
                requests.append(json.loads(self.rfile.read(int(self.headers['content-length']))))
                payload = json.dumps({'done': True, 'message': {'content': json.dumps({
                    'classification': 'measurement-line', 'reason': 'Scripted loopback reply'})}}).encode()
                self.send_response(200); self.send_header('content-type', 'application/json')
                self.send_header('content-length', str(len(payload))); self.end_headers(); self.wfile.write(payload)
        with ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                image, original = fixture()
                reviewer = VisionReview(OllamaReviewer(f'http://127.0.0.1:{server.server_port}'))
                result = review_result(reviewer, image, original)
                self.assertEqual(result['visionReview']['state'], 'complete')
                self.assertEqual(result['visionReview']['reviewed'], 1)
                self.assertIs(result['walls'], original['walls'])
                self.assertEqual(requests[0]['model'], 'qwen3-vl:4b')
                self.assertEqual(len(requests[0]['messages'][0]['images']), 1)
                self.assertIsNone(result['visionReview']['items'][0]['score'])
            finally:
                server.shutdown(); thread.join(timeout=2)

    def test_laya_native_adapter_uses_image_text_choice_and_strict_truncation(self):
        image, result = fixture()
        crop = {**crop_for(image, result['walls'][2]), 'ocrText': '12 ft'}
        calls = []
        def predict(state, questions, **kwargs):
            calls.append((state, questions, kwargs))
            return {'answers': {'region': {'choice': 'measurement-line', 'probabilities': {'measurement-line': .7}}}}
        answers = run(SimpleNamespace(predict=predict), [crop])
        self.assertEqual(answers[0]['score'], .7)
        self.assertIsInstance(calls[0][0]['image'], Image.Image)
        self.assertEqual(calls[0][0]['ocr_text'], '12 ft')
        self.assertEqual(calls[0][1]['region']['type'], 'choice')
        self.assertTrue(calls[0][2]['strict'])

    def test_api_opt_in_preserves_exact_standard_result_and_masks(self):
        image, result = fixture()
        model = SimpleNamespace(engine='cubicasa5k', predict=lambda *_: (result, 'rooms-mask', 'icons-mask'))
        with patch.object(app, 'pipeline', model):
            plain = app.analyze_drawing(image, 30, 40, 'combined', 'standard')
            self.assertIs(plain[0], result)
            reviewed = app.analyze_drawing(image, 30, 40, 'combined', 'standard', True)
            self.assertEqual(reviewed[1:], plain[1:])
            self.assertIs(reviewed[0]['walls'], result['walls'])
        self.assertNotIn('visionReview', result)

    def test_api_rejects_non_boolean_opt_in_before_inference(self):
        class Request:
            headers = {}
            async def stream(self):
                yield json.dumps({'image': 'image', 'width': 30, 'depth': 40, 'visionReview': 'yes'}).encode()
        with patch.object(app, 'pipeline', object()), patch('app.decode_image'), patch('app.analyze_drawing') as analyze:
            with self.assertRaises(app.HTTPException) as context:
                asyncio.run(app.analyze(Request()))
            self.assertEqual(context.exception.status_code, 400)
            analyze.assert_not_called()

    def test_evaluation_counts_false_wall_flags_and_wrong_true_wall_flags_separately(self):
        _, original = fixture()
        labels = [{**wall, 'classification': 'wall' if i < 2 else 'measurement-line'}
                  for i, wall in enumerate(original['walls'][:3])]
        reviewed = {**original, 'visionReview': {'state': 'partial', 'items': [
            {**wall, 'classification': 'measurement-line'} for wall in original['walls'][:3]]}}
        report = score_review(original, reviewed, labels, original)
        self.assertEqual(report['falseWallsFlagged'], 1)
        self.assertEqual(report['genuineWallsFlagged'], 2)
        self.assertTrue(report['protectedBaselineMatched'])
        self.assertEqual(report['automaticGenuineWallsRejected'], 0)
        with self.assertRaises(ValueError):
            score_review(original, {**reviewed, 'walls': []}, labels)
        with self.assertRaises(ValueError):
            score_review(original, reviewed, labels, {**original, 'furniture': [{'type': 'bed'}]})


if __name__ == '__main__':
    unittest.main()
