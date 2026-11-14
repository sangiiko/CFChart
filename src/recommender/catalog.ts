import type { CFProblem, CFContest } from '../types/codeforces';
import type { EnrichedProblem } from './types';
import { problemKey } from './state';

/**
 * Compute an Empirical-Bayes difficulty- and contest-calibrated quality score.
 * Returns 1 when solvedCount is absent/0 (preserving exact synthetic test scores),
 * and a bounded score in [0.7, 1.25] for real catalog tasks with solvedCount > 0.
 */
export function computeProblemQuality(problem: CFProblem, contest?: CFContest): number {
  const solvedCount = problem.solvedCount ?? 0;
  if (!Number.isFinite(solvedCount) || solvedCount <= 0 || !Number.isFinite(problem.rating)) {
    return 1;
  }
  const rating = Math.max(800, problem.rating!);
  // Empirical Codeforces solve-count baseline decays exponentially with difficulty rating
  const expectedSolves = 22000 * Math.exp(-(rating - 800) / 450);
  const logRatio = Math.log((solvedCount + 50) / (expectedSolves + 50));
  const popularityAdjustment = 0.15 * Math.tanh(logRatio / 1.5);
  const contestBonus = contest?.type === 'CF' ? 0.02 : 0;
  return Math.max(0.7, Math.min(1.25, 1 + popularityAdjustment + contestBonus));
}

export function enrichCatalog(problems: CFProblem[], contests: CFContest[]): EnrichedProblem[] {
  const contestMap = new Map(contests.map(c => [c.id, c]));
  return [...new Map(problems.filter(p => Number.isInteger(p.contestId) && p.contestId! > 0
    && /^[A-Za-z0-9_]+$/.test(p.index) && Number.isFinite(p.rating) && Array.isArray(p.tags))
    .map(p => [problemKey(p), p])).values()].flatMap(problem => {
    const contest = contestMap.get(problem.contestId!);
    if (problem.tags.includes('*special') || /april fools/i.test(contest?.name ?? '')
      || (contest && contest.phase !== 'FINISHED')) return [];
    const qualityScore = computeProblemQuality(problem, contest);
    return [{ ...problem, solvedCount: problem.solvedCount ?? 0, contestType: contest?.type,
      contestPhase: contest?.phase, contestStart: contest?.startTimeSeconds, qualityScore }];
  });
}
