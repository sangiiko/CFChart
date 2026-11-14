import type { EnrichedProblem } from './types';

export const HISTORICAL_ACCEPTANCE_WEIGHTS = [2.5786420382602806, -0.5765454493855692, -0.057537147423749185];

/** Smooth difficulty preference, with eligibility handled separately. Not learning gain. */
export function scoreProblem(problem: EnrichedProblem, target: number, isSolved: boolean, isWeakTag: boolean): number {
  if (isSolved || !Number.isFinite(problem.rating)) return -Infinity;
  return Math.exp(-0.5 * ((problem.rating! - target) / 150) ** 2) + (isWeakTag ? 0.15 : 0);
}

/**
 * Zone of Proximal Development (ZPD) suitability score in [0, 1] from calibrated historical acceptance.
 * Prevents over-selecting trivial tasks (p -> 1) or frustrating walls (p -> 0).
 */
export function zpdSuitabilityScore(acceptanceProb: number, slot = 'core'): number {
  if (!Number.isFinite(acceptanceProb) || acceptanceProb < 0 || acceptanceProb > 1) {
    throw new Error('Invalid acceptance probability for ZPD scoring.');
  }
  const sweetSpot = slot === 'stretch' ? 0.72 : slot === 'warmup' ? 0.92 : 0.84;
  const bandwidth = slot === 'stretch' ? 0.18 : 0.15;
  return Math.exp(-0.5 * ((acceptanceProb - sweetSpot) / bandwidth) ** 2);
}

/** Predict historical acceptance probability from fitted public Codeforces parameters with Python parity. */
export function predictHistoricalAcceptance(
  userRating: number,
  problemRating: number,
  weights: number[] = HISTORICAL_ACCEPTANCE_WEIGHTS
): number {
  if (!Number.isFinite(userRating) || !Number.isFinite(problemRating) || weights.length !== 3) {
    throw new Error('Invalid input to historical acceptance prediction.');
  }
  const x = [1.0, (problemRating - userRating) / 400.0, (userRating - 1400.0) / 400.0];
  const z = weights.reduce((sum, w, i) => sum + w * x[i], 0);
  const clamped = Math.max(-35, Math.min(35, z));
  return 1 / (1 + Math.exp(-clamped));
}
