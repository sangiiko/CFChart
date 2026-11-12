"""Fit an interpretable solve/acceptance model from public Codeforces data or exports.

Trains and evaluates models only whose targets available data actually supports.
Unsupported models (independent unassisted solve within fixed budget, competing
assistance hazards, causal 90-day rating trial) remain explicitly disabled with
working adaptive fallback.
"""
import argparse
from collections import Counter, deque
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path

FEATURES = ['intercept', 'relative_difficulty_400', 'rating_centered_1400_400']


def finite(value):
    return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value)


def load_rows_from_exports(directory, budget=30):
    """Load rows from user-exported practice ledgers (optional feedback)."""
    rows, excluded, seen = [], Counter(), {}
    for path in sorted(Path(directory).glob('*.json')):
        data = json.loads(path.read_text())
        if data.get('version') != 1 or not isinstance(data.get('handle'), str):
            raise ValueError(f'{path.name}: unsupported export schema')
        user = hashlib.sha256(data['handle'].strip().lower().encode()).hexdigest()
        ledger = data.get('ledger', {})
        if ledger.get('version') != 1:
            raise ValueError(f'{path.name}: unsupported ledger schema')
        assignments = ledger.get('assignments', [])
        for event in ledger.get('events', []):
            identity = (user, event.get('id'))
            serialized = json.dumps(event, sort_keys=True)
            if identity in seen:
                if seen[identity] != serialized:
                    raise ValueError('Conflicting duplicate event ID')
                excluded['duplicate_event'] += 1
                continue
            seen[identity] = serialized
            problem = event.get('problem', {})
            timestamp = event.get('timestamp')
            if not finite(timestamp) or not isinstance(event.get('problemKey'), str):
                excluded['invalid_event'] += 1
                continue
            matching = [a for a in assignments if finite(a.get('timestamp')) and a['timestamp'] <= timestamp
                        and f"{a.get('problem', {}).get('contestId')}-{a.get('problem', {}).get('index')}" == event['problemKey']]
            assignment = max(matching, key=lambda a: a['timestamp']) if matching else None
            if not assignment or not assignment.get('historyComplete'):
                excluded['missing_assignment_or_coverage'] += 1
                continue
            if problem != assignment.get('problem'):
                excluded['assignment_mismatch'] += 1
                continue
            if event.get('provenance') != 'self-report' or event.get('version') != 1:
                excluded['unknown_provenance'] += 1
                continue
            if problem.get('slot') != 'core' or problem.get('plannedMinutes') != budget:
                excluded['different_mode_or_budget'] += 1
                continue
            minutes, outcome = event.get('minutes'), event.get('outcome')
            if not finite(minutes) or minutes < 1 or minutes > 1440:
                excluded['unknown_or_invalid_minutes'] += 1
                continue
            # Assistance time is not recorded: an assisted outcome cannot be safely
            # labeled as a full-budget failure. Interruption/skip is also not failure.
            if not ((outcome == 'independent' and minutes <= budget) or
                    (outcome == 'timeout' and minutes >= budget)):
                excluded['ambiguous_reference_budget_outcome'] += 1
                continue
            rating, difficulty = assignment.get('rating'), problem.get('rating')
            if not finite(rating) or not finite(difficulty):
                excluded['invalid_rating'] += 1
                continue
            rows.append({'user': user, 'at': assignment['timestamp'], 'observed': timestamp,
                         'key': event['problemKey'], 'y': int(outcome == 'independent'),
                         'x': [1., (difficulty - rating) / 400., (rating - 1400.) / 400.],
                         'rating': rating, 'difficulty': difficulty})
    # Earliest episode only: repeated exposure otherwise contaminates independent ability.
    unique = {}
    for row in sorted(rows, key=lambda r: (r['at'], r['observed'], r['key'])):
        key = (row['user'], row['key'])
        if key in unique:
            excluded['repeated_problem'] += 1
        else:
            unique[key] = row
    return list(unique.values()), dict(excluded)


