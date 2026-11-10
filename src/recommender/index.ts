import { EnrichedProblem, UserPracticeState } from './types';
import { scoreProblem } from './score';
import { estimateSkill } from './skill';

export function selectRecommendationsV2(
  problems: EnrichedProblem[],
  state: UserPracticeState,
  dailyTarget: number
) {
  const skill = estimateSkill([], state.recentRating); // Simplified for now
  
  const scored = problems.map(p => ({
    problem: p,
    score: scoreProblem(p, skill.globalTheta, state.solved.has(`${p.contestId}-${p.index}`), false)
  }));
  
  scored.sort((a, b) => b.score - a.score);
  
  return scored.slice(0, dailyTarget).map(s => ({
    ...s.problem,
    slot: 'core',
    slotLabel: 'Core Growth',
    pSolve: 0.5, // placeholder
    reasons: ['High quality growth problem'],
    url: `/problemset/problem/${s.problem.contestId}/${s.problem.index}`
  }));
}
