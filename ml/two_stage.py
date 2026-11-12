"""Research-only participation-aware rating forecast experiment.

Fits contest-participation probabilities and conditional median rating deltas.
Never exports a deployable browser model; use this to evaluate the hypothesis.
"""
import argparse
import json
from pathlib import Path

import numpy as np

from .features import FEATURE_NAMES
from .train import HORIZONS, array, make_examples, split_examples


def evaluate(rows, models):
    x = array(rows)
    result = {"rows": len(rows), "users": len({r['handle'] for r in rows}), "horizons": {}}
    for index, horizon in enumerate(HORIZONS):
        participation, conditional = models[horizon]
        p = participation.predict(x)
        delta = conditional.predict(x)
        current = x[:, 0]
        # The point forecast for a no-contest majority is unchanged official rating.
        prediction = current + np.where(p >= 0.5, delta, 0)
        actual = np.asarray([r['y'][index] for r in rows], dtype=np.float64)
        occurred = np.asarray([r['participated'][index] for r in rows], dtype=np.float64)
        result['horizons'][str(horizon)] = {
            'mae': float(np.mean(np.abs(prediction-actual))),
            'unchangedMae': float(np.mean(np.abs(current-actual))),
            'participationRate': float(np.mean(occurred)),
            'participationBrier': float(np.mean((p-occurred)**2)),
            'predictedParticipationRate': float(np.mean(p)),
            'medianContestDelta': float(np.median([r['y'][index]-r['x'][0] for r in rows if r['participated'][index]])),
        }
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--data', type=Path, default=Path('ml/data/top10000'))
    p.add_argument('--output', type=Path, default=Path('ml/artifacts/top10000-two-stage'))
    p.add_argument('--train-end', type=int, default=1751241600)
    p.add_argument('--test-start', type=int, default=1759276800)
    p.add_argument('--rounds', type=int, default=150)
    args = p.parse_args()
    import lightgbm as lgb
    paths = sorted((args.data / 'users').glob('*.json'))
    rows = make_examples(paths)
    training, temporal, unseen, split = split_examples(rows, args.train_end, args.test_start)
    x = array(training)
    models = {}
    for index, horizon in enumerate(HORIZONS):
        occurred = np.asarray([r['participated'][index] for r in training], dtype=np.int8)
        print(f'{horizon}d: fitting participation on {len(training):,} rows ({occurred.mean()*100:.1f}% participated)', flush=True)
        participation = lgb.train({'objective': 'binary', 'learning_rate': .05, 'num_leaves': 15,
                                   'min_data_in_leaf': 50, 'verbosity': -1, 'num_threads': 1,
                                   'seed': 42, 'deterministic': True, 'force_col_wise': True},
                                  lgb.Dataset(x, label=occurred, feature_name=list(FEATURE_NAMES)),
                                  num_boost_round=args.rounds)
        conditional_rows = [r for r in training if r['participated'][index]]
        if len(conditional_rows) < 100: raise ValueError('Too few observed contest windows')
        print(f'{horizon}d: fitting median conditional rating change on {len(conditional_rows):,} rows', flush=True)
        conditional = lgb.train({'objective': 'quantile', 'alpha': .5, 'learning_rate': .05,
                                 'num_leaves': 15, 'min_data_in_leaf': 50, 'verbosity': -1,
                                 'num_threads': 1, 'seed': 42, 'deterministic': True, 'force_col_wise': True},
                                lgb.Dataset(array(conditional_rows),
                                            label=np.asarray([r['y'][index]-r['x'][0] for r in conditional_rows]),
                                            feature_name=list(FEATURE_NAMES)), num_boost_round=args.rounds)
        models[horizon] = (participation, conditional)
    report = {'deployable': False, 'model': 'two-stage-participation-research', 'split': split,
              'trainingRows': len(training), 'temporal': evaluate(temporal, models),
              'unseenUsers': evaluate(unseen, models),
              'limitations': ['Research-only point forecasts; no calibrated intervals or TypeScript parity.',
                              'A 0.5 participation threshold is fixed, not tuned on holdouts.',
                              'Retrospective problem metadata remains a limitation.']}
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output/'report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == '__main__': main()