def load_rows_from_cohort(directory, max_users=None, episodes_per_user=None):
    """Load problem attempt episodes from public Codeforces submissions and rating history.
    
    Target: Historical problem acceptance (y=1 if solved, y=0 if attempted without solve).
    Strictly:
    - Never infers independent solving or assistance (assistance is unknown).
    - Never infers thinking time from submission timestamps.
    - Never labels unattempted problems as failures.
    - Groups repeated submissions on the same problem into a single problem-level episode.
    """
    rows, excluded = [], Counter()
    paths = sorted(Path(directory).glob('*.json'))
    if max_users:
        paths = paths[:max_users]
    for index, path in enumerate(paths, 1):
        try:
            data = json.loads(path.read_text())
        except Exception:
            excluded['corrupt_json'] += 1
            continue
        handle = data.get('handle')
        if not isinstance(handle, str) or not handle.strip():
            excluded['invalid_handle'] += 1
            continue
        user = hashlib.sha256(handle.strip().lower().encode()).hexdigest()
        ratings = sorted((r for r in data.get('ratings', []) if finite(r.get('ratingUpdateTimeSeconds'))),
                         key=lambda r: r['ratingUpdateTimeSeconds'])
        if not ratings:
            excluded['no_ratings'] += 1
            continue
        subs = data.get('submissions', [])
        episodes_by_prob = {}
        for s in subs:
            prob = s.get('problem', {})
            cid, idx = prob.get('contestId'), prob.get('index')
            rating = prob.get('rating')
            t = s.get('creationTimeSeconds')
            if not cid or not idx or not finite(rating) or not finite(t):
                continue
            key = f"{cid}-{idx}"
            if key not in episodes_by_prob:
                episodes_by_prob[key] = {
                    'rating': rating,
                    'earliest': t,
                    'latest': t,
                    'ok': False,
                    'tags': prob.get('tags', []),
                }
            ep = episodes_by_prob[key]
            ep['earliest'] = min(ep['earliest'], t)
            ep['latest'] = max(ep['latest'], t)
            if s.get('verdict') == 'OK':
                ep['ok'] = True

        episodes = sorted(episodes_by_prob.items(), key=lambda item: item[1]['earliest'])
        recent = deque()
        for _, ep in episodes:
            earliest = ep['earliest']
            while recent and recent[0]['earliest'] <= earliest - 90 * 86400:
                recent.popleft()
            ep['recent_attempts90'] = len(recent)
            known_solved = [prev for prev in recent if prev['ok'] and prev['latest'] <= earliest]
            ep['recent_solved90'] = len(known_solved)
            tags = set(ep['tags'] or [])
            ep['recent_tag_solved90'] = sum(bool(tags.intersection(prev['tags'] or [])) for prev in known_solved)
            ep['days_since_attempt'] = min(3650, (earliest - recent[-1]['earliest']) / 86400) if recent else 3650
            recent.append(ep)
        if episodes_per_user and len(episodes) > episodes_per_user:
            # Evenly spaced episodes preserve each user's career, not only the newest period.
            original_count = len(episodes)
            episodes = [episodes[i * (original_count - 1) // (episodes_per_user - 1)]
                        for i in range(episodes_per_user)]
            excluded['sampled_episodes'] += original_count - len(episodes)
        for key, ep in episodes:
            t_ms = ep['earliest'] * 1000
            past_ratings = [r['newRating'] for r in ratings if r['ratingUpdateTimeSeconds'] * 1000 <= t_ms]
            u_rating = past_ratings[-1] if past_ratings else ratings[0]['oldRating']
            if not finite(u_rating) or u_rating <= 0:
                excluded['invalid_user_rating'] += 1
                continue
            p_rating = ep['rating']
            rows.append({
                'user': user,
                'at': t_ms,
                'observed': ep['latest'] * 1000,
                'key': key,
                'y': int(ep['ok']),
                'x': [1.0, (p_rating - u_rating) / 400.0, (u_rating - 1400.0) / 400.0],
                'rating': u_rating,
                'difficulty': p_rating,
                'x_boost': [(p_rating - u_rating) / 400.0, (u_rating - 1400.0) / 400.0,
                            ep['recent_attempts90'], ep['recent_solved90'],
                            ep['recent_tag_solved90'], ep['days_since_attempt'], len(ep['tags'] or [])],
            })
        if index % 250 == 0 or index == len(paths):
            print(f'Loaded {index:,}/{len(paths):,} users; {len(rows):,} attempt episodes', flush=True)
    return rows, dict(excluded)


def sigmoid(z):
    z = max(-35., min(35., z))
    return 1 / (1 + math.exp(-z))


def predict(weights, row):
    return sigmoid(sum(w * x for w, x in zip(weights, row['x'])))


def fit(rows, iterations=800, lr=0.05, l2=0.01):
    """MAP-style regularized logistic regression with monotone difficulty constraint."""
    prior = [2.0, -math.log(10), 0.2]
    if len(rows) >= 10000:
        import numpy as np
        from scipy.optimize import minimize
        from scipy.special import expit
        x = np.asarray([r['x'] for r in rows], dtype=np.float64)
        y = np.asarray([r['y'] for r in rows], dtype=np.float64)
        prior_array = np.asarray(prior)
        def objective(weights):
            z = x @ weights
            delta = weights - prior_array
            loss = np.logaddexp(0, z).mean() - np.dot(y, z) / len(y) + l2 * np.dot(delta, delta) / 2
            gradient = x.T @ (expit(z) - y) / len(y) + l2 * delta
            return float(loss), gradient
        result = minimize(objective, prior_array, jac=True, method='L-BFGS-B',
                          bounds=[(None, None), (None, 0), (None, None)],
                          options={'maxiter': 100, 'ftol': 1e-10})
        if not result.success and result.nit >= 100:
            raise RuntimeError(f'Logistic optimizer did not converge: {result.message}')
        return result.x.tolist()
    weights = prior[:]
    n = max(1, len(rows))
    for _ in range(iterations):
        gradient = [0.] * len(weights)
        for row in rows:
            error = predict(weights, row) - row['y']
            for j, x in enumerate(row['x']):
                gradient[j] += error * x / n
        for j in range(len(weights)):
            weights[j] -= lr * (gradient[j] + l2 * (weights[j] - prior[j]))
        # Monotone constraint: greater relative difficulty cannot improve solve probability.
        weights[1] = min(0., weights[1])
    return weights


def metrics(rows, weights):
    if not rows:
        return None
    pairs = [(predict(weights, r), r['y']) for r in rows]
    bins = []
    for i in range(10):
        group = [(p, y) for p, y in pairs if i / 10. <= p < (i + 1) / 10.]
        if group:
            bins.append({
                'bin': i,
                'n': len(group),
                'predicted': sum(p for p, _ in group) / len(group),
                'observed': sum(y for _, y in group) / len(group),
            })
    eps = 1e-15
    log_loss = -sum(y * math.log(max(eps, min(1 - eps, p))) + (1 - y) * math.log(max(eps, min(1 - eps, 1 - p)))
                    for p, y in pairs) / len(pairs)
    brier = sum((p - y) ** 2 for p, y in pairs) / len(pairs)
    calibration_error = sum(item['n'] * abs(item['predicted'] - item['observed']) for item in bins) / len(pairs)
    return {
        'rows': len(rows),
        'users': len({r['user'] for r in rows}),
        'logLoss': log_loss,
        'brier': brier,
        'calibrationError': calibration_error,
        'reliability': bins,
    }


def passes_deployment_gate(evaluation, min_rows=100, min_users=10):
    """Require future and unseen-user gains, usable calibration, and subgroup safety."""
    for name in ('future', 'unseenUsers'):
        split = evaluation.get(name, {})
        baseline, candidate = split.get('baseline'), split.get('candidate')
        if not baseline or not candidate or candidate['rows'] < min_rows or candidate['users'] < min_users:
            return False
        if candidate['logLoss'] >= baseline['logLoss'] * 0.99:
            return False
        if candidate['brier'] >= baseline['brier'] * 0.99:
            return False
        if candidate['calibrationError'] > 0.10:
            return False
    for band, candidate in evaluation.get('stratified', {}).items():
        baseline = evaluation.get('stratifiedBaseline', {}).get(band)
        if baseline and candidate['rows'] >= 100 and candidate['brier'] > baseline['brier'] * 1.10:
            return False
    return True


def stratified_metrics(rows, weights):
    if not rows or not weights:
        return {}
    bands = [
        ('<1200', lambda r: r['rating'] < 1200),
        ('1200-1500', lambda r: 1200 <= r['rating'] < 1500),
        ('1500-1800', lambda r: 1500 <= r['rating'] < 1800),
        ('1800+', lambda r: r['rating'] >= 1800),
    ]
    result = {}
    for name, predicate in bands:
        subset = [r for r in rows if predicate(r)]
        if subset:
            result[name] = metrics(subset, weights)
    return result


def train(source_dir, output_dir, cutoff, source_type='cohort', budget=30, max_users=None,
          episodes_per_user=None):
    if source_type == 'cohort':
        rows, excluded = load_rows_from_cohort(source_dir, max_users=max_users,
                                               episodes_per_user=episodes_per_user)
        target_name = 'historical_acceptance'
    else:
        rows, excluded = load_rows_from_exports(source_dir, budget=budget)
        target_name = 'reference_budget_solve'

    unseen = lambda r: int(r['user'][:8], 16) % 5 == 0
    training = [r for r in rows if r['observed'] < cutoff and not unseen(r)]
    future = [r for r in rows if r['at'] >= cutoff and not unseen(r)]
    holdout = [r for r in rows if r['at'] >= cutoff and unseen(r)]

    ready = len(training) >= 100 and len({r['user'] for r in training}) >= 10 and len({r['y'] for r in training}) == 2
    weights = fit(training) if ready else None
    baseline = [2.0 if source_type == 'cohort' else 0., -math.log(10), 0.]

    evaluation = {
        'future': {
            'baseline': metrics(future, baseline),
            'candidate': metrics(future, weights) if weights else None,
        },
        'unseenUsers': {
            'baseline': metrics(holdout, baseline),
            'candidate': metrics(holdout, weights) if weights else None,
        },
        'stratified': stratified_metrics(holdout, weights) if weights else {},
        'stratifiedBaseline': stratified_metrics(holdout, baseline),
    }
    validated = bool(ready and passes_deployment_gate(evaluation))
    report = {
        'schemaVersion': 1,
        'target': target_name,
        'cutoffMs': cutoff,
        'eligibleEpisodes': len(rows),
        'excluded': excluded,
        'trainingRows': len(training),
        'trainingUsers': len({r['user'] for r in training}),
        'status': 'validated_model' if validated else 'candidate_failed_gate' if ready else 'insufficient_data',
        'validated': validated,
        'deploymentAllowed': False,
        'deploymentReason': 'Offline acceptance evaluation only; no TypeScript runtime parity or recommendation-policy evaluation',
        'gateSpecification': {'minRowsPerHoldout': 100, 'minUsersPerHoldout': 10,
                              'minimumLogLossImprovement': 0.01, 'minimumBrierImprovement': 0.01,
                              'maximumCalibrationError': 0.10, 'subgroupMaxBrierRatio': 1.10,
                              'subgroupMinimumRows': 100},
        'limitations': [
            'Observational Codeforces public data with unknown assistance',
            'Thinking time before submission is unobserved and not inferred',
            'Submissions represent self-selected problem attempts',
            'Does not measure causal rating gain or learning transfer',
            'Unsupported models (causal rating trials, survival hazards) remain disabled with adaptive fallback',
        ],
        'evaluation': evaluation,
    }

    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')

    candidate_artifact = {
        'schemaVersion': 1,
        'target': target_name,
        'validated': validated,
        'deploymentAllowed': False,
        'features': FEATURES,
        'weights': weights,
        'cutoffMs': cutoff,
        'limitations': report['limitations'],
    }
    (output / 'candidate.json').write_text(json.dumps(candidate_artifact, indent=2) + '\n')
    (output / 'model.json').write_text(json.dumps(candidate_artifact, indent=2) + '\n')

    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--cohort', type=Path, help='Path to public Codeforces cohort directory')
    group.add_argument('--exports', type=Path, help='Path to exported user feedback directory')
    parser.add_argument('--output', type=Path, required=True, help='Output directory for model and report')
    parser.add_argument('--cutoff', required=True, help='Preregistered UTC split date, YYYY-MM-DD')
    parser.add_argument('--budget', type=int, default=30)
    parser.add_argument('--max-users', type=int, default=None)
    parser.add_argument('--episodes-per-user', type=int, default=None,
                        help='Evenly sample this many first-attempt episodes per user to bound memory')
    args = parser.parse_args()
    if args.episodes_per_user is not None and args.episodes_per_user < 2:
        parser.error('--episodes-per-user must be at least 2')

    source_dir = args.cohort or args.exports
    source_type = 'cohort' if args.cohort else 'exports'
    if not source_dir.is_dir():
        parser.error(f'Directory does not exist: {source_dir}')

    cutoff = datetime.fromisoformat(args.cutoff + 'T00:00:00+00:00').replace(tzinfo=timezone.utc).timestamp() * 1000
    report = train(source_dir, args.output, cutoff, source_type=source_type, budget=args.budget,
                   max_users=args.max_users, episodes_per_user=args.episodes_per_user)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
