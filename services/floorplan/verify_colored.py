"""Real-image routing and geometry regression, not an accuracy benchmark."""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from colored_walls import detect_colored_structure, recognize
from pipeline import Pipeline, write_artifacts


def overlay(image, result, path):
    pixels = np.asarray(image).copy()
    for line in result['walls']:
        a, b = [tuple(np.round(np.array(line[key]) * image.size).astype(int)) for key in ['a', 'b']]
        cv2.line(pixels, a, b, (220, 0, 0) if line['kind'] == 'wall' else (0, 140, 220), 3)
    Image.fromarray(pixels).save(path)


def verify(first, second, output):
    model = Pipeline()
    output.mkdir(parents=True, exist_ok=True)
    ordinary = Image.open(first).convert('RGB')
    baseline, _, _ = model.predict(ordinary, 30, 40)
    routed, rooms, icons = recognize(model, ordinary, 30, 40)
    assert detect_colored_structure(ordinary) is None
    for key in ['engine', 'walls', 'furniture', 'rooms']:
        assert routed[key] == baseline[key], f'Automatic routing changed the first plan: {key}'
    write_artifacts(output / 'first-plan', routed, rooms, icons)
    overlay(ordinary, routed, output / 'first-plan-overlay.png')

    colored = Image.open(second).convert('RGB')
    structure = detect_colored_structure(colored)
    assert structure is not None
    result, rooms, icons = recognize(model, colored, 30, 40)
    assert result['engine'] == 'color-walls'
    write_artifacts(output / 'second-plan', result, rooms, icons)
    overlay(colored, result, output / 'second-plan-overlay.png')
    walls = [line for line in result['walls'] if line['kind'] == 'wall']
    height, width = structure.mask.shape
    x0, y0, x1, y1 = structure.bounds
    rendered = np.zeros_like(structure.mask)
    for line in walls:
        a, b = [np.array(line[key]) * [width, height] for key in ['a', 'b']]
        assert abs(a[0] - b[0]) < .002 or abs(a[1] - b[1]) < .002
        assert all(x0 - 3 <= p[0] <= x1 + 3 and y0 - 3 <= p[1] <= y1 + 3 for p in [a, b])
        cv2.line(rendered, tuple(a.round().astype(int)), tuple(b.round().astype(int)), 1, round(structure.thickness + 4))
    coverage = float(rendered[structure.mask > 0].mean())
    assert coverage > .95, 'Accepted vectors lost substantial coloured wall fill'
    report = {'pass': True, 'accuracyBenchmark': False, 'firstPlanOutputUnchanged': True,
              'firstPlan': {kind: sum(w['kind'] == kind for w in routed['walls']) for kind in ['wall', 'door', 'window']},
              'secondPlan': {kind: sum(w['kind'] == kind for w in result['walls']) for kind in ['wall', 'door', 'window']},
              'secondPlanFixtures': len(result['furniture']), 'straightWalls': True,
              'wallFillCoverageWithinTolerance': round(coverage, 4),
              'acceptedWallsOutsideColouredBuildingBounds': 0, 'inferenceMs': result['inferenceMs']}
    (output / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('first', type=Path)
    parser.add_argument('second', type=Path)
    parser.add_argument('--output', type=Path, default=Path('work/colored-wall-verification'))
    args = parser.parse_args()
    verify(args.first, args.second, args.output)
