"""As-of features. This preprocessing is mirrored in src/ml/features.ts."""
import math

DAY = 86400
FEATURE_NAMES = [
    "current_rating", "peak_rating", "contest_count", "last_delta", "mean_delta_5",
    "std_delta_5", "days_since_rated", "rated_contests_90",
    *[name for days in (7, 30, 90) for name in (
        f"attempts_{days}", f"unique_accepted_{days}", f"active_days_{days}",
        f"mean_relative_difficulty_{days}", f"rated_accepted_{days}")],
    "acceptance_rate_90", "practice_accepted_90", "tag_diversity_90",
]


def mean(values):
    return sum(values) / len(values) if values else 0


def build_features(snapshot, as_of):
    as_of = math.floor(as_of)
    ratings = sorted((r for r in snapshot["ratings"] if r["ratingUpdateTimeSeconds"] <= as_of),
                     key=lambda r: r["ratingUpdateTimeSeconds"])
    submissions = [s for s in snapshot["submissions"] if s["creationTimeSeconds"] <= as_of]
    current = ratings[-1]["newRating"] if ratings else 0
    deltas = [r["newRating"] - r["oldRating"] for r in ratings[-5:]]
    delta_mean = mean(deltas)
    values = [current, max((r["newRating"] for r in ratings), default=0), len(ratings),
              deltas[-1] if deltas else 0, delta_mean,
              math.sqrt(mean([(d - delta_mean) ** 2 for d in deltas])),
              min(3650, (as_of - ratings[-1]["ratingUpdateTimeSeconds"]) / DAY) if ratings else 3650,
              sum(r["ratingUpdateTimeSeconds"] > as_of - 90 * DAY for r in ratings)]
    recent = []
    for days in (7, 30, 90):
        window = [s for s in submissions if s["creationTimeSeconds"] > as_of - days * DAY]
        accepted = [s for s in window if s.get("verdict") == "OK"]
        unique = {}
        for sub in accepted:
            p = sub["problem"]
            key = (p.get("contestId", sub.get("contestId", "")), p["index"], p["name"])
            unique.setdefault(key, sub)
        rated = [s for s in unique.values() if isinstance(s["problem"].get("rating"), (int, float))]
        values.extend([len(window), len(unique), len({s["creationTimeSeconds"] // DAY for s in accepted}),
                       mean([s["problem"]["rating"] - current for s in rated]), len(rated)])
        if days == 90:
            recent = window
    accepted90 = [s for s in recent if s.get("verdict") == "OK"]
    values.extend([len(accepted90) / len(recent) if recent else 0,
                   sum(s.get("author", {}).get("participantType") == "PRACTICE" for s in accepted90),
                   len({tag for s in accepted90 for tag in s["problem"].get("tags", [])})])
    assert len(values) == len(FEATURE_NAMES)
    return values


def covers_history(snapshot, as_of, days=90):
    coverage = snapshot.get("coverage", {})
    return coverage.get("complete", False) or coverage.get("oldestSubmissionTimeSeconds", float("inf")) <= as_of - days * DAY


def rating_at(ratings, timestamp):
    past = [r for r in ratings if r["ratingUpdateTimeSeconds"] <= timestamp]
    return max(past, key=lambda r: r["ratingUpdateTimeSeconds"])["newRating"] if past else None
