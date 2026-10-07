import unittest
from types import SimpleNamespace
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image

from mitunet_pipeline import MitUNetPipeline, fuse_openings
from pipeline import vectorize


def line(kind,a,b):return {'kind':kind,'a':a,'b':b}


class CombinationTests(unittest.TestCase):
    def setUp(self):
        self.walls=[line('wall',[.1,.3],[.4,.3]),line('wall',[.6,.3],[.9,.3])]
        self.door=line('door',[.42,.305],[.58,.305])

    def test_opening_spanning_supported_gap_is_aligned_without_changing_walls(self):
        result=fuse_openings(self.walls,[self.door],[],(1000,500))
        self.assertEqual(len(result),1)
        self.assertEqual(result[0]['kind'],'door')
        self.assertAlmostEqual(result[0]['a'][1],.3)
        self.assertAlmostEqual(result[0]['b'][1],.3)
        self.assertEqual(self.walls[0]['b'],[.4,.3])

    def test_isolated_and_perpendicular_openings_are_rejected(self):
        bad=[line('window',[.4,.8],[.6,.8]),line('door',[.5,.2],[.5,.4])]
        self.assertEqual(fuse_openings(self.walls,bad,[],(1000,500)),[])
        self.assertEqual(fuse_openings([], [self.door],[],(1000,500)),[])

    def test_annotation_opening_is_rejected_and_duplicates_merge(self):
        annotation={'type':'dimension-line','polygon':[[.3,.25],[.7,.25],[.7,.35],[.3,.35]]}
        self.assertEqual(fuse_openings(self.walls,[self.door],[annotation],(1000,500)),[])
        self.assertEqual(len(fuse_openings(self.walls,[self.door,self.door],[],(1000,500))),1)

    def test_combined_result_never_imports_auxiliary_false_walls(self):
        probs=np.zeros((200,200),np.float32)
        cv2.line(probs,(20,60),(80,60),.99,7)
        cv2.line(probs,(120,60),(180,60),.99,7)
        auxiliary={'walls':[self.door,line('wall',[.1,.05],[.9,.05])],
                   'furniture':[{'type':'sink'}],'rooms':[{'type':'Kitchen'}]}
        model=MitUNetPipeline.__new__(MitUNetPipeline)
        model.device='cpu';model.annotations=SimpleNamespace(detect=lambda image:[])
        model.probabilities=lambda image:probs
        model.auxiliary=SimpleNamespace(predict=lambda *args,**kwargs:(auxiliary,None,None))
        image=Image.new('RGB',(1000,500),'white')
        walls,_,_=model.predict(image,30,40,mode='walls')
        combined,_,_=model.predict(image,30,40)
        self.assertEqual([w for w in combined['walls'] if w['kind']=='wall'],walls['walls'])
        self.assertTrue(any(w['kind']=='door' for w in combined['walls']))
        self.assertEqual(combined['furniture'],auxiliary['furniture'])
        self.assertEqual(combined['rooms'],auxiliary['rooms'])

    def test_unused_auxiliary_wall_fragments_do_not_block_detail_extraction(self):
        rooms=np.zeros((200,200),np.uint8);icons=np.zeros_like(rooms)
        icons[60:66,60:90]=2;icons[100:115,100:120]=5
        rprobs=np.eye(12)[rooms].transpose(2,0,1)
        iprobs=np.eye(11)[icons].transpose(2,0,1)
        segments=[(np.array([20,20]),np.array([180,20]))]*260
        with patch('pipeline.mask_segments',return_value=segments):
            with self.assertRaises(ValueError):vectorize(rooms,icons,rprobs,iprobs,30,40)
            details=vectorize(rooms,icons,rprobs,iprobs,30,40,include_walls=False)
        self.assertEqual([w['kind'] for w in details['walls']],['door'])
        self.assertEqual(details['furniture'][0]['type'],'toilet')


if __name__=='__main__':unittest.main()
