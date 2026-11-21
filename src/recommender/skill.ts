import type { PracticeEvent, SkillProfile, UserPracticeState } from './types';

const DAY_MS = 86_400_000;
const IRT_SCALE = 150;

/**
 * Regularized MAP Logistic IRT estimator for independent practice ability.
 * Finds theta maximizing:
 *   -(theta - priorMean)^2 / (2 * priorSigma^2) + sum_i w_i [y_i log p_i + (1 - y_i) log(1 - p_i)]
 * Strictly concave globally; 8 Newton steps converge to machine precision.
 */
function fitIrtTheta(
  items: readonly PracticeEvent[],
  priorMean: number,
  now: number,
  priorSigma = 150,
  maxShift = 300
): number {
  if (items.length < 3) return priorMean;
  const priorPrecision = 1 / (priorSigma * priorSigma);
  let theta = priorMean;

  for (let iter = 0; iter < 8; iter++) {
    let grad = -(theta - priorMean) * priorPrecision;
    let negHess = priorPrecision;

    for (const e of items) {
      const y = e.outcome === 'independent' ? 1 : 0;
      const d = Number.isFinite(e.problem.rating) ? e.problem.rating : priorMean;
      const ageDays = Math.max(0, (now - e.timestamp) / DAY_MS);
      const recency = 2 ** (-ageDays / 45);
      const timeWeight =
        e.outcome === 'independent'
          ? e.minutes === undefined
            ? 0.9
            : e.minutes <= 25
              ? 1.15
              : e.minutes <= 45
                ? 1.0
                : e.minutes <= 65
                  ? 0.8
                  : 0.65
          : 1.0;
      const w = recency * timeWeight;
      const z = Math.max(-35, Math.min(35, (d - theta) / IRT_SCALE));
      const p = 1 / (1 + Math.exp(z));
      grad += (w * (y - p)) / IRT_SCALE;
      negHess += (w * p * (1 - p)) / (IRT_SCALE * IRT_SCALE);
    }

    const step = grad / negHess;
    theta += step;
    if (Math.abs(step) < 1e-6) break;
  }

  const shift = Math.max(-maxShift, Math.min(maxShift, theta - priorMean));
  return Math.max(800, priorMean + shift);
}

/** Conservative ability and topic gap estimation from public Codeforces activity and self-reported practice outcomes. */
export function estimateSkill(state: UserPracticeState): SkillProfile {
  // Self-reported practice outcomes over the last 90 days (independent, assisted, timeout).
  // Revisit reviews and guided study are excluded so new-problem calibration reflects fresh attempts.
  const recentFeedback = state.events
    .filter(
      e =>
        e.timestamp <= state.now &&
        state.now - e.timestamp < 90 * DAY_MS &&
        e.provenance === 'self-report' &&
        (e.outcome === 'independent' || e.outcome === 'assisted' || e.outcome === 'timeout') &&
        !['revisit', 'guided'].includes(e.problem.slot)
    )
    .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));

  // Each problem contributes once using its latest self-reported outcome
  const episodes = [...new Map(recentFeedback.map(e => [e.problemKey, e])).values()].slice(-40);

  // Global ability starts at recent rating and calibrates via MAP Logistic IRT
  const globalTheta = Math.max(800, fitIrtTheta(episodes, state.recentRating, state.now, 150, 300));

  // Topic deviations delta_k from public submission activity and timed feedback
  const tagDeviations = new Map<string, number>();
  const tagUncertainty = new Map<string, number>();

  // 1. Topic evidence from public Codeforces tag activity + difficulty-adjusted IRT residuals
  let totalAccepted = 0;
  let totalAttempts = 0;
  for (const activity of state.tagActivity.values()) {
    totalAccepted += activity.accepted;
    totalAttempts += activity.total;
  }
  const overallSolveRate = totalAttempts > 0 ? totalAccepted / totalAttempts : 0.5;

  let totalIrtResidual = 0;
  let totalIrtWeight = 0;
  if (state.tagDifficulty) {
    for (const [tag, diffStats] of state.tagDifficulty.entries()) {
      const activity = state.tagActivity.get(tag);
      if (activity && activity.total === diffStats.total && diffStats.effectiveWeight > 0) {
        totalIrtResidual += diffStats.irtResidualSum;
        totalIrtWeight += diffStats.effectiveWeight;
      }
    }
  }
  const overallIrtResidual = totalIrtWeight > 0 ? totalIrtResidual / totalIrtWeight : 0;

  for (const [tag, activity] of state.tagActivity.entries()) {
    tagUncertainty.set(tag, 200 / Math.sqrt(1 + activity.total / 3));
    if (activity.total >= 3) {
      const tagRate = activity.accepted / activity.total;
      const rateDiff = tagRate - overallSolveRate;
      const diffStats = state.tagDifficulty?.get(tag);
      let effectiveSignal = rateDiff;
      if (diffStats && diffStats.total === activity.total && diffStats.effectiveWeight > 0) {
        const tagIrtMean = diffStats.irtResidualSum / diffStats.effectiveWeight;
        const irtDiff = tagIrtMean - overallIrtResidual;
        // Blend raw rate contrast with difficulty- & recency-adjusted IRT residual contrast
        effectiveSignal = 0.5 * rateDiff + 0.5 * irtDiff;
      }
      // Empirical Bayes shrinkage towards zero deviation
      const shrinkage = activity.total / (activity.total + 5);
      const delta = Math.max(-200, Math.min(200, shrinkage * 200 * effectiveSignal));
      tagDeviations.set(tag, delta);
    }
  }

  // 2. Incorporate explicit feedback for topics if present
  for (const tag of new Set(episodes.flatMap(e => e.problem.tags))) {
    const tagged = episodes.filter(e => e.problem.tags.includes(tag));
    if (tagged.length >= 3) {
      const adj = fitIrtTheta(tagged, globalTheta, state.now, 140, 200) - globalTheta;
      tagDeviations.set(tag, (tagDeviations.get(tag) ?? 0) * 0.5 + adj * 0.5);
      const prevUnc = tagUncertainty.get(tag) ?? 200;
      tagUncertainty.set(tag, prevUnc / Math.sqrt(1 + tagged.length / 2));
    }
  }

  // 3. Zero-sum contrast constraint: sum(delta_k) = 0
  const deviations = Array.from(tagDeviations.values());
  const meanDev = deviations.length > 0 ? deviations.reduce((a, b) => a + b, 0) / deviations.length : 0;

  const tagTheta = new Map<string, number>();
  for (const [tag, delta] of tagDeviations.entries()) {
    const centeredDelta = delta - meanDev;
    tagTheta.set(tag, Math.max(800, globalTheta + centeredDelta));
  }

  const weakTags = [...tagTheta.entries()]
    .filter(([, theta]) => theta < globalTheta - 30)
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);

  return { globalTheta, tagTheta, evidenceCount: episodes.length, tagUncertainty, weakTags };
}
