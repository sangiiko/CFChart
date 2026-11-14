import type { CFProblem, CFRatingChange, CFSubmission } from '../types/codeforces';

const DAY_SECONDS = 86400;
const WINDOW_SECONDS = 90 * DAY_SECONDS;

export interface SolvedRecentIndexed {
  tags: string[];
  tagMaskLo: number;
  tagMaskHi: number;
}

export interface AcceptanceHistory {
  userRating: number;
  nowSeconds: number;
  attempted: Set<string>;
  recent: Array<{ earliest: number; latest: number; solved: boolean; tags: string[] }>;
  /** Precomputed summary fields for fast O(1) per-candidate feature extraction. */
  solvedRecent?: SolvedRecentIndexed[];
  recentAttemptsCount?: number;
  recentSolvedCount?: number;
  daysSinceLastAttempt?: number;
  ratingCentered?: number;
  tagBitIndex?: Map<string, number>;
  singleTagSolvedCounts?: Map<string, number>;
}

export function prepareAcceptanceHistory(
  submissions: CFSubmission[],
  ratings: CFRatingChange[],
  asOfMs: number
): AcceptanceHistory | null {
  if (!Number.isFinite(asOfMs)) return null;
  const nowSeconds = asOfMs / 1000;
  const orderedRatings = ratings
    .filter(r => Number.isFinite(r.ratingUpdateTimeSeconds))
    .sort((a, b) => a.ratingUpdateTimeSeconds - b.ratingUpdateTimeSeconds);
  const userRating =
    orderedRatings.filter(r => r.ratingUpdateTimeSeconds <= nowSeconds).at(-1)?.newRating ??
    orderedRatings[0]?.oldRating;
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
    } else {
      episodes.set(key, {
        earliest: time,
        latest: time,
        solved: sub.verdict === 'OK',
        tags: sub.problem.tags ?? [],
      });
    }
  }

  const attempted = new Set(episodes.keys());
  const recent = [...episodes.values()].filter(e => e.earliest >= nowSeconds - WINDOW_SECONDS);
  const solved = recent.filter(e => e.solved && e.latest <= nowSeconds);
  const latestAttempt = recent.reduce((latest, e) => Math.max(latest, e.earliest), -Infinity);
  const daysSinceLastAttempt = Number.isFinite(latestAttempt)
    ? Math.min(3650, (nowSeconds - latestAttempt) / DAY_SECONDS)
    : 3650;

  // Build 64-bit tag bitmask index and single-tag lookup table for O(1) candidate evaluation
  const tagBitIndex = new Map<string, number>();
  const singleTagSolvedCounts = new Map<string, number>();
  for (const ep of solved) {
    const seenInEp = new Set<string>();
    for (const tag of ep.tags) {
      if (seenInEp.has(tag)) continue;
      seenInEp.add(tag);
      singleTagSolvedCounts.set(tag, (singleTagSolvedCounts.get(tag) ?? 0) + 1);
      if (!tagBitIndex.has(tag) && tagBitIndex.size < 64) {
        tagBitIndex.set(tag, tagBitIndex.size);
      }
    }
  }

  const solvedRecent: SolvedRecentIndexed[] = solved.map(ep => {
    let tagMaskLo = 0;
    let tagMaskHi = 0;
    for (const tag of ep.tags) {
      const bit = tagBitIndex.get(tag);
      if (bit !== undefined) {
        if (bit < 32) tagMaskLo |= 1 << bit;
        else tagMaskHi |= 1 << (bit - 32);
      }
    }
    return { tags: ep.tags, tagMaskLo, tagMaskHi };
  });

  return {
    userRating: userRating!,
    nowSeconds,
    attempted,
    recent,
    solvedRecent,
    recentAttemptsCount: recent.length,
    recentSolvedCount: solved.length,
    daysSinceLastAttempt,
    ratingCentered: (userRating! - 1400) / 400,
    tagBitIndex,
    singleTagSolvedCounts,
  };
}

export function buildAcceptanceFeaturesFromHistory(
  problem: CFProblem,
  history: AcceptanceHistory | null
): number[] | null {
  if (
    !history ||
    !Number.isFinite(problem.rating) ||
    !problem.contestId ||
    history.attempted.has(`${problem.contestId}-${problem.index}`)
  ) {
    return null;
  }

  const problemTags = problem.tags ?? [];
  const tagCount = problemTags.length;

  // Fast path using precomputed index from prepareAcceptanceHistory
  if (
    history.solvedRecent !== undefined &&
    history.recentAttemptsCount !== undefined &&
    history.recentSolvedCount !== undefined &&
    history.daysSinceLastAttempt !== undefined &&
    history.ratingCentered !== undefined &&
    history.singleTagSolvedCounts !== undefined &&
    history.tagBitIndex !== undefined
  ) {
    let tagSolvedCount = 0;
    if (tagCount === 1) {
      tagSolvedCount = history.singleTagSolvedCounts.get(problemTags[0]) ?? 0;
    } else if (tagCount > 1 && history.solvedRecent.length > 0) {
      let maskLo = 0;
      let maskHi = 0;
      let hasUnindexedTag = false;
      for (let i = 0; i < tagCount; i++) {
        const bit = history.tagBitIndex.get(problemTags[i]);
        if (bit !== undefined) {
          if (bit < 32) maskLo |= 1 << bit;
          else maskHi |= 1 << (bit - 32);
        } else if (history.singleTagSolvedCounts.has(problemTags[i])) {
          hasUnindexedTag = true;
        }
      }
      if (!hasUnindexedTag) {
        if (maskLo !== 0 || maskHi !== 0) {
          const solvedArr = history.solvedRecent;
          for (let i = 0; i < solvedArr.length; i++) {
            const ep = solvedArr[i];
            if (((ep.tagMaskLo & maskLo) | (ep.tagMaskHi & maskHi)) !== 0) {
              tagSolvedCount++;
            }
          }
        }
      } else {
        const tags = new Set(problemTags);
        tagSolvedCount = history.solvedRecent.filter(e => e.tags.some(tag => tags.has(tag))).length;
      }
    }

    return [
      (problem.rating! - history.userRating) / 400,
      history.ratingCentered,
      history.recentAttemptsCount,
      history.recentSolvedCount,
      tagSolvedCount,
      history.daysSinceLastAttempt,
      tagCount,
    ];
  }

  // Fallback path if AcceptanceHistory was constructed manually without precomputed fields
  const { nowSeconds, userRating, recent } = history;
  const solved = recent.filter(e => e.solved && e.latest <= nowSeconds);
  const tags = new Set(problemTags);
  const latestAttempt = recent.reduce((latest, e) => Math.max(latest, e.earliest), -Infinity);
  return [
    (problem.rating! - userRating) / 400,
    (userRating - 1400) / 400,
    recent.length,
    solved.length,
    solved.filter(e => e.tags.some(tag => tags.has(tag))).length,
    Number.isFinite(latestAttempt) ? Math.min(3650, (nowSeconds - latestAttempt) / DAY_SECONDS) : 3650,
    tagCount,
  ];
}

/** Features for a candidate at decision time. Do not use future submissions or ratings. */
export function buildAcceptanceFeatures(
  problem: CFProblem,
  submissions: CFSubmission[],
  ratings: CFRatingChange[],
  asOfMs: number
): number[] | null {
  return buildAcceptanceFeaturesFromHistory(problem, prepareAcceptanceHistory(submissions, ratings, asOfMs));
}
