/** Half-life regression & DSR (Difficulty, Stability, Retrievability) retention mechanics.
 * Section 6 of RECOMMENDER_OPTIMIZATION_PLAN.md.
 * Retains working adaptive fallback intervals (3-day / 7-day) until fitted memory probe data exists.
 */
import type { PracticeEvent } from './types';

const DAY_MS = 86_400_000;

export interface MemoryState {
  stabilityDays: number;
  difficulty: number;
  retrievability: number;
  elapsedDays: number;
  lapses: number;
  reps: number;
  /** Normalized review urgency in [0, 1] for due items. */
  urgency: number;
}

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

/**
 * Estimate FSRS/DSR-style memory state (Difficulty, Stability, Retrievability, and Urgency)
 * from a learner's chronological practice events on a specific problem.
 */
export function estimateMemoryState(
  problemKey: string,
  events: readonly PracticeEvent[],
  now: number,
  problemRating = 1400,
  userRating = 1400
): MemoryState {
  const history = events
    .filter(e => e.problemKey === problemKey && e.timestamp <= now)
    .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));

  const relativeGap = Number.isFinite(problemRating) && Number.isFinite(userRating)
    ? (problemRating - userRating) / 400
    : 0;
  // Intrinsic item difficulty D in [1, 10]
  let difficulty = Math.max(1, Math.min(10, 5 + 2.5 * relativeGap));
  let stabilityDays = 3;
  let lapses = 0;
  let reps = 0;
  let lastEventAt = now;
  let lastOutcome = 'assisted';

  for (const event of history) {
    lastEventAt = event.timestamp;
    lastOutcome = event.outcome;
    if (event.outcome === 'assisted' || event.outcome === 'timeout') {
      lapses++;
      difficulty = Math.min(10, difficulty + 0.6);
      // Repeated lapses shorten memory stability
      stabilityDays = Math.max(1.5, 3 * 0.85 ** Math.max(0, lapses - 1));
    } else if (event.outcome === 'skipped') {
      lapses++;
      stabilityDays = Math.max(3, 7 * 0.9 ** Math.max(0, lapses - 1));
    } else if (event.outcome === 'independent') {
      reps++;
      difficulty = Math.max(1, difficulty - 0.3);
      stabilityDays = Math.min(365, stabilityDays * (2.2 - 0.08 * (difficulty - 1)));
    }
  }

  const elapsedDays = Math.max(0, (now - lastEventAt) / DAY_MS);
  const retrievability = recallProbability(elapsedDays, stabilityDays);
  const requiredDays = safeReviewIntervalDays(lastOutcome);
  const overdueDays = Math.max(0, elapsedDays - requiredDays);
  // Combine overdue progression, forgetting risk (1 - retrievability), and lapse count into [0, 1] urgency
  const urgency = Math.max(
    0,
    Math.min(1, 0.5 * (1 - retrievability) + 0.35 * Math.tanh(overdueDays / 7) + 0.15 * Math.min(1, (lapses - 1) / 3))
  );

  return {
    stabilityDays,
    difficulty,
    retrievability,
    elapsedDays,
    lapses,
    reps,
    urgency,
  };
}
