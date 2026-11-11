"""One-step off-policy diagnostics, never a long-horizon rating-effect estimator."""
import math
import random
from collections import defaultdict


def doubly_robust(rows, bootstrap=1000, seed=0):
    groups = defaultdict(list)
    weights = []
    for row in rows:
        target, logging, predictions = row['target'], row['logging'], row['predictions']
        if set(target) != set(logging) or set(target) != set(predictions):
            raise ValueError('Action support differs')
        if any(not math.isfinite(p) or p < 0 for p in [*target.values(), *logging.values()]):
            raise ValueError('Invalid probabilities')
        if any(abs(sum(d.values())-1)>1e-8 for d in [target, logging]):
            raise ValueError('Probabilities must sum to one')
        if any(target[a] > 0 and logging[a] <= 0 for a in target):
            raise ValueError('Target action has no logging support')
        action = row['action']
        if action not in logging or logging[action] <= 0:
            raise ValueError('Impossible logged action')
        if not math.isfinite(row['outcome']) or any(not math.isfinite(v) for v in predictions.values()):
            raise ValueError('Nonfinite outcome or prediction')
        weight = target[action]/logging[action]
        value = sum(target[a]*predictions[a] for a in target)+weight*(row['outcome']-predictions[action])
        groups[row['user']].append(value)
        weights.append(weight)
    if not groups:
        raise ValueError('No observations')
    # User-weighted estimand and cluster bootstrap, not episode-weighted pseudoreplication.
    means = [sum(values)/len(values) for values in groups.values()]
    rng = random.Random(seed)
    samples = sorted(sum(rng.choices(means,k=len(means)))/len(means) for _ in range(bootstrap)) if len(means)>1 and bootstrap>=100 else []
    return {'value': sum(means)/len(means), 'users': len(means), 'episodes': len(weights),
            'interval95': [samples[int(.025*len(samples))], samples[min(len(samples)-1,int(.975*len(samples)))]] if samples else None,
            'effectiveEpisodes': sum(weights)**2/sum(w*w for w in weights) if any(weights) else 0,
            'maxWeight': max(weights), 'causalRatingGain': False,
            'requirements': 'Cross-fitted outcome predictions; valid logged assignment probabilities; one-step reward'}
