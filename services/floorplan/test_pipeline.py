import base64
import io
import unittest

import cv2
import numpy as np
from PIL import Image

from pipeline import decode_image, mask_segments, prepare_image, vectorize


class GeometryTests(unittest.TestCase):
    def test_thick_wall_becomes_centerline_and_branch_survives(self):
        mask = np.zeros((200, 200), np.uint8)
        cv2.line(mask, (30, 100), (170, 100), 1, 9)
        cv2.line(mask, (100, 100), (100, 30), 1, 9)
        lines = mask_segments(mask)
        self.assertTrue(any(abs(a[1]-100)<3 and abs(b[1]-100)<3 for a, b in lines))
        self.assertTrue(any(abs(a[0]-100)<3 and abs(b[0]-100)<3 and min(a[1], b[1])<40 for a, b in lines))
        self.assertTrue(all(np.linalg.norm(a-b) > 2 for a,b in lines))

    def test_closed_wall_loop_and_diagonal_are_not_lost(self):
        mask = np.zeros((200, 200), np.uint8)
        cv2.rectangle(mask, (30,30), (170,170), 1, 7)
        lines = mask_segments(mask)
        self.assertGreaterEqual(len(lines), 4)
        points = np.concatenate([np.array([a,b]) for a,b in lines])
        self.assertGreater(points[:,0].max()-points[:,0].min(), 130)
        mask.fill(0); cv2.line(mask, (30,30), (170,170), 1, 7)
        lines = mask_segments(mask)
        self.assertTrue(any(abs(a[0]-a[1])<3 and abs(b[0]-b[1])<3 for a,b in lines))

    def test_room_opening_and_fixture_masks_share_original_coordinates(self):
        rooms = np.zeros((200, 300), np.uint8)
        cv2.rectangle(rooms, (30,30), (270,170), 2, 7)
        rooms[35:166, 35:266] = 5
        icons = np.zeros_like(rooms)
        icons[26:35, 120:145] = 2
        icons[166:175, 160:210] = 1
        icons[70:85, 60:80] = 5
        rprobs = np.eye(12)[rooms].transpose(2,0,1)
        iprobs = np.eye(11)[icons].transpose(2,0,1)
        out = vectorize(rooms, icons, rprobs, iprobs, 30, 20)
        self.assertEqual(sum(w['kind']=='door' for w in out['walls']), 1)
        self.assertEqual(sum(w['kind']=='window' for w in out['walls']), 1)
        door = next(w for w in out['walls'] if w['kind']=='door')
        self.assertAlmostEqual((door['a'][0]+door['b'][0])/2, .44, delta=.02)
        self.assertAlmostEqual(door['a'][1], .15, delta=.02)
        self.assertEqual(out['furniture'][0]['type'], 'toilet')
        self.assertEqual(out['furniture'][0]['confidence'], 1)
        self.assertTrue(any(r['type']=='Bedroom' for r in out['rooms']))

    def test_padding_preserves_aspect_ratio_and_alpha_uses_white(self):
        im = Image.new('RGBA', (1000, 400), (0,0,0,0))
        buf=io.BytesIO(); im.save(buf, format='PNG')
        decoded=decode_image('data:image/png;base64,'+base64.b64encode(buf.getvalue()).decode())
        self.assertEqual(decoded.getpixel((0,0)), (255,255,255))
        pixels, (_,_,w,h)=prepare_image(decoded)
        self.assertAlmostEqual(w/h, 2.5, delta=.01)
        self.assertEqual(pixels.shape[0]%64, 0); self.assertEqual(pixels.shape[1]%64, 0)

    def test_invalid_or_oversized_images_are_rejected(self):
        for value in [None, 'file:///private.png', 'data:image/png;base64,AAAA', 'data:image/svg+xml;base64,AAAA', 'x'*2_500_001]:
            with self.assertRaises(ValueError): decode_image(value)
        buf=io.BytesIO(); Image.new('RGB',(20,20)).save(buf,format='PNG')
        with self.assertRaises(ValueError): decode_image('data:image/png;base64,'+base64.b64encode(buf.getvalue()).decode())


if __name__ == '__main__': unittest.main()
