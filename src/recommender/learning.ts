/** Anchored transfer assessment protocol and transition representation.
 * Gated on prospective randomized transfer experiments; uses adaptive baseline fallback.
 */

export interface AnchorTask {
  id: string;
  rating: number;
  tags: string[];
}

/** Frozen reference distribution D of unseen contest-like anchor tasks (v1). */
export const FROZEN_ANCHOR_TASKS_V1: readonly AnchorTask[] = Object.freeze([
  { id: '1800-A', rating: 800, tags: ['implementation'] },
  { id: '1800-B', rating: 1100, tags: ['greedy'] },
  { id: '1800-C', rating: 1300, tags: ['data structures'] },
  { id: '1800-D', rating: 1500, tags: ['dp', 'strings'] },
  { id: '1800-E', rating: 1700, tags: ['graphs'] },
  { id: '1800-F', rating: 2000, tags: ['math', 'constructive algorithms'] },
]);

const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, z))));

/** Anchored transfer value V_D(theta): expected solve probability over frozen anchor distribution D. */
export function evaluateAnchorTransferValue(theta: number, anchors: readonly AnchorTask[] = FROZEN_ANCHOR_TASKS_V1): number {
  if (!Number.isFinite(theta)) throw new Error('Invalid latent ability theta.');
  if (!anchors.length) return 0;
  const sum = anchors.reduce((acc, task) => acc + sigmoid((theta - task.rating) / 400), 0);
  return sum / anchors.length;
}

/** Proposed causal transfer gain: Delta_D(a, H).
 * Returns estimated change in transfer value. Flagged as unvalidated heuristic unless trial data is provided.
 */
export function estimateTransferGain(
  currentTheta: number,
  activityType: 'core' | 'upsolve' | 'revisit' | 'timed' | 'guided' | 'transfer',
  difficulty: number
): { deltaTransfer: number; validated: false; note: string } {
  // A harder problem has potential for larger shift if mastered, but transition dynamics are unproven
  const relativeDiff = (difficulty - currentTheta) / 400;
  const multiplier = activityType === 'upsolve' ? 1.2 : activityType === 'revisit' ? 1.1 : 1.0;
  const hypotheticalNextTheta = currentTheta + Math.max(0, Math.min(25, (10 + 5 * relativeDiff) * multiplier));

  const currentV = evaluateAnchorTransferValue(currentTheta);
  const nextV = evaluateAnchorTransferValue(hypotheticalNextTheta);

  return {
    deltaTransfer: nextV - currentV,
    validated: false,
    note: 'Heuristic learning potential; not prospective proof of rating gain.',
  };
}
