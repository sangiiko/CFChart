import type { PracticeAssignment } from './types';
import type { RecommendedProblem } from '../types/codeforces';

export const DEFAULT_POLICY_EPSILON = 0.0;

/** Exact categorical probabilities; caller must log the final eligible action list. */
export function explorationDistribution(actions: string[], best: string, epsilon: number): Record<string, number> {
  if (
    !actions.length ||
    new Set(actions).size !== actions.length ||
    !actions.includes(best) ||
    !Number.isFinite(epsilon) ||
    epsilon < 0 ||
    epsilon > 1
  ) {
    throw new Error('Invalid exploration policy.');
  }
  return Object.fromEntries(actions.map(a => [a, epsilon / actions.length + (a === best ? 1 - epsilon : 0)]));
}

export function samplePolicy(distribution: Record<string, number>, draw: number): string {
  const entries = Object.entries(distribution);
  if (
    !Number.isFinite(draw) ||
    draw < 0 ||
    draw >= 1 ||
    !entries.length ||
    entries.some(([, p]) => !Number.isFinite(p) || p < 0) ||
    Math.abs(entries.reduce((s, [, p]) => s + p, 0) - 1) > 1e-9
  ) {
    throw new Error('Invalid distribution.');
  }
  let cumulative = 0;
  for (const [action, p] of entries) {
    cumulative += p;
    if (draw < cumulative) return action;
  }
  return entries[entries.length - 1][0];
}

/** Create an assignment record with exact propensity for offline evaluation. */
export function createAssignmentRecord(
  problem: RecommendedProblem,
  rating: number,
  historyComplete: boolean,
  selectionProbability = 1 as const,
  timestamp = Date.now()
): PracticeAssignment {
  const day = new Date(timestamp).toISOString().slice(0, 10);
  const id = `adaptive-baseline-v2:${day}:${problem.contestId}-${problem.index}:${problem.slot}:${problem.plannedMinutes}`;
  return {
    id,
    timestamp,
    policy: 'adaptive-baseline-v2',
    problem,
    rating,
    historyComplete,
    selectionProbability,
  };
}
