import type { CFRatingChange, CFSubmission } from '../types/codeforces';
import type { PracticeEvent, UserPracticeState } from './types';
import { prepareAcceptanceHistory } from './features';

export const problemKey = (p: { contestId?: number; index: string }) => `${p.contestId}-${p.index.toUpperCase()}`;
export function buildPracticeState(submissions: CFSubmission[], ratings: CFRatingChange[], rating: number | undefined,
  historyComplete: boolean, events: PracticeEvent[], now: number): UserPracticeState {
  const state: UserPracticeState = { solved: new Set(), attempted: new Map(), participatedContests: new Set(ratings.map(r => r.contestId)),
    tagActivity: new Map(), recentRating: Number.isFinite(rating) ? rating! : 800, historyComplete, events, now,
    acceptanceHistory: prepareAcceptanceHistory(submissions, ratings, now) };
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
    state.attempted.set(key, { lastAttempt: Math.max(previous?.lastAttempt ?? 0, s.creationTimeSeconds * 1000), count: (previous?.count ?? 0) + 1 });
    if (now - s.creationTimeSeconds * 1000 <= 90 * 86400000) {
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
    const tags = new Set<string>();
    for (const s of episode) {
      if (s.verdict === 'OK') hasOk = true;
      if (s.problem.tags) {
        for (const tag of s.problem.tags) tags.add(tag);
      }
    }
    const okInc = hasOk ? 1 : 0;
    for (const tag of tags) {
      const previous = state.tagActivity.get(tag) ?? { accepted: 0, total: 0 };
      state.tagActivity.set(tag, { accepted: previous.accepted + okInc, total: previous.total + 1 });
    }
  }
  for (const event of events) if (event.timestamp <= now && ['independent', 'assisted', 'already-solved', 'accepted'].includes(event.outcome)) state.solved.add(event.problemKey);
  return state;
}
