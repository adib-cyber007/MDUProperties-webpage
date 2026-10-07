import unittest

import cv2
import numpy as np
from PIL import Image

from annotations import arrow_symbols, dimension_lines, filter_wall_mask, is_measurement
from mitunet_pipeline import wall_geometry


def annotation(kind, x0, y0, x1, y1, text="", size=200):
    return {"type":kind,"text":text,"confidence":.95,
            "polygon":(np.array([[x0,y0],[x1,y0],[x1,y1],[x0,y1]])/size).tolist()}


class AnnotationTests(unittest.TestCase):
    def test_numbers_with_units_are_dimensions_but_room_names_are_not(self):
        for text in ['2400', '12\' 6"', '3.20', '250 cm', '4.5 m']:
            self.assertTrue(is_measurement(text), text)
        for text in ['Bedroom', 'Kitchen 1', 'Room 2', 'WC', '13m2', '41m²', 'BH=700']:
            self.assertFalse(is_measurement(text), text)

    def test_dimension_rail_requires_numeric_anchor_and_two_caps(self):
        pixels=np.full((200,200,3),255,np.uint8)
        cv2.line(pixels,(25,30),(175,30),(0,0,0),1)
        for x in [25,175]:cv2.line(pixels,(x,15),(x,48),(0,0,0),1)
        image=Image.fromarray(pixels)
        regions=[annotation('measurement-text',80,8,120,23,'3000')]
        found=dimension_lines(image,regions)
        self.assertTrue(found)
        self.assertEqual(dimension_lines(image,[]),[])
        pixels[:,175]=255
        self.assertEqual(dimension_lines(Image.fromarray(pixels),regions),[])

    def test_text_fragment_removed_but_a_wall_crossing_label_survives(self):
        probs=np.zeros((200,200),np.float32)
        cv2.line(probs,(15,100),(185,100),.99,9)
        probs[70:75,90:97]=.7
        mask,removed=filter_wall_mask(probs,[annotation('text',85,65,110,107,'label')])
        self.assertFalse(mask[72,93])
        self.assertTrue(mask[100,95])
        self.assertGreater(removed.sum(),0)

    def test_dimension_line_removed_while_thick_perpendicular_wall_survives(self):
        probs=np.zeros((200,200),np.float32)
        cv2.line(probs,(20,30),(180,30),.85,1)
        cv2.line(probs,(100,15),(100,150),.99,9)
        mask,_=filter_wall_mask(probs,[annotation('dimension-line',19,27,181,33)])
        self.assertFalse(mask[30,50]);self.assertTrue(mask[30,100])

    def test_uncertain_walls_do_not_enter_mesh_and_open_gaps_stay_open(self):
        probs=np.zeros((200,200),np.float32)
        cv2.line(probs,(20,60),(85,60),.99,7)
        cv2.line(probs,(115,60),(180,60),.99,7)
        cv2.line(probs,(20,130),(180,130),.7,7)
        result,_=wall_geometry(probs,[],30,30)
        self.assertTrue(result['walls']);self.assertTrue(result['candidates'])
        self.assertEqual(result['furniture'],[])
        for wall in result['walls']:
            self.assertGreaterEqual(wall['confidence'],.82)
            self.assertFalse(min(wall['a'][0],wall['b'][0])<.45 and max(wall['a'][0],wall['b'][0])>.55)
            self.assertLess(wall['a'][1],.4)

    def test_empty_image_never_invents_structure(self):
        result,_=wall_geometry(np.zeros((200,200),np.float32),[],30,40)
        self.assertEqual(result['walls'],[]);self.assertEqual(result['candidates'],[])

    def test_isolated_pointer_is_rejected_without_erasing_rectangle_wall_piers(self):
        pixels=np.full((200,200,3),255,np.uint8)
        cv2.fillPoly(pixels,[np.array([[160,30],[180,50],[180,10]])],(0,0,0))
        cv2.rectangle(pixels,(30,30),(50,70),(0,0,0),-1)
        symbols=arrow_symbols(Image.fromarray(pixels))
        self.assertEqual(len(symbols),1)
        self.assertEqual(symbols[0]['type'],'symbol')
        self.assertGreater(np.mean(symbols[0]['polygon'],axis=0)[0],.7)


if __name__=='__main__':unittest.main()
