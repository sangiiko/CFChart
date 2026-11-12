"""Compare bundled and candidate forecast weights on the same unseen users."""
import argparse
import json
import statistics
import time
from bisect import bisect_right
from pathlib import Path

from .export import predict
from .features import DAY, build_features, rating_at
from .train import held_out_user


def forecast(model, features):
    by_horizon = {}
    for part in model['models']:
        by_horizon.setdefault(part['horizonDays'], []).append(predict(part['trees'], features))
    return {h: sorted(values) for h, values in by_horizon.items()}


def compare(data, current_path, candidate_path, output, as_of):
    current = json.loads(current_path.read_text())
    candidate = json.loads(candidate_path.read_text())
    if current['featureNames'] != candidate['featureNames']:
        raise ValueError('Model feature schemas differ')
    paths = sorted((data / 'users').glob('*.json'))
    score = {model['version']: {30: [], 90: []} for model in (current, candidate)}
    users = 0
    exclusions = {}
    for index, path in enumerate(paths, 1):
        if not held_out_user(path.stem): continue
        try:
            snapshot = json.loads(path.read_text())
            ratings = sorted(snapshot.get('ratings', []), key=lambda r: r['ratingUpdateTimeSeconds'])
            observed = min(snapshot.get('ratingsFetchedAt', 0), snapshot.get('submissionsFetchedAt', 0))
            if observed < as_of + 90 * DAY or not snapshot.get('coverage', {}).get('complete'):
                exclusions['not_mature_or_complete'] = exclusions.get('not_mature_or_complete', 0) + 1
                continue
            if sum(r['ratingUpdateTimeSeconds'] <= as_of for r in ratings) < 3:
                exclusions['too_few_prior_contests'] = exclusions.get('too_few_prior_contests', 0) + 1
                continue
            submissions = [s for s in snapshot.get('submissions', []) if as_of - 90 * DAY < s['creationTimeSeconds'] <= as_of]
            features = build_features({'ratings': ratings, 'submissions': submissions}, as_of)
            rating = features[0]
            if any(not (m['ratingRange'][0] <= rating <= m['ratingRange'][1]) for m in (current, candidate)):
                exclusions['outside_shared_rating_range'] = exclusions.get('outside_shared_rating_range', 0) + 1
                continue
            actual = {h: rating_at(ratings, as_of + h * DAY) for h in (30, 90)}
            predictions = {m['version']: forecast(m, features) for m in (current, candidate)}
            for version, by_h in predictions.items():
                for h in (30, 90):
                    low, median, high = by_h[h]
                    score[version][h].append({'error': abs(actual[h]-median), 'covered': int(low <= actual[h] <= high), 'width': high-low})
            users += 1
        except (ValueError, KeyError, TypeError, OSError) as error:
            exclusions['invalid_record'] = exclusions.get('invalid_record', 0) + 1
        if index % 250 == 0 or index == len(paths):
            print(f'Compared {index:,}/{len(paths):,} files; {users:,} shared eligible unseen users', flush=True)
    if not users: raise ValueError('No eligible unseen users on the selected date')
    metrics = {}
    for version, by_h in score.items():
        metrics[version] = {str(h): {'users': len(items),
            'mae': statistics.mean(item['error'] for item in items),
            'coverage': statistics.mean(item['covered'] for item in items),
            'meanIntervalWidth': statistics.mean(item['width'] for item in items)} for h, items in by_h.items()}
    report = {'asOf': as_of, 'sharedUsers': users, 'userHoldout': 'stable hash modulo 5 equals 0',
              'modelVersions': [current['version'], candidate['version']], 'exclusions': exclusions, 'metrics': metrics,
              'limitations': ['One fixed recent snapshot per unseen user; not a full temporal holdout.',
                              'Both models may have trained on older periods of other users.',
                              'Problem metadata is retrospective.']}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', type=Path, default=Path('ml/data/top10000'))
    parser.add_argument('--current', type=Path, default=Path('src/ml/model.json'))
    parser.add_argument('--candidate', type=Path, default=Path('ml/artifacts/top10000-candidate/model.json'))
    parser.add_argument('--output', type=Path, default=Path('ml/artifacts/top10000-candidate/comparison.json'))
    parser.add_argument('--as-of', type=int, default=1780272000, help='UTC epoch seconds; default 2026-06-01')
    args = parser.parse_args()
    print(json.dumps(compare(args.data, args.current, args.candidate, args.output, args.as_of), indent=2))


if __name__ == '__main__': main()
