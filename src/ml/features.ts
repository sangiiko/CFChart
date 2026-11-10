import type { CFRatingChange, CFSubmission } from '../types/codeforces';

export interface ForecastSnapshot {
  ratings: CFRatingChange[];
  submissions: CFSubmission[];
  coverage?: {
    complete?: boolean;
    oldestSubmissionTimeSeconds?: number;
    fetchedAt?: number;
  };
}

// Keep in exactly the same order as ml/features.py. Missing statistics use zero;
// coverage is a separate prerequisite, never inferred from a zero solve count.
export const FEATURE_NAMES = [
  'current_rating', 'peak_rating', 'contest_count', 'last_delta', 'mean_delta_5',
  'std_delta_5', 'days_since_rated', 'rated_contests_90',
  ...[7, 30, 90].flatMap(days => [
    `attempts_${days}`, `unique_accepted_${days}`, `active_days_${days}`,
    `mean_relative_difficulty_${days}`, `rated_accepted_${days}`,
  ]),
  'acceptance_rate_90', 'practice_accepted_90', 'tag_diversity_90',
] as const;

const DAY = 86400;
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

export function buildFeatures(snapshot: ForecastSnapshot, referenceDate = new Date()) {
  const asOf = Math.floor(referenceDate.getTime() / 1000);
  if (!Number.isFinite(asOf)) throw new Error('Invalid forecast reference date');
  const ratings = snapshot.ratings
    .filter(r => r.ratingUpdateTimeSeconds <= asOf && Number.isFinite(r.newRating))
    .sort((a, b) => a.ratingUpdateTimeSeconds - b.ratingUpdateTimeSeconds);
  const submissions = snapshot.submissions.filter(s => s.creationTimeSeconds <= asOf);
  const current = ratings[ratings.length - 1]?.newRating ?? 0;
  const deltas = ratings.slice(-5).map(r => r.newRating - r.oldRating);
  const deltaMean = mean(deltas);
  const values = [
    current,
    ratings.length ? Math.max(...ratings.map(r => r.newRating)) : 0,
    ratings.length,
    deltas[deltas.length - 1] ?? 0,
    deltaMean,
    Math.sqrt(mean(deltas.map(d => (d - deltaMean) ** 2))),
    ratings.length ? Math.min(3650, (asOf - ratings[ratings.length - 1].ratingUpdateTimeSeconds) / DAY) : 3650,
    ratings.filter(r => r.ratingUpdateTimeSeconds > asOf - 90 * DAY).length,
  ];
  let recent: CFSubmission[] = [];
  for (const days of [7, 30, 90]) {
    const window = submissions.filter(s => s.creationTimeSeconds > asOf - days * DAY);
    const accepted = window.filter(s => s.verdict === 'OK');
    const unique = new Map<string, CFSubmission>();
    for (const s of accepted) {
      const key = `${s.problem.contestId ?? s.contestId ?? ''}-${s.problem.index}-${s.problem.name}`;
      if (!unique.has(key)) unique.set(key, s);
    }
    const rated = [...unique.values()].filter(s => Number.isFinite(s.problem.rating));
    values.push(
      window.length,
      unique.size,
      new Set(accepted.map(s => Math.floor(s.creationTimeSeconds / DAY))).size,
      mean(rated.map(s => s.problem.rating! - current)),
      rated.length,
    );
    if (days === 90) recent = window;
  }
  const accepted90 = recent.filter(s => s.verdict === 'OK');
  const practice = accepted90.filter(s => {
    const author = (s as CFSubmission & { author?: { participantType?: string } }).author;
    return author?.participantType === 'PRACTICE';
  });
  values.push(
    recent.length ? accepted90.length / recent.length : 0,
    practice.length,
    new Set(accepted90.flatMap(s => s.problem.tags ?? [])).size,
  );
  const oldest = snapshot.coverage?.oldestSubmissionTimeSeconds;
  const historyDays = snapshot.coverage?.complete
    ? Infinity
    : oldest === undefined ? 0 : Math.max(0, (asOf - oldest) / DAY);
  return { values, featureNames: FEATURE_NAMES, historyDays, contestCount: ratings.length };
}
