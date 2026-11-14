import type { RecommendedProblem } from '../types/codeforces';
import type { Candidate } from './types';
import { problemKey } from './state';

/** Multi-tag overlap penalty: 0.15 for 1 shared tag, +0.05 per additional shared tag. */
export function tagOverlapPenalty(tagsA: readonly string[], tagsB: readonly string[]): number {
  let shared = 0;
  for (let i = 0; i < tagsA.length; i++) {
    if (tagsB.includes(tagsA[i])) shared++;
  }
  return shared > 0 ? 0.15 + 0.05 * (shared - 1) : 0;
}

/** Heuristic utility function F(S) balancing candidate scores and diversity coverage; not a prediction of learning gain. */
export function sessionUtility(items: Candidate[]): number {
  let value = items.reduce((s, c) => s + c.score, 0);
  for (let i = 0; i < items.length; i++) {
    for (let j = 0; j < i; j++) {
      if (items[i].item.contestId === items[j].item.contestId) value -= 0.2;
      value -= tagOverlapPenalty(items[i].item.tags, items[j].item.tags);
    }
  }
  return value;
}

/** Bounded 1-for-1 local improvement search, preserving pinned items and the time cap. */
export function improveSession(
  selected: RecommendedProblem[],
  candidates: Candidate[],
  budget: number,
  pinned: Set<string>
): RecommendedProblem[] {
  const scoreMap = new Map(candidates.map(c => [problemKey(c.item), c.score]));
  let plan: Candidate[] = selected.map(item => ({
    item,
    score: scoreMap.get(problemKey(item)) ?? 0,
  }));
  const pool = [...candidates]
    .sort((a, b) => b.score - a.score || problemKey(a.item).localeCompare(problemKey(b.item)))
    .slice(0, 200);

  for (let pass = 0; pass < 3; pass++) {
    let best = plan;
    let value = sessionUtility(plan);
    for (let i = 0; i < plan.length; i++) {
      if (pinned.has(problemKey(plan[i].item))) continue;
      for (const candidate of pool) {
        if (plan.some(c => problemKey(c.item) === problemKey(candidate.item))) continue;
        const next = plan.map((c, j) => (j === i ? candidate : c));
        if (next.reduce((s, c) => s + c.item.plannedMinutes, 0) > budget) continue;
        const utility = sessionUtility(next);
        if (utility > value + 1e-9) {
          best = next;
          value = utility;
        }
      }
    }
    if (best === plan) break;
    plan = best;
  }
  return plan.map(c => c.item);
}
