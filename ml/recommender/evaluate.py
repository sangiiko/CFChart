"""One-step off-policy diagnostics, never a long-horizon rating-effect estimator."""
import math
import random
from collections import defaultdict


def _validate_row(row):
    target, logging, predictions = row['target'], row['logging'], row['predictions']
    if set(target) != set(logging) or set(target) != set(predictions):
        raise ValueError('Action support differs')
    if any(not math.isfinite(p) or p < 0 for p in [*target.values(), *logging.values()]):
        raise ValueError('Invalid probabilities')
    if any(abs(sum(d.values()) - 1) > 1e-8 for d in [target, logging]):
        raise ValueError('Probabilities must sum to one')
    if any(target[a] > 0 and logging[a] <= 0 for a in target):
        raise ValueError('Target action has no logging support')
    action = row['action']
    if action not in logging or logging[action] <= 0:
        raise ValueError('Impossible logged action')
    if not math.isfinite(row['outcome']) or any(not math.isfinite(v) for v in predictions.values()):
        raise ValueError('Nonfinite outcome or prediction')
    return target, logging, predictions, action


def doubly_robust(rows, bootstrap=1000, seed=0):
    groups = defaultdict(list)
    weights = []
    for row in rows:
        target, logging, predictions, action = _validate_row(row)
        weight = target[action] / logging[action]
        value = sum(target[a] * predictions[a] for a in target) + weight * (row['outcome'] - predictions[action])
        groups[row['user']].append(value)
        weights.append(weight)
    if not groups:
        raise ValueError('No observations')
    # User-weighted estimand and cluster bootstrap, not episode-weighted pseudoreplication.
    means = [sum(values) / len(values) for values in groups.values()]
    rng = random.Random(seed)
    samples = (
        sorted(sum(rng.choices(means, k=len(means))) / len(means) for _ in range(bootstrap))
        if len(means) > 1 and bootstrap >= 100
        else []
    )
    return {
        'value': sum(means) / len(means),
        'users': len(means),
        'episodes': len(weights),
        'interval95': [
            samples[int(0.025 * len(samples))],
            samples[min(len(samples) - 1, int(0.975 * len(samples)))],
        ]
        if samples
        else None,
        'effectiveEpisodes': sum(weights) ** 2 / sum(w * w for w in weights) if any(weights) else 0,
        'maxWeight': max(weights),
        'causalRatingGain': False,
        'requirements': 'Cross-fitted outcome predictions; valid logged assignment probabilities; one-step reward',
    }


def snips_estimate(rows, bootstrap=1000, seed=0):
    """Self-Normalized Inverse Propensity Scoring (SNIPS) with user-cluster bootstrap."""
    user_num = defaultdict(float)
    user_den = defaultdict(float)
    user_counts = defaultdict(int)
    weights = []
    for row in rows:
        target, logging, _, action = _validate_row(row)
        weight = target[action] / logging[action]
        user = row['user']
        user_num[user] += weight * row['outcome']
        user_den[user] += weight
        user_counts[user] += 1
        weights.append(weight)
    if not user_counts:
        raise ValueError('No observations')
    users = list(user_counts.keys())
    # User-normalized weight contributions so heavy-volume users do not dominate
    norm_nums = [user_num[u] / user_counts[u] for u in users]
    norm_dens = [user_den[u] / user_counts[u] for u in users]
    total_den = sum(norm_dens)
    point = sum(norm_nums) / total_den if total_den > 0 else 0.0
    rng = random.Random(seed)
    samples = []
    if len(users) > 1 and bootstrap >= 100:
        indices = list(range(len(users)))
        for _ in range(bootstrap):
            drawn = rng.choices(indices, k=len(users))
            d_sum = sum(norm_dens[i] for i in drawn)
            if d_sum > 0:
                samples.append(sum(norm_nums[i] for i in drawn) / d_sum)
        samples.sort()
    return {
        'value': point,
        'users': len(users),
        'episodes': len(weights),
        'interval95': [
            samples[int(0.025 * len(samples))],
            samples[min(len(samples) - 1, int(0.975 * len(samples)))],
        ]
        if samples
        else None,
        'effectiveEpisodes': sum(weights) ** 2 / sum(w * w for w in weights) if any(weights) else 0,
        'maxWeight': max(weights),
        'causalRatingGain': False,
    }


def direct_method_estimate(rows, bootstrap=1000, seed=0):
    """Direct Method (DM) reward model estimator with user-cluster bootstrap."""
    groups = defaultdict(list)
    for row in rows:
        target, _, predictions, _ = _validate_row(row)
        groups[row['user']].append(sum(target[a] * predictions[a] for a in target))
    if not groups:
        raise ValueError('No observations')
    means = [sum(values) / len(values) for values in groups.values()]
    rng = random.Random(seed)
    samples = (
        sorted(sum(rng.choices(means, k=len(means))) / len(means) for _ in range(bootstrap))
        if len(means) > 1 and bootstrap >= 100
        else []
    )
    return {
        'value': sum(means) / len(means),
        'users': len(means),
        'episodes': sum(len(v) for v in groups.values()),
        'interval95': [
            samples[int(0.025 * len(samples))],
            samples[min(len(samples) - 1, int(0.975 * len(samples)))],
        ]
        if samples
        else None,
        'causalRatingGain': False,
    }


def policy_overlap_diagnostics(rows):
    """Action-support overlap, KL divergence, and importance-weight diagnostics."""
    if not rows:
        raise ValueError('No observations')
    weights = []
    kl_values = []
    tv_values = []
    for row in rows:
        target, logging, _, action = _validate_row(row)
        weights.append(target[action] / logging[action])
        kl = sum(target[a] * math.log(target[a] / logging[a]) for a in target if target[a] > 0)
        tv = 0.5 * sum(abs(target[a] - logging[a]) for a in target)
        kl_values.append(kl)
        tv_values.append(tv)
    ess = sum(weights) ** 2 / sum(w * w for w in weights) if any(weights) else 0.0
    ess_ratio = ess / len(weights)
    max_w = max(weights)
    return {
        'episodes': len(weights),
        'effectiveEpisodes': ess,
        'effectiveSampleRatio': ess_ratio,
        'maxWeight': max_w,
        'meanKlDivergence': sum(kl_values) / len(kl_values),
        'meanTotalVariation': sum(tv_values) / len(tv_values),
        'overlapAdequate': bool(ess_ratio >= 0.25 and max_w <= 20.0),
    }
