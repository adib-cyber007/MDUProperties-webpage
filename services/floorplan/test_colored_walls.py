import unittest
from types import SimpleNamespace

import cv2
import numpy as np
from PIL import Image

from colored_walls import detect_colored_structure, recognize, structural_walls, window_gaps


def fixture():
    pixels = np.full((800, 520, 3), 255, np.uint8)
    yellow = (230, 230, 10)
    cv2.rectangle(pixels, (140, 180), (380, 680), yellow, 10)
    cv2.line(pixels, (140, 320), (300, 320), yellow, 10)
    cv2.line(pixels, (260, 480), (260, 680), yellow, 10)
    cv2.line(pixels, (260, 480), (380, 480), yellow, 10)
    # Black outer page frame and dimension rails are intentionally prominent.
    cv2.rectangle(pixels, (25, 70), (485, 760), (0, 0, 0), 3)
    cv2.line(pixels, (100, 120), (430, 120), (0, 0, 0), 2)
    return pixels


class ColoredWallTests(unittest.TestCase):
    def test_black_frame_and_measurements_cannot_supply_walls(self):
        pixels = fixture()
        structure = detect_colored_structure(Image.fromarray(pixels))
        self.assertIsNotNone(structure)
        walls = structural_walls(structure)
        self.assertGreaterEqual(len(walls), 6)
        for wall in walls:
            a, b = np.array(wall['a']) * [520, 800], np.array(wall['b']) * [520, 800]
            self.assertTrue(a[0] == b[0] or a[1] == b[1], 'second path emits straight orthogonal runs')
            self.assertTrue(all(130 <= p[0] <= 390 and 170 <= p[1] <= 690 for p in [a, b]))

    def test_grey_walls_coloured_text_thin_ink_and_room_fills_do_not_route(self):
        gray = fixture()
        yellow = (gray[:, :, 0] > 100) & (gray[:, :, 2] < 100)
        gray[yellow] = [90, 90, 90]
        cv2.putText(gray, 'BEDROOM', (150, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (240, 0, 0), 2)
        self.assertIsNone(detect_colored_structure(Image.fromarray(gray)))
        fills = np.full_like(gray, 255)
        cv2.rectangle(fills, (140, 180), (380, 680), (230, 230, 10), -1)
        self.assertIsNone(detect_colored_structure(Image.fromarray(fills)))
        thin = np.full_like(gray, 255)
        cv2.rectangle(thin, (140, 180), (380, 680), (230, 230, 10), 2)
        self.assertIsNone(detect_colored_structure(Image.fromarray(thin)))

    def test_standard_branch_returns_exact_existing_detector_result_and_image(self):
        sentinel = ({'engine': 'cubicasa5k', 'walls': []}, None, None)
        calls = []
        model = SimpleNamespace(engine='cubicasa5k', predict=lambda *args: calls.append(args) or sentinel)
        image = Image.new('RGB', (600, 800), 'white')
        self.assertIs(recognize(model, image, 30, 40), sentinel)
        self.assertIs(calls[0][0], image)
        # Explicit original mode bypasses routing even on coloured plans.
        colored = Image.fromarray(fixture())
        self.assertIs(recognize(model, colored, 30, 40, profile='standard'), sentinel)
        self.assertIs(calls[1][0], colored)

    def test_forced_colour_failure_preserves_geometry_instead_of_silent_fallback(self):
        model = SimpleNamespace(engine='cubicasa5k', predict=lambda *args: self.fail('No silent fallback'))
        with self.assertRaises(ValueError):
            recognize(model, Image.new('RGB', (600, 800), 'white'), 30, 40, profile='colored')
        with self.assertRaises(ValueError):
            recognize(model, Image.new('RGB', (600, 800), 'white'), 30, 40, profile='unknown')
        model.engine = 'mitunet'
        with self.assertRaises(ValueError):
            recognize(model, Image.fromarray(fixture()), 30, 40, profile='colored')

    def test_window_needs_bounded_gap_and_two_parallel_rails(self):
        pixels = fixture()
        pixels[390:450, 132:149] = 255
        for x in [137, 143]:
            cv2.line(pixels, (x, 390), (x, 450), (0, 0, 0), 1)
        windows = window_gaps(detect_colored_structure(Image.fromarray(pixels)))
        self.assertEqual(len(windows), 1)
        # A blank door gap alone must not become a window.
        pixels[390:450, 132:149] = 255
        self.assertEqual(window_gaps(detect_colored_structure(Image.fromarray(pixels))), [])


if __name__ == '__main__':
    unittest.main()
