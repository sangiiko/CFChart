/** Half-life regression & DSR (Difficulty, Stability, Retrievability) retention mechanics.
 * Section 6 of RECOMMENDER_OPTIMIZATION_PLAN.md.
 * Retains working adaptive fallback intervals (3-day / 7-day) until fitted memory probe data exists.
 */
import type { PracticeEvent } from './types';

const DAY_MS = 86_400_000;

/** Maximum number of due independent reviews surfaced per local day to prevent review backlog floods. */
export const MAX_DAILY_REVIEWS = 1;

/**
 * Window within which an automatic Codeforces API `'accepted'` observation is treated as the
 * submission belonging to the same practice session as an `'assisted'` self-report, rather than
 * a subsequent independent review solve.
 */
export const SAME_SESSION_ACCEPTANCE_WINDOW_MS = 12 * 3_600_000;

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

export interface ReviewStatus {
  /** Whether the problem has an unresolved assisted solve awaiting independent review. */
  awaitingReview: boolean;
  /** Whether the scheduled review interval has elapsed and the review is due as of `now`. */
  isDue: boolean;
  /** Whether an earlier assisted solve was subsequently resolved independently or dismissed. */
  graduated: boolean;
  /** Whether the user explicitly dismissed the review (`already-solved`). */
  dismissed: boolean;
  /** Timestamp of the most recent assisted solve, or null if never assisted. */
  lastAssistedAt: number | null;
  /** Timestamp from which the current review interval is measured (`lastAssistedAt` or latest snooze/timeout). */
  anchorAt: number | null;
  /** Required interval in days before the review becomes due. */
  intervalDays: number;
  /** Elapsed days since `anchorAt`. */
  elapsedDays: number;
  /** Elapsed days since `lastAssistedAt`. */
  daysSinceAssisted: number;
  /** Count of assisted lapses on this problem. */
  lapses: number;
  /** Count of snoozes (`skipped`) since the last assisted solve. */
  snoozes: number;
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

function sortProblemEvents(events: readonly PracticeEvent[], problemKey: string, now: number): PracticeEvent[] {
  return events
    .filter(e => e.problemKey === problemKey && e.timestamp <= now)
    .sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      if (a.provenance !== b.provenance) return a.provenance === 'self-report' ? 1 : -1;
      return a.id.localeCompare(b.id);
    });
}

/**
 * Evaluate the complete spaced-repetition review lifecycle for a problem from its chronological
 * event history up to `now`. Handles graduation via independent self-report or subsequent-day
 * Codeforces acceptance, permanent dismissal (`already-solved`), and 7-day snoozing (`skipped`),
 * while ignoring same-session API submission echoes.
 */
export function evaluateReviewState(
  problemKey: string,
  events: readonly PracticeEvent[],
  now: number
): ReviewStatus {
  const history = sortProblemEvents(events, problemKey, now);

  let awaitingReview = false;
  let graduated = false;
  let dismissed = false;
  let lastAssistedAt: number | null = null;
  let anchorAt: number | null = null;
  let intervalDays = 0;
  let lapses = 0;
  let snoozes = 0;

  for (const event of history) {
    if (event.outcome === 'assisted') {
      awaitingReview = true;
      graduated = false;
      dismissed = false;
      lastAssistedAt = event.timestamp;
      anchorAt = event.timestamp;
      lapses++;
      snoozes = 0;
      intervalDays = safeReviewIntervalDays('assisted');
    } else if (event.outcome === 'independent') {
      if (awaitingReview || lastAssistedAt !== null) graduated = true;
      awaitingReview = false;
      anchorAt = null;
      intervalDays = 0;
      snoozes = 0;
    } else if (event.outcome === 'already-solved') {
      awaitingReview = false;
      graduated = true;
      dismissed = true;
      anchorAt = null;
      intervalDays = 0;
      snoozes = 0;
    } else if (event.outcome === 'skipped') {
      if (awaitingReview) {
        snoozes++;
        anchorAt = event.timestamp;
        intervalDays = safeReviewIntervalDays('skipped') * snoozes;
      }
    } else if (event.outcome === 'timeout' || event.outcome === 'interrupted') {
      if (
        awaitingReview &&
        lastAssistedAt !== null &&
        event.timestamp - lastAssistedAt >= SAME_SESSION_ACCEPTANCE_WINDOW_MS
      ) {
        lapses++;
        anchorAt = event.timestamp;
        intervalDays = safeReviewIntervalDays('assisted');
      }
    } else if (event.outcome === 'accepted') {
      if (
        awaitingReview &&
        lastAssistedAt !== null &&
        event.timestamp - lastAssistedAt >= SAME_SESSION_ACCEPTANCE_WINDOW_MS
      ) {
        awaitingReview = false;
        graduated = true;
        anchorAt = null;
        intervalDays = 0;
        snoozes = 0;
      }
    }
  }

  const elapsedDays = anchorAt !== null ? Math.max(0, (now - anchorAt) / DAY_MS) : 0;
  const daysSinceAssisted = lastAssistedAt !== null ? Math.max(0, (now - lastAssistedAt) / DAY_MS) : 0;
  const isDue = awaitingReview && anchorAt !== null && now - anchorAt >= intervalDays * DAY_MS;

  return {
    awaitingReview,
    isDue,
    graduated,
    dismissed,
    lastAssistedAt,
    anchorAt,
    intervalDays,
    elapsedDays,
    daysSinceAssisted,
    lapses,
    snoozes,
  };
}

