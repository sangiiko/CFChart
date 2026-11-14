import type { Candidate, PracticeAssignment } from './types';
import type { RecommendedProblem } from '../types/codeforces';
import { problemKey } from './state';

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

export interface NearTieExplorationResult {
  chosen: RecommendedProblem;
  chosenKey: string;
  chosenProbability: number;
  distribution: Record<string, number>;
  supportKeys: string[];
}

/**
 * Single-slot near-tie contextual bandit selector:
 * restricts exploration to candidates within `scoreMargin` of the top candidate,
 * ensuring no degraded recommendations while logging exact propensities for doubly-robust evaluation.
 */
export function selectNearTieExplorationSlot(
  candidates: readonly Candidate[],
  epsilon = DEFAULT_POLICY_EPSILON,
  draw = 0,
  scoreMargin = 0.12
): NearTieExplorationResult {
  if (!candidates.length || !Number.isFinite(scoreMargin) || scoreMargin < 0) {
    throw new Error('Invalid near-tie exploration candidates.');
  }
  const sorted = [...candidates].sort(
    (a, b) => b.score - a.score || problemKey(a.item).localeCompare(problemKey(b.item))
  );
  const topScore = sorted[0].score;
  const nearTies = sorted.filter(c => topScore - c.score <= scoreMargin).slice(0, 10);
  const supportKeys = nearTies.map(c => problemKey(c.item));
  const bestKey = supportKeys[0];
  const distribution = explorationDistribution(supportKeys, bestKey, epsilon);
  const chosenKey = samplePolicy(distribution, draw);
  const chosenCandidate = nearTies.find(c => problemKey(c.item) === chosenKey) ?? nearTies[0];
  return {
    chosen: chosenCandidate.item,
    chosenKey,
    chosenProbability: distribution[chosenKey],
    distribution,
    supportKeys,
  };
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
