"""Episode-level Python/TypeScript parity audit and recommendation policy benchmark."""
import json
import math
from pathlib import Path
from ml.export import predict as predict_export


DAY_SECONDS = 86400
WINDOW_SECONDS = 90 * DAY_SECONDS


def _sigmoid(z):
    z = max(-35.0, min(35.0, float(z)))
    return 1.0 / (1.0 + math.exp(-z))


def prepare_acceptance_history_py(submissions, ratings, as_of_ms):
    """Reference Python implementation matching src/recommender/features.ts::prepareAcceptanceHistory."""
    if not isinstance(as_of_ms, (int, float)) or not math.isfinite(as_of_ms):
        return None
    now_seconds = as_of_ms / 1000.0
    ordered_ratings = sorted(
        (r for r in ratings if isinstance(r.get('ratingUpdateTimeSeconds'), (int, float)) and math.isfinite(r['ratingUpdateTimeSeconds'])),
        key=lambda r: r['ratingUpdateTimeSeconds'],
    )
    past = [r for r in ordered_ratings if r['ratingUpdateTimeSeconds'] <= now_seconds]
    user_rating = past[-1]['newRating'] if past else (ordered_ratings[0]['oldRating'] if ordered_ratings else None)
    if not isinstance(user_rating, (int, float)) or not math.isfinite(user_rating) or user_rating <= 0:
        return None

    episodes = {}
    seen_ids = set()
    for sub in submissions:
        sid = sub.get('id')
        if sid in seen_ids:
            continue
        seen_ids.add(sid)
        time = sub.get('creationTimeSeconds')
        prob = sub.get('problem', {})
        cid, idx = prob.get('contestId'), prob.get('index')
        if not cid or not idx or not isinstance(time, (int, float)) or not math.isfinite(time) or time > now_seconds:
            continue
        key = f'{cid}-{idx}'
        if key in episodes:
            ep = episodes[key]
            ep['earliest'] = min(ep['earliest'], time)
            ep['latest'] = max(ep['latest'], time)
            ep['solved'] = ep['solved'] or (sub.get('verdict') == 'OK')
        else:
            episodes[key] = {
                'earliest': time,
                'latest': time,
                'solved': sub.get('verdict') == 'OK',
                'tags': prob.get('tags') or [],
            }

    attempted = set(episodes.keys())
    recent = [e for e in episodes.values() if e['earliest'] >= now_seconds - WINDOW_SECONDS]
    return {
        'userRating': user_rating,
        'nowSeconds': now_seconds,
        'attempted': attempted,
        'recent': recent,
    }


def build_acceptance_features_py(problem, submissions, ratings, as_of_ms):
    """Reference Python implementation matching src/recommender/features.ts::buildAcceptanceFeatures."""
    history = prepare_acceptance_history_py(submissions, ratings, as_of_ms)
    if not history:
        return None
    p_rating = problem.get('rating')
    cid, idx = problem.get('contestId'), problem.get('index')
    if not isinstance(p_rating, (int, float)) or not math.isfinite(p_rating) or not cid or f'{cid}-{idx}' in history['attempted']:
        return None
    now_seconds = history['nowSeconds']
    user_rating = history['userRating']
    recent = history['recent']
    solved = [e for e in recent if e['solved'] and e['latest'] <= now_seconds]
    tags = set(problem.get('tags') or [])
    latest_attempt = max((e['earliest'] for e in recent), default=-math.inf)
    days_since = min(3650.0, (now_seconds - latest_attempt) / DAY_SECONDS) if math.isfinite(latest_attempt) else 3650.0
    return [
        (p_rating - user_rating) / 400.0,
        (user_rating - 1400.0) / 400.0,
        len(recent),
        len(solved),
        sum(1 for e in solved if any(t in tags for t in e['tags'])),
        days_since,
        len(problem.get('tags') or []),
    ]


def predict_acceptance_model_py(model, features):
    """Reference Python evaluator matching src/recommender/inference.ts::predictHistoricalAcceptanceModel."""
    raw = _sigmoid(predict_export(model['trees'], features))
    clipped = max(1e-6, min(1.0 - 1e-6, raw))
    intercept = model['calibration']['intercept']
    slope = model['calibration']['slope']
    return _sigmoid(intercept + slope * math.log(clipped / (1.0 - clipped)))


