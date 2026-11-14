import type { RecommendedProblem, RecSlot } from '../types/codeforces';
import type { Candidate, EnrichedProblem, SkillProfile, UserPracticeState } from './types';
import { isModernContestProblem, isProblemEligible, isRecentUpsolve, isScheduledReview } from './eligibility';
import { explainRecommendation } from './explain';
import { scoreProblem } from './score';
import { getProblemUrl } from '../services/codeforcesApi';
import { latestEvents } from './events';
import modelJson from './acceptance-model.json';
import { buildAcceptanceFeaturesFromHistory } from './features';
import { predictHistoricalAcceptanceModel, type AcceptanceModel } from './inference';
import { selectMostInformativeWeakTag, transferSimilarityScore } from './semantic';
import { estimateMemoryState } from './retention';
import { problemKey } from './state';

const shadowModel = Object.freeze(modelJson) as AcceptanceModel;

const SLOT_LABELS: Record<RecSlot, string> = {
  timed: 'Timed practice',
  guided: 'Guided study',
  transfer: 'Transfer probe',
  revisit: 'Independent review',
  upsolve: 'Upsolve',
  core: 'Core practice',
  stretch: 'Stretch',
  warmup: 'Warmup',
};

export function buildCandidates(
  problems: EnrichedProblem[],
  state: UserPracticeState,
  skill: SkillProfile,
  budget: number
): Candidate[] {
  const target = skill.globalTheta;
  const pastEvents = state.events.filter(e => e.timestamp <= state.now);
  const latest = latestEvents(pastEvents);

  return problems.flatMap(p => {
    if (!Number.isFinite(p.rating) || !p.contestId) return [];
    const review = isScheduledReview(p, state, latest);
    // Fast range pre-check for non-review problems before expensive eligibility checks
    if (!review && (p.rating! < target - 200 || p.rating! > target + 300)) return [];

    if (!isProblemEligible(p, state, { target, review }, latest)) return [];

    const weakTag = selectMostInformativeWeakTag(p.tags, skill.tagTheta, target);
    const upsolve = !review && isRecentUpsolve(p, state);
    const mode = state.mode ?? 'adaptive';

    const slot: RecSlot =
      mode !== 'adaptive' ? mode : review ? 'revisit' : upsolve ? 'upsolve' : p.rating! > target + 100 ? 'stretch' : 'core';

    const plannedMinutes =
      slot === 'revisit' ? 20 : slot === 'stretch' ? 40 : Math.min(30, Math.max(20, Math.floor(budget)));

    const reasons = explainRecommendation({ slot, target, plannedMinutes, weakTag });

    const item: RecommendedProblem = {
      contestId: p.contestId!,
      index: p.index,
      name: p.name,
      rating: p.rating!,
      tags: p.tags,
      slot,
      slotLabel: SLOT_LABELS[slot],
      pSolve: null,
      reasons,
      qualityScore: p.qualityScore,
      plannedMinutes,
      url: getProblemUrl(p.contestId!, p.index),
    };

    const targetRating = weakTag ? (skill.tagTheta.get(weakTag) ?? target) + 100 : target + 100;
    const modern = isModernContestProblem(p, state.now);
    const qualityAdj = Number.isFinite(p.qualityScore) ? 0.12 * (p.qualityScore - 1) : 0;
    // In a sparse modern pool, prefer recent ratings and higher-quality problems when otherwise comparable.
    const baseScore = scoreProblem(p, targetRating, false, !!weakTag) + (modern ? 0.4 : 0) + qualityAdj;

    let bonus = 0;
    if (review) {
      const memory = estimateMemoryState(problemKey(p), pastEvents, state.now, p.rating!, state.recentRating);
      bonus = 0.5 + 0.15 * memory.urgency;
    } else if (upsolve) {
      bonus = 0.35;
    } else if (slot === 'transfer') {
      bonus = 0.25 * transferSimilarityScore(p, pastEvents, state.now);
    }

    const features = buildAcceptanceFeaturesFromHistory(p, state.acceptanceHistory ?? null);
    const shadowAcceptance = features ? predictHistoricalAcceptanceModel(shadowModel, features) : undefined;
    if (shadowAcceptance !== undefined) item.shadowAcceptance = shadowAcceptance;
    return [{ item, score: baseScore + bonus, modern, ...(shadowAcceptance === undefined ? {} : { shadowAcceptance }) }];
  });
}
