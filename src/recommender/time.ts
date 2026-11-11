/** Research primitive: competing solve/assistance/stop/continue hazards.
 * Section 4 of RECOMMENDER_OPTIMIZATION_PLAN.md.
 * Kept disabled from production deployment without calibrated timing/assistance hazard data.
 */

export interface HazardResult {
  bins: Array<{ solve: number; assistance: number; stop: number; survival: number }>;
  solve: number;
  assistance: number;
  stop: number;
  survival: number;
  expectedMinutes: number;
}

export function competingRisks(logits: number[][], binMinutes: number): HazardResult {
  if (
    !(binMinutes > 0) ||
    !Number.isFinite(binMinutes) ||
    logits.some(row => row.length !== 4 || row.some(x => !Number.isFinite(x)))
  ) {
    throw new Error('Invalid hazard parameters.');
  }
  let survival = 1,
    solve = 0,
    assistance = 0,
    stop = 0,
    expectedMinutes = 0;
  const bins = logits.map(row => {
    const max = Math.max(...row),
      exp = row.map(x => Math.exp(x - max)),
      total = exp.reduce((a, b) => a + b, 0);
    const p = exp.map(x => x / total);
    expectedMinutes += binMinutes * survival;
    solve += survival * p[0];
    assistance += survival * p[1];
    stop += survival * p[2];
    survival *= p[3];
    return { solve, assistance, stop, survival };
  });
  return { bins, solve, assistance, stop, survival, expectedMinutes };
}

/** Status gate: competing risk survival model remains unsupported and disabled in production. */
export function isCompetingRisksDeployable(): false {
  return false;
}

/** Fallback session allowances constrained by slot and daily practice budget. */
export function defaultSessionAllowance(slot: string, budget: number): number {
  switch (slot) {
    case 'revisit':
      return 20;
    case 'stretch':
      return 40;
    case 'timed':
      return 25;
    case 'guided':
    case 'transfer':
    case 'upsolve':
    case 'core':
    default:
      return Math.min(30, Math.max(20, Math.floor(budget)));
  }
}
