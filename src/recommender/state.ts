import type { CFRatingChange, CFSubmission } from '../types/codeforces';
import type { PracticeEvent, TagDifficultyStats, UserPracticeState } from './types';
import { prepareAcceptanceHistory } from './features';

const DAY_MS = 86_400_000;

export const problemKey = (p: { contestId?: number; index: string }) => `${p.contestId}-${p.index.toUpperCase()}`;

export function buildPracticeState(
  submissions: CFSubmission[],
  ratings: CFRatingChange[],
  rating: number | undefined,
  historyComplete: boolean,
  events: PracticeEvent[],
  now: number
): UserPracticeState {
  const recentRating = Number.isFinite(rating) ? rating! : 800;
  const state: UserPracticeState = {
    solved: new Set(),
    attempted: new Map(),
    participatedContests: new Set(ratings.map(r => r.contestId)),
    tagActivity: new Map(),
    tagDifficulty: new Map(),
    recentRating,
    historyComplete,
    events,
    now,
    acceptanceHistory: prepareAcceptanceHistory(submissions, ratings, now),
  };

  const episodes = new Map<string, CFSubmission[]>();
  const seenIds = new Set<number>();
  for (const s of submissions) {
    if (seenIds.has(s.id)) continue;
    seenIds.add(s.id);
    if (!s.problem.contestId || !s.verdict || s.verdict === 'TESTING' || s.creationTimeSeconds * 1000 > now) continue;
    const key = problemKey(s.problem);
    if (s.verdict === 'OK') state.solved.add(key);
    if (s.author?.participantType === 'CONTESTANT') state.participatedContests.add(s.contestId ?? s.problem.contestId);
    const previous = state.attempted.get(key);
    state.attempted.set(key, {
      lastAttempt: Math.max(previous?.lastAttempt ?? 0, s.creationTimeSeconds * 1000),
      count: (previous?.count ?? 0) + 1,
    });
    if (now - s.creationTimeSeconds * 1000 <= 90 * DAY_MS) {
      let ep = episodes.get(key);
      if (!ep) {
        ep = [];
        episodes.set(key, ep);
      }
      ep.push(s);
    }
  }

  for (const episode of episodes.values()) {
    let hasOk = false;
    let latestMs = 0;
    let problemRating = NaN;
    const tags = new Set<string>();
    for (const s of episode) {
      if (s.verdict === 'OK') hasOk = true;
      latestMs = Math.max(latestMs, s.creationTimeSeconds * 1000);
      if (Number.isFinite(s.problem.rating)) problemRating = s.problem.rating!;
      if (s.problem.tags) {
        for (const tag of s.problem.tags) tags.add(tag);
      }
    }
    const okInc = hasOk ? 1 : 0;
    const ageDays = Math.max(0, (now - latestMs) / DAY_MS);
    const recencyWeight = 2 ** (-ageDays / 45);
    const effectiveRating = Number.isFinite(problemRating) ? problemRating : recentRating;
    // Logistic IRT expected acceptance probability conditioned on problem difficulty relative to user rating
    const expectedIrt = 1 / (1 + Math.exp(Math.max(-35, Math.min(35, (effectiveRating - recentRating) / 400))));
    const residual = okInc - expectedIrt;

    for (const tag of tags) {
      const previous = state.tagActivity.get(tag) ?? { accepted: 0, total: 0 };
      state.tagActivity.set(tag, { accepted: previous.accepted + okInc, total: previous.total + 1 });

      const prevDiff: TagDifficultyStats = state.tagDifficulty!.get(tag) ?? {
        accepted: 0,
        total: 0,
        irtResidualSum: 0,
        effectiveWeight: 0,
        meanRating: effectiveRating,
      };
      const nextTotal = prevDiff.total + 1;
      state.tagDifficulty!.set(tag, {
        accepted: prevDiff.accepted + okInc,
        total: nextTotal,
        irtResidualSum: prevDiff.irtResidualSum + recencyWeight * residual,
        effectiveWeight: prevDiff.effectiveWeight + recencyWeight,
        meanRating: prevDiff.meanRating + (effectiveRating - prevDiff.meanRating) / nextTotal,
      });
    }
  }

  for (const event of events) {
    if (event.timestamp <= now && ['independent', 'assisted', 'already-solved', 'accepted'].includes(event.outcome)) {
      state.solved.add(event.problemKey);
    }
  }
  return state;
}
