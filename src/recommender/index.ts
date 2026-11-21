import { improveSession, sessionUtility } from './scheduler';
import type { RecommendedProblem, RecSlot } from '../types/codeforces';
import type { Candidate, EnrichedProblem, UserPracticeState } from './types';
import { estimateSkill } from './skill';
import { problemKey } from './state';
import { buildCandidates } from './candidates';
import { countResolvedReviewsOnDay, MAX_DAILY_REVIEWS } from './retention';

export const POLICY_VERSION = 'adaptive-baseline-v2' as const;

const SLOT_ORDER: Record<RecSlot, number> = {
  revisit: 0,
  warmup: 1,
  core: 2,
  upsolve: 3,
  stretch: 4,
  timed: 2,
  guided: 2,
  transfer: 3,
};

export interface ScheduledReviewOptions {
  maxReviews?: number;
  pinnedKeys?: ReadonlySet<string>;
  day?: string;
  formatDay?: (timestampMs: number) => string;
  removedSolves?: readonly { day: string; problemKey: string }[];
}

export function selectRecommendationsV2(
  problems: EnrichedProblem[],
  state: UserPracticeState,
  dailyTarget: number,
  budget = 60,
  pinned: RecommendedProblem[] = []
): RecommendedProblem[] {
  if (!state.historyComplete || !Number.isFinite(dailyTarget) || !Number.isFinite(budget) || budget < 10) return [];
  const limit = Math.max(0, Math.min(20, Math.floor(dailyTarget)));
  const skill = estimateSkill(state);
  const allCandidates = buildCandidates(problems, state, skill, budget);
  const modernCandidates = allCandidates.filter(candidate => candidate.modern);
  const maxPossibleItems = Math.floor(Math.min(240, budget) / 20);
  const modernItemsNeeded = Math.min(limit, maxPossibleItems);
  const pinnedKeys = new Set(pinned.map(problemKey));
  // Use only the last three years when that pool can fill the requested session.
  // Otherwise retain older tasks as a fallback, with a score preference for modern ones.
  // Always retain due scheduled reviews regardless of problem age.
  const candidates = modernItemsNeeded > 0 && modernCandidates.length >= modernItemsNeeded
    ? allCandidates.filter(candidate => candidate.modern || candidate.item.slot === 'revisit' || pinnedKeys.has(problemKey(candidate.item)))
    : allCandidates;

  const selected: Candidate[] = [];
  const used = new Set<string>();
  let remaining = Math.min(240, budget);
  let revisitCount = 0;
  const add = (candidate: Candidate) => {
    selected.push(candidate);
    used.add(problemKey(candidate.item));
    remaining -= candidate.item.plannedMinutes;
    if (candidate.item.slot === 'revisit') revisitCount++;
  };

  for (const previous of pinned) {
    const candidate = candidates.find(c => problemKey(c.item) === problemKey(previous));
    if (
      candidate &&
      !used.has(problemKey(previous)) &&
      selected.length < limit &&
      previous.plannedMinutes <= remaining &&
      (previous.slot !== 'revisit' || revisitCount < MAX_DAILY_REVIEWS)
    ) {
      add({
        ...candidate,
        item: {
          ...candidate.item,
          ...previous,
          tags: previous.tags?.length ? previous.tags : candidate.item.tags,
          qualityScore: candidate.item.qualityScore,
          ...(previous.shadowAcceptance === undefined && candidate.item.shadowAcceptance !== undefined
            ? { shadowAcceptance: candidate.item.shadowAcceptance }
            : {}),
        },
      });
    }
  }

  while (selected.length < limit) {
    const baseUtility = sessionUtility(selected);
    const feasible = candidates.filter(
      c =>
        !used.has(problemKey(c.item)) &&
        c.item.plannedMinutes <= remaining &&
        (c.item.slot !== 'revisit' || revisitCount < MAX_DAILY_REVIEWS)
    );
    if (!feasible.length) break;

    const slotsAfter = limit - selected.length - 1;
    let pool = feasible;
    if (slotsAfter > 0) {
      const minStep = feasible.reduce((min, c) => Math.min(min, c.item.plannedMinutes), Infinity);
      const capacityPreserving = feasible.filter(c => remaining - c.item.plannedMinutes >= slotsAfter * minStep);
      if (capacityPreserving.length) pool = capacityPreserving;
    }

    const ranked = pool.map(c => ({
      ...c,
      marginal: sessionUtility([...selected, c]) - baseUtility,
    }));

    ranked.sort(
      (a, b) =>
        b.marginal - a.marginal ||
        problemKey(a.item).localeCompare(problemKey(b.item))
    );

    if (!ranked[0]) break;
    add(ranked[0]);
  }

  const improved = improveSession(
    selected.map(c => c.item),
    candidates,
    Math.min(240, budget),
    pinnedKeys
  );
  // Present momentum/review tasks before stretch tasks while preserving deterministic ties.
  return [...improved].sort((a, b) => (SLOT_ORDER[a.slot] ?? 3) - (SLOT_ORDER[b.slot] ?? 3));
}

