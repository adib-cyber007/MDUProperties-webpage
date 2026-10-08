"""Evaluate review flags against manually labeled *extracted* wall segments.

The first plan must supply an original recognition baseline. The report separates
useful flags from genuine-wall flags, missing review coverage and actual removals.
No model judgment is treated as ground truth; no automatic removal is enabled.
"""
import argparse
import base64
import json
from pathlib import Path

from colored_walls import recognize
from pipeline import decode_image, make_pipeline
from vision_contract import CLASSES
from vision_review import make_reviewer, review_result

GEOMETRY_FIELDS = ('engine', 'walls', 'rooms', 'furniture')


def geometry(result):
    return {key: result.get(key) for key in GEOMETRY_FIELDS}


def key(segment):
    return tuple(sorted(tuple(round(v, 6) for v in segment[end]) for end in ('a', 'b')))


def score_review(original, reviewed, labels, baseline=None):
    if geometry(original) != geometry(reviewed):
        raise ValueError('Vision review changed extracted geometry')
    if baseline is not None and geometry(original) != geometry(baseline):
        raise ValueError('Protected plan no longer matches its original baseline')
    labeled = {}
    for label in labels:
        if label.get('classification') not in CLASSES:
            raise ValueError('Labels must use the documented review classes')
        identity = key(label)
        if identity in labeled:
            raise ValueError('Label each extracted segment only once')
        labeled[identity] = label['classification']
    items = reviewed['visionReview']['items']
    matched = [(labeled[key(item)], item['classification']) for item in items if key(item) in labeled]
    rejected = lambda prediction: prediction != 'wall'
    confusion = {truth: {prediction: 0 for prediction in CLASSES} for truth in CLASSES}
    for truth, prediction in matched:
        confusion[truth][prediction] += 1
    wall_count = sum(truth == 'wall' for truth in labeled.values())
    nonwalls = {'measurement-line', 'description-box', 'furniture'}
    false_count = sum(truth in nonwalls for truth in labeled.values())
    false_flagged = sum(truth in nonwalls and rejected(prediction) for truth, prediction in matched)
    true_flagged = sum(truth == 'wall' and rejected(prediction) for truth, prediction in matched)
    extracted = {key(wall) for wall in original['walls'] if wall['kind'] == 'wall'}
    return {'geometryUnchanged': True, 'protectedBaselineMatched': baseline is not None,
            'labeledSegments': len(labeled), 'reviewedLabeledSegments': len(matched),
            'unreviewedLabeledSegments': len(labeled) - len(matched),
            'labelsAbsentFromExtraction': sum(identity not in extracted for identity in labeled),
            'unlabeledReviewedSegments': len(items) - len(matched),
            'falseWallsFlagged': false_flagged, 'genuineWallsFlagged': true_flagged,
            'falseWallFlagRecall': false_flagged / false_count if false_count else None,
            'genuineWallFlagRate': true_flagged / wall_count if wall_count else None,
            'automaticFalseWallsRemoved': 0, 'automaticGenuineWallsRejected': 0,
            'confusion': confusion, 'reviewState': reviewed['visionReview']['state']}


def evaluate(manifest_path, output_path):
    document = json.loads(manifest_path.read_text())
    plans = document.get('plans')
    if not isinstance(plans, list) or not plans or not plans[0].get('baseline'):
        raise ValueError('The first plan needs a baseline JSON from original recognition')
    root = manifest_path.parent
    reviewer = make_reviewer()
    if not reviewer.status()['enabled']:
        raise ValueError('Configure a local vision provider before evaluation')
    model = make_pipeline()
    reports = []
    for entry in plans:
        image_path = root / entry['image']
        mime = {'.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp'}.get(image_path.suffix.lower())
        if not mime:
            raise ValueError('Evaluation images must be PNG, JPEG or WebP')
        image = decode_image(f'data:image/{mime};base64,' + base64.b64encode(image_path.read_bytes()).decode())
        original, _, _ = recognize(model, image, entry.get('width', 30), entry.get('depth', 40), profile=entry.get('profile', 'auto'))
        baseline = json.loads((root / entry['baseline']).read_text()) if entry.get('baseline') else None
        reviewed = review_result(reviewer, image, original)
        reports.append({'id': str(entry.get('id', image_path.stem)),
                        **score_review(original, reviewed, entry.get('labels', []), baseline),
                        'review': reviewed['visionReview']})
    output_path.parent.mkdir(parents=True, exist_ok=True)
    report = {'provider': reviewer.status(), 'plans': reports,
              'accuracyValidated': False, 'note': 'Review-only evaluation. Scores are uncalibrated; use disjoint plan-level calibration and test sets before considering automatic rejection.'}
    output_path.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    # A report with absent providers/labels must not look like a passing accuracy check.
    return all(plan['reviewedLabeledSegments'] > 0 and plan['reviewState'] in {'complete', 'partial'} for plan in reports)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('work/vision-evaluation.json'))
    args = parser.parse_args()
    try:
        passed = evaluate(args.manifest.resolve(), args.output.resolve())
    except (ValueError, OSError, KeyError) as error:
        parser.exit(2, f'Evaluation unavailable: {error}\n')
    print(json.dumps({'output': str(args.output), 'reviewAvailable': passed}))
    raise SystemExit(0 if passed else 2)
