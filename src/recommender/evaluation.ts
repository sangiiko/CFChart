import type { PracticeLedger } from './types';

export interface RecommendationFeedbackSummary {
  impressions: number;
  exposedAssignments: number;
  withLaterFeedback: number;
  outcomes: Record<string, number>;
  shadowPredictionMean: number | null;
  interpretation: string;
}

/** Descriptive join only. Deterministic assignment logs do not identify policy value. */
export function summarizeRecommendationFeedback(ledger: PracticeLedger): RecommendationFeedbackSummary {
  const impressions = ledger.impressions ?? [];
  const assignments = ledger.assignments ?? [];
  const events = [...ledger.events].sort((a, b) => a.timestamp - b.timestamp);
  const outcomes: Record<string, number> = {};
  const predictions: number[] = [];
  let exposedAssignments = 0;
  let withLaterFeedback = 0;
  for (const impression of impressions) {
    const assignment = assignments.find(item =>
      item.problem.contestId + '-' + item.problem.index === impression.problemKey &&
      item.id.includes(`:${impression.day}:${impression.problemKey}:`));
    if (assignment) {
      exposedAssignments++;
      const prediction = assignment.problem.shadowAcceptance;
      if (typeof prediction === 'number' && Number.isFinite(prediction)) predictions.push(prediction);
    }
    const outcome = events.find(event => event.problemKey === impression.problemKey && event.timestamp >= impression.displayedAt);
    if (outcome) {
      withLaterFeedback++;
      outcomes[outcome.outcome] = (outcomes[outcome.outcome] ?? 0) + 1;
    }
  }
  return {
    impressions: impressions.length,
    exposedAssignments,
    withLaterFeedback,
    outcomes,
    shadowPredictionMean: predictions.length ? predictions.reduce((sum, value) => sum + value, 0) / predictions.length : null,
    interpretation: 'Descriptive outcomes only. Historical-acceptance predictions are not independent-solve probabilities; deterministic assignments do not support causal policy evaluation.',
  };
}