/**
 * Count how many problems that were awaiting review prior to `day` have already been acted on
 * (completed, snoozed, dismissed, or timed out) during local day `day`.
 */
export function countResolvedReviewsOnDay(
  events: readonly PracticeEvent[],
  day: string,
  formatDay: (timestampMs: number) => string = ms => new Date(ms).toISOString().slice(0, 10),
  removedSolves: readonly { day: string; problemKey: string }[] = [],
  now?: number
): number {
  const byProblem = new Map<string, PracticeEvent[]>();
  for (const event of events) {
    if (now !== undefined && event.timestamp > now) continue;
    let list = byProblem.get(event.problemKey);
    if (!list) {
      list = [];
      byProblem.set(event.problemKey, list);
    }
    list.push(event);
  }

  const removedToday = new Set(removedSolves.filter(r => r.day === day).map(r => r.problemKey));
  let resolvedCount = 0;

  for (const [key, problemEvents] of byProblem.entries()) {
    const isTodayEvent = (ts: number) =>
      formatDay(ts) === day ||
      (now !== undefined && now - ts >= 0 && now - ts < SAME_SESSION_ACCEPTANCE_WINDOW_MS);

    const beforeToday: PracticeEvent[] = [];
    const onToday: PracticeEvent[] = [];
    for (const ev of problemEvents) {
      if (isTodayEvent(ev.timestamp)) {
        onToday.push(ev);
      } else if (formatDay(ev.timestamp) < day || (now !== undefined && ev.timestamp < now)) {
        beforeToday.push(ev);
      }
    }
    if (!beforeToday.length) continue;
    const latestBeforeToday = beforeToday.reduce((max, e) => Math.max(max, e.timestamp), 0);
    const priorStatus = evaluateReviewState(key, beforeToday, latestBeforeToday);
    if (!priorStatus.awaitingReview) continue;

    const actedToday =
      removedToday.has(key) ||
      onToday.some(e =>
        ['independent', 'assisted', 'accepted', 'skipped', 'already-solved', 'timeout'].includes(e.outcome)
      );
    if (actedToday) resolvedCount++;
  }

  return resolvedCount;
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
  const history = sortProblemEvents(events, problemKey, now);

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
  let lastAssistedAt: number | null = null;

  for (const event of history) {
    if (event.outcome === 'assisted' || event.outcome === 'timeout') {
      if (
        event.outcome === 'timeout' &&
        lastAssistedAt !== null &&
        event.timestamp - lastAssistedAt < SAME_SESSION_ACCEPTANCE_WINDOW_MS
      ) {
        continue;
      }
      lastEventAt = event.timestamp;
      lastOutcome = event.outcome;
      if (event.outcome === 'assisted') lastAssistedAt = event.timestamp;
      lapses++;
      difficulty = Math.min(10, difficulty + 0.6);
      // Repeated lapses shorten memory stability
      stabilityDays = Math.max(1.5, 3 * 0.85 ** Math.max(0, lapses - 1));
    } else if (event.outcome === 'skipped') {
      lastEventAt = event.timestamp;
      lastOutcome = 'skipped';
      lapses++;
      stabilityDays = Math.max(3, 7 * 0.9 ** Math.max(0, lapses - 1));
    } else if (
      event.outcome === 'independent' ||
      (event.outcome === 'accepted' &&
        lastAssistedAt !== null &&
        event.timestamp - lastAssistedAt >= SAME_SESSION_ACCEPTANCE_WINDOW_MS)
    ) {
      lastEventAt = event.timestamp;
      lastOutcome = 'independent';
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
