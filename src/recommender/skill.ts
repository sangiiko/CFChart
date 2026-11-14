import type { SkillProfile, UserPracticeState } from './types';

/** Conservative ability and topic gap estimation from public Codeforces activity and explicit timed feedback. */
export function estimateSkill(state: UserPracticeState): SkillProfile {
  // Explicit timed feedback episodes (self-report with timer/minutes)
  const recentFeedback = state.events.filter(
    e =>
      e.timestamp <= state.now &&
      state.now - e.timestamp < 90 * 86400000 &&
      (e.outcome === 'independent' || e.outcome === 'timeout') &&
      e.minutes !== undefined &&
      e.minutes >= 1 &&
      !['revisit', 'guided', 'transfer', 'timed'].includes(e.problem.slot) &&
      (e.outcome === 'timeout' ? e.minutes >= e.problem.plannedMinutes : e.minutes <= e.problem.plannedMinutes)
  );

  // A problem contributes once, even if feedback is repeated
  const episodes = [...new Map(recentFeedback.map(e => [e.problemKey, e])).values()].slice(-30);

  const feedbackAdjustment = (items: typeof episodes) => {
    if (items.length < 3) return 0;
    const sum = items.reduce(
      (total, e) =>
        total +
        (e.outcome === 'independent'
          ? Math.max(-100, Math.min(200, e.problem.rating - state.recentRating + 100))
          : Math.max(-200, Math.min(0, e.problem.rating - state.recentRating - 100))),
      0
    );
    return Math.max(-200, Math.min(200, sum / (items.length + 5)));
  };

  // Global ability starts at recent rating, adjusted only by verified independent timed feedback
  const globalTheta = Math.max(800, state.recentRating + feedbackAdjustment(episodes));

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
      const adj = feedbackAdjustment(tagged);
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
