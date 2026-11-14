import type { PracticeLedger } from './types';

export interface SlotOutcomeSummary {
  impressions: number;
  withLaterFeedback: number;
  outcomes: Record<string, number>;
}

export interface RecommendationFeedbackSummary {
  impressions: number;
  exposedAssignments: number;
  withLaterFeedback: number;
  outcomes: Record<string, number>;
  shadowPredictionMean: number | null;
  shadowBrier?: number | null;
  shadowLogLoss?: number | null;
  independentSolveRate?: number | null;
  bySlot?: Record<string, SlotOutcomeSummary>;
  interpretation: string;
}

const SOLVED_OUTCOMES = new Set(['independent', 'assisted', 'accepted', 'already-solved']);
const FAILED_OUTCOMES = new Set(['timeout']);

/** Descriptive join only. Deterministic assignment logs do not identify policy value. */
export function summarizeRecommendationFeedback(ledger: PracticeLedger): RecommendationFeedbackSummary {
  const impressions = ledger.impressions ?? [];
  const assignments = ledger.assignments ?? [];
  const events = [...ledger.events].sort((a, b) => a.timestamp - b.timestamp);
  const outcomes: Record<string, number> = {};
  const predictions: number[] = [];
  const brierTerms: number[] = [];
  const logLossTerms: number[] = [];
  const bySlot: Record<string, SlotOutcomeSummary> = {};
  let exposedAssignments = 0;
  let withLaterFeedback = 0;
  let independentCount = 0;

  for (const impression of impressions) {
    const assignment = assignments.find(item =>
      item.problem.contestId + '-' + item.problem.index === impression.problemKey &&
      item.id.includes(`:${impression.day}:${impression.problemKey}:`));
    const slot = assignment?.problem.slot ?? 'unknown';
    if (!bySlot[slot]) {
      bySlot[slot] = { impressions: 0, withLaterFeedback: 0, outcomes: {} };
    }
    bySlot[slot].impressions++;

    let prediction: number | undefined;
    if (assignment) {
      exposedAssignments++;
      prediction = assignment.problem.shadowAcceptance;
      if (typeof prediction === 'number' && Number.isFinite(prediction)) {
        predictions.push(prediction);
      }
    }

    const outcome = events.find(
      event => event.problemKey === impression.problemKey && event.timestamp >= impression.displayedAt
    );
    if (outcome) {
      withLaterFeedback++;
      outcomes[outcome.outcome] = (outcomes[outcome.outcome] ?? 0) + 1;
      bySlot[slot].withLaterFeedback++;
      bySlot[slot].outcomes[outcome.outcome] = (bySlot[slot].outcomes[outcome.outcome] ?? 0) + 1;
      if (outcome.outcome === 'independent') {
        independentCount++;
      }

      if (
        typeof prediction === 'number' &&
        Number.isFinite(prediction) &&
        (SOLVED_OUTCOMES.has(outcome.outcome) || FAILED_OUTCOMES.has(outcome.outcome))
      ) {
        const y = SOLVED_OUTCOMES.has(outcome.outcome) ? 1 : 0;
        const clipped = Math.max(1e-6, Math.min(1 - 1e-6, prediction));
        brierTerms.push((clipped - y) ** 2);
        logLossTerms.push(-(y * Math.log(clipped) + (1 - y) * Math.log(1 - clipped)));
      }
    }
  }

  return {
    impressions: impressions.length,
    exposedAssignments,
    withLaterFeedback,
    outcomes,
    shadowPredictionMean: predictions.length
      ? predictions.reduce((sum, value) => sum + value, 0) / predictions.length
      : null,
    shadowBrier: brierTerms.length
      ? brierTerms.reduce((sum, value) => sum + value, 0) / brierTerms.length
      : null,
    shadowLogLoss: logLossTerms.length
      ? logLossTerms.reduce((sum, value) => sum + value, 0) / logLossTerms.length
      : null,
    independentSolveRate: withLaterFeedback > 0 ? independentCount / withLaterFeedback : null,
    bySlot,
    interpretation:
      'Descriptive outcomes only. Historical-acceptance predictions are not independent-solve probabilities; deterministic assignments do not support causal policy evaluation.',
  };
}
