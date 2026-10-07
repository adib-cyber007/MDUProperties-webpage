"""Regression coverage for restoring FLRplanner as the active service default."""
import builtins
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import app
import pipeline


class ServiceDefaultsTests(unittest.TestCase):
    def test_default_loads_original_detector_without_importing_experimental_stack(self):
        original_import = builtins.__import__

        def import_default(name, *args, **kwargs):
            if name.split('.')[0] in {'mitunet_pipeline', 'annotations', 'rapidocr_onnxruntime', 'segmentation_models_pytorch'}:
                raise ImportError('Experimental stack must not be required for FLRplanner')
            return original_import(name, *args, **kwargs)

        with patch.dict(os.environ, {}, clear=True), patch('pipeline.Pipeline') as detector:
            with patch('builtins.__import__', side_effect=import_default):
                result = pipeline.make_pipeline()
            self.assertIs(result, detector.return_value)
            detector.assert_called_once_with()

    def test_health_identifies_loaded_flrplanner_instead_of_combined_pipeline(self):
        with patch.object(app, 'pipeline', SimpleNamespace(engine='cubicasa5k')):
            status = app.health()
        self.assertTrue(status['ready'])
        self.assertEqual(status['engine'], 'cubicasa5k')
        self.assertEqual(status['pipeline'], 'cubicasa5k')

    def test_invalid_explicit_engine_is_rejected_instead_of_falling_back(self):
        with patch.dict(os.environ, {'FLOORPLAN_ENGINE': 'unknown'}):
            with self.assertRaises(ValueError):
                pipeline.make_pipeline()


if __name__ == '__main__':
    unittest.main()