/**
 * Return due scheduled reviews independently of daily goal and time budget,
 * strictly paced to at most `maxReviews` (default 1) per local day.
 * Once a due review has been completed, snoozed, or dismissed today, no further
 * reviews are pushed until the next day.
 */
export function selectScheduledReviews(
  problems: EnrichedProblem[],
  state: UserPracticeState,
  optionsOrMax: number | ScheduledReviewOptions = MAX_DAILY_REVIEWS
): RecommendedProblem[] {
  if (!state.historyComplete) return [];
  const opts: ScheduledReviewOptions =
    typeof optionsOrMax === 'number' ? { maxReviews: optionsOrMax } : optionsOrMax;
  const maxReviews = opts.maxReviews === undefined
    ? MAX_DAILY_REVIEWS
    : Math.max(0, Math.floor(opts.maxReviews));
  if (maxReviews <= 0) return [];

  const formatDay = opts.formatDay ?? ((ms: number) => new Date(ms).toISOString().slice(0, 10));
  const day = opts.day ?? formatDay(state.now);
  const resolvedToday = countResolvedReviewsOnDay(state.events, day, formatDay, opts.removedSolves, state.now);
  const remainingQuota = Math.max(0, maxReviews - resolvedToday);
  if (remainingQuota <= 0) return [];

  const reviewState: UserPracticeState = state.mode && state.mode !== 'adaptive' ? { ...state, mode: 'adaptive' } : state;
  const candidateKeys = new Set(
    reviewState.events
      .filter(e => e.outcome === 'assisted' && e.timestamp <= reviewState.now)
      .map(e => e.problemKey)
  );
  if (!candidateKeys.size) return [];
  const candidateProblems = problems.filter(p => candidateKeys.has(problemKey(p)));
  if (!candidateProblems.length) return [];

  const skill = estimateSkill(reviewState);
  const pinnedKeys = opts.pinnedKeys;

  return buildCandidates(candidateProblems, reviewState, skill, 60)
    .filter(c => c.item.slot === 'revisit')
    .sort((a, b) => {
      const aPinned = pinnedKeys?.has(problemKey(a.item)) ? 1 : 0;
      const bPinned = pinnedKeys?.has(problemKey(b.item)) ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return b.score - a.score || problemKey(a.item).localeCompare(problemKey(b.item));
    })
    .slice(0, remainingQuota)
    .map(c => c.item);
}

export * from './types';
export * from './eligibility';
export * from './explain';
export * from './candidates';
export * from './scheduler';
export * from './skill';
export * from './learning';
export * from './retention';
export * from './time';
export * from './policy';
export * from './evaluation';
export * from './bayesian';
export * from './events';
export * from './state';
export * from './semantic';