def generate_parity_fixtures(model_path=Path('src/recommender/acceptance-model.json')):
    """Generate comprehensive edge-case fixtures with exact features and calibrated predictions."""
    model = json.loads(Path(model_path).read_text())
    day = DAY_SECONDS
    as_of_ms = 200 * day * 1000
    ratings = [
        {'contestId': 1, 'contestName': 'R1', 'handle': 'u', 'rank': 100, 'ratingUpdateTimeSeconds': 50 * day, 'oldRating': 1200, 'newRating': 1400},
        {'contestId': 2, 'contestName': 'R2', 'handle': 'u', 'rank': 50, 'ratingUpdateTimeSeconds': 180 * day, 'oldRating': 1400, 'newRating': 1600},
        # Future rating update after as_of_ms (must be ignored)
        {'contestId': 3, 'contestName': 'R3', 'handle': 'u', 'rank': 10, 'ratingUpdateTimeSeconds': 210 * day, 'oldRating': 1600, 'newRating': 1900},
    ]
    submissions = [
        # Outside 90d window (earliest = 109d < 110d)
        {'id': 1, 'creationTimeSeconds': 109 * day, 'verdict': 'OK', 'problem': {'contestId': 10, 'index': 'A', 'name': 'Old', 'rating': 1400, 'tags': ['dp']}},
        # Exact 90d boundary (earliest = 110d == 200d - 90d)
        {'id': 2, 'creationTimeSeconds': 110 * day, 'verdict': 'OK', 'problem': {'contestId': 11, 'index': 'A', 'name': 'Boundary', 'rating': 1500, 'tags': ['dp', 'graphs']}},
        # Duplicate submission ID (must be deduplicated)
        {'id': 2, 'creationTimeSeconds': 110 * day, 'verdict': 'OK', 'problem': {'contestId': 11, 'index': 'A', 'name': 'Boundary', 'rating': 1500, 'tags': ['dp', 'graphs']}},
        # Multi-submission episode: WA at 150d, OK at 151d
        {'id': 3, 'creationTimeSeconds': 150 * day, 'verdict': 'WRONG_ANSWER', 'problem': {'contestId': 12, 'index': 'B', 'name': 'Multi', 'rating': 1600, 'tags': ['trees', 'dfs and similar']}},
        {'id': 4, 'creationTimeSeconds': 151 * day, 'verdict': 'OK', 'problem': {'contestId': 12, 'index': 'B', 'name': 'Multi', 'rating': 1600, 'tags': ['trees', 'dfs and similar']}},
        # Unsolved episode: WA at 195d, future OK at 205d (after as_of_ms, so unsolved as of 200d!)
        {'id': 5, 'creationTimeSeconds': 195 * day, 'verdict': 'WRONG_ANSWER', 'problem': {'contestId': 13, 'index': 'C', 'name': 'Censored', 'rating': 1700, 'tags': ['dp', 'trees']}},
        {'id': 6, 'creationTimeSeconds': 205 * day, 'verdict': 'OK', 'problem': {'contestId': 13, 'index': 'C', 'name': 'Censored', 'rating': 1700, 'tags': ['dp', 'trees']}},
    ]
    candidates = [
        {'contestId': 99, 'index': 'A', 'name': 'Cand1', 'rating': 1600, 'tags': ['dp', 'graphs', 'trees']},
        {'contestId': 99, 'index': 'B', 'name': 'Cand2', 'rating': 1800, 'tags': ['math']},
        {'contestId': 99, 'index': 'C', 'name': 'Cand3', 'rating': 1500, 'tags': []},
    ]
    results = []
    for cand in candidates:
        feats = build_acceptance_features_py(cand, submissions, ratings, as_of_ms)
        prob = predict_acceptance_model_py(model, feats)
        results.append({'candidate': cand, 'features': feats, 'probability': prob})
    return {
        'asOfMs': as_of_ms,
        'ratings': ratings,
        'submissions': submissions,
        'cases': results,
    }


if __name__ == '__main__':
    print(json.dumps(generate_parity_fixtures(), indent=2))
