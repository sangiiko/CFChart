/** Half-life regression retention mechanics.
 * Section 6 of RECOMMENDER_OPTIMIZATION_PLAN.md.
 * Retains working adaptive fallback intervals (3-day / 7-day) until fitted memory probe data exists.
 */

export function recallProbability(elapsedDays: number, halfLifeDays: number): number {
  if (!Number.isFinite(elapsedDays) || elapsedDays < 0 || !Number.isFinite(halfLifeDays) || halfLifeDays <= 0) {
    throw new Error('Invalid retention inputs.');
  }
  return 2 ** (-elapsedDays / halfLifeDays);
}

export function reviewDelay(halfLifeDays: number, targetRecall: number): number {
  recallProbability(0, halfLifeDays);
  if (!(targetRecall > 0 && targetRecall < 1)) throw new Error('Invalid recall threshold.');
  return -halfLifeDays * Math.log2(targetRecall);
}

export function isRetentionModelDeployable(): false {
  return false;
}

/** Adaptive fallback review schedule: 3 days for assisted solves, 7 days for skipped problems. */
export function safeReviewIntervalDays(outcome: string): number {
  return outcome === 'skipped' ? 7 : 3;
}
