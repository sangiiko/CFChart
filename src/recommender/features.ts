import type { CFProblem, CFRatingChange, CFSubmission } from '../types/codeforces';

const DAY_SECONDS = 86400;
const WINDOW_SECONDS = 90 * DAY_SECONDS;

export interface AcceptanceHistory {
  userRating: number;
  nowSeconds: number;
  attempted: Set<string>;
  recent: Array<{ earliest: number; latest: number; solved: boolean; tags: string[] }>;
}

export function prepareAcceptanceHistory(submissions: CFSubmission[], ratings: CFRatingChange[], asOfMs: number): AcceptanceHistory | null {
  if (!Number.isFinite(asOfMs)) return null;
  const nowSeconds = asOfMs / 1000;
  const orderedRatings = ratings.filter(r => Number.isFinite(r.ratingUpdateTimeSeconds)).sort((a, b) => a.ratingUpdateTimeSeconds - b.ratingUpdateTimeSeconds);
  const userRating = orderedRatings.filter(r => r.ratingUpdateTimeSeconds <= nowSeconds).at(-1)?.newRating ?? orderedRatings[0]?.oldRating;
  if (!Number.isFinite(userRating) || userRating! <= 0) return null;
  const episodes = new Map<string, { earliest: number; latest: number; solved: boolean; tags: string[] }>();
  const seenIds = new Set<number>();
  for (const sub of submissions) {
    if (seenIds.has(sub.id)) continue;
    seenIds.add(sub.id);
    const time = sub.creationTimeSeconds;
    if (!sub.problem.contestId || !sub.problem.index || !Number.isFinite(time) || time > nowSeconds) continue;
    const key = `${sub.problem.contestId}-${sub.problem.index}`;
    const episode = episodes.get(key);
    if (episode) {
      episode.earliest = Math.min(episode.earliest, time);
      episode.latest = Math.max(episode.latest, time);
      episode.solved ||= sub.verdict === 'OK';
    } else episodes.set(key, { earliest: time, latest: time, solved: sub.verdict === 'OK', tags: sub.problem.tags ?? [] });
  }
  const attempted = new Set(episodes.keys());
  const recent = [...episodes.values()].filter(e => e.earliest >= nowSeconds - WINDOW_SECONDS);
  return { userRating: userRating!, nowSeconds, attempted, recent };
}

export function buildAcceptanceFeaturesFromHistory(problem: CFProblem, history: AcceptanceHistory | null): number[] | null {
  if (!history || !Number.isFinite(problem.rating) || !problem.contestId || history.attempted.has(`${problem.contestId}-${problem.index}`)) return null;
  const { nowSeconds, userRating, recent } = history;
  const solved = recent.filter(e => e.solved && e.latest <= nowSeconds);
  const tags = new Set(problem.tags ?? []);
  const latestAttempt = recent.reduce((latest, e) => Math.max(latest, e.earliest), -Infinity);
  return [(problem.rating! - userRating) / 400, (userRating - 1400) / 400, recent.length, solved.length,
    solved.filter(e => e.tags.some(tag => tags.has(tag))).length,
    Number.isFinite(latestAttempt) ? Math.min(3650, (nowSeconds - latestAttempt) / DAY_SECONDS) : 3650,
    (problem.tags ?? []).length];
}

/** Features for a candidate at decision time. Do not use future submissions or ratings. */
export function buildAcceptanceFeatures(
  problem: CFProblem,
  submissions: CFSubmission[],
  ratings: CFRatingChange[],
  asOfMs: number,
): number[] | null {
  return buildAcceptanceFeaturesFromHistory(problem, prepareAcceptanceHistory(submissions, ratings, asOfMs));
}
