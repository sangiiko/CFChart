import type { RecommendedProblem, RecSlot } from '../types/codeforces';
import type { Candidate, EnrichedProblem, SkillProfile, UserPracticeState } from './types';
import { isProblemEligible, isRecentUpsolve, isScheduledReview } from './eligibility';
import { explainRecommendation } from './explain';
import { scoreProblem } from './score';
import { getProblemUrl } from '../services/codeforcesApi';
import { latestEvents } from './events';

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
  const latest = latestEvents(state.events.filter(e => e.timestamp <= state.now));

  return problems.flatMap(p => {
    // Fast range pre-check before expensive string/event checks
    if (!Number.isFinite(p.rating) || p.rating! < target - 200 || p.rating! > target + 300) return [];

    const review = isScheduledReview(p, state, latest);
    if (!isProblemEligible(p, state, { target, review }, latest)) return [];

    const weakTag = p.tags.find(tag => (skill.tagTheta.get(tag) ?? target) < target - 30);
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
    const baseScore = scoreProblem(p, targetRating, false, !!weakTag);
    const bonus = review ? 0.5 : upsolve ? 0.35 : 0;

    return [{ item, score: baseScore + bonus }];
  });
}
