import type { EnrichedProblem, PracticeEvent, UserPracticeState } from './types';
import { problemKey } from './state';
import { latestEvents } from './events';

const DAY = 86400000;

export interface EligibilityContext {
  target: number;
  review?: boolean;
}

/** Check if a problem is eligible for recommendation under hard constraints. */
export function isProblemEligible(
  p: EnrichedProblem,
  state: UserPracticeState,
  ctx: EligibilityContext,
  precomputedLatest?: Map<string, PracticeEvent>
): boolean {
  if (!Number.isFinite(p.rating) || !p.contestId) return false;
  // Bounded eligibility: strictly reject distant difficulty fallbacks first (fastest filter)
  if (p.rating! < ctx.target - 200 || p.rating! > ctx.target + 300) return false;
  if (p.contestPhase && p.contestPhase !== 'FINISHED') return false;
  if (p.qualityScore <= 0) return false;

  const key = problemKey(p);
  const isSolved = state.solved.has(key);
  if (isSolved && !ctx.review) return false;

  const latest = precomputedLatest ?? latestEvents(state.events.filter(e => e.timestamp <= state.now));
  const event = latest.get(key);
  if (event && !ctx.review) {
    if (event.outcome === 'already-solved') return false;
    const cooldown = 7 * DAY;
    if (state.now - event.timestamp < cooldown) return false;
  }

  const mode = state.mode ?? 'adaptive';
  if (mode !== 'adaptive' && isSolved) return false;
  if (mode === 'transfer') {
    if (state.attempted.has(key)) return false;
    const hasAssistedTopic = state.events.some(
      e => e.outcome === 'assisted' && state.now - e.timestamp >= 3 * DAY && e.problem.tags.some(t => p.tags.includes(t))
    );
    if (!hasAssistedTopic) return false;
  }

  return true;
}

/** Determine if a problem qualifies as a scheduled review after an assisted solve. */
export function isScheduledReview(
  p: EnrichedProblem,
  state: UserPracticeState,
  precomputedLatest?: Map<string, PracticeEvent>
): boolean {
  const key = problemKey(p);
  const latest = precomputedLatest ?? latestEvents(state.events.filter(e => e.timestamp <= state.now));
  const event = latest.get(key);
  if (!event || ['independent', 'already-solved'].includes(event.outcome)) return false;
  const lastAssisted = state.events
    .filter(e => e.problemKey === key && e.outcome === 'assisted' && e.timestamp <= state.now)
    .at(-1);

  return (
    !!lastAssisted &&
    state.now - event.timestamp >= (event.outcome === 'skipped' ? 7 : 3) * DAY
  );
}

/** Determine if a problem qualifies as a recent contest upsolve. */
export function isRecentUpsolve(p: EnrichedProblem, state: UserPracticeState): boolean {
  if (!p.contestId || !state.participatedContests.has(p.contestId)) return false;
  const key = problemKey(p);
  const attempt = state.attempted.get(key);
  return Boolean(
    (attempt && state.now - attempt.lastAttempt < 30 * DAY) ||
    (p.contestStart && state.now - p.contestStart * 1000 < 30 * DAY)
  );
}
