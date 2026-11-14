import { improveSession, tagOverlapPenalty } from './scheduler';
import type { RecommendedProblem } from '../types/codeforces';
import type { EnrichedProblem, UserPracticeState } from './types';
import { estimateSkill } from './skill';
import { problemKey } from './state';
import { buildCandidates } from './candidates';

export const POLICY_VERSION = 'adaptive-baseline-v2' as const;

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

  const selected: RecommendedProblem[] = [];
  const used = new Set<string>();
  let remaining = Math.min(240, budget);
  const add = (item: RecommendedProblem) => {
    selected.push(item);
    used.add(problemKey(item));
    remaining -= item.plannedMinutes;
  };

  for (const previous of pinned) {
    const candidate = candidates.find(c => problemKey(c.item) === problemKey(previous));
    if (candidate && !used.has(problemKey(previous)) && selected.length < limit && previous.plannedMinutes <= remaining) {
      add({
        ...candidate.item,
        ...previous,
        tags: previous.tags?.length ? previous.tags : candidate.item.tags,
        qualityScore: candidate.item.qualityScore,
        ...(previous.shadowAcceptance === undefined && candidate.item.shadowAcceptance !== undefined
          ? { shadowAcceptance: candidate.item.shadowAcceptance }
          : {}),
      });
    }
  }

  while (selected.length < limit) {
    const ranked = candidates
      .filter(c => !used.has(problemKey(c.item)) && c.item.plannedMinutes <= remaining)
      .map(c => ({
        ...c,
        marginal:
          c.score -
          selected.reduce(
            (penalty, s) =>
              penalty +
              (s.contestId === c.item.contestId ? 0.2 : 0) +
              tagOverlapPenalty(s.tags, c.item.tags),
            0
          ),
      }));

    ranked.sort(
      (a, b) =>
        b.marginal / b.item.plannedMinutes - a.marginal / a.item.plannedMinutes ||
        problemKey(a.item).localeCompare(problemKey(b.item))
    );

    if (!ranked[0]) break;
    add(ranked[0].item);
  }

  return improveSession(selected, candidates, Math.min(240, budget), new Set(pinned.map(problemKey)));
}

/** Return due scheduled reviews independently of daily goal and time budget. */
export function selectScheduledReviews(
  problems: EnrichedProblem[],
  state: UserPracticeState
): RecommendedProblem[] {
  if (!state.historyComplete) return [];
  const reviewState: UserPracticeState = state.mode && state.mode !== 'adaptive' ? { ...state, mode: 'adaptive' } : state;
  const skill = estimateSkill(reviewState);
  return buildCandidates(problems, reviewState, skill, 60)
    .filter(c => c.item.slot === 'revisit')
    .sort((a, b) => b.score - a.score || problemKey(a.item).localeCompare(problemKey(b.item)))
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
