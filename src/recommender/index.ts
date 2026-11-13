import { improveSession } from './scheduler';
import type { RecommendedProblem } from '../types/codeforces';
import type { EnrichedProblem, UserPracticeState } from './types';
import { estimateSkill } from './skill';
import { problemKey } from './state';
import { buildCandidates } from './candidates';

export const POLICY_VERSION = 'adaptive-baseline-v1' as const;

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
  const candidates = buildCandidates(problems, state, skill, budget);

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
      add(previous);
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
              (s.tags.some(t => c.item.tags.includes(t)) ? 0.15 : 0),
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
